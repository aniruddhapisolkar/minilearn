import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Storage,
  normalizeCurriculum,
  parseOutline,
  CATEGORIES,
} from '../server/storage.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minilearn-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new Storage(root);
}

test('outline parsing and stable curriculum identities when moving lessons', (t) => {
  const s = fixture(t),
    p = s.create('Linear Algebra');
  const outline = parseOutline(
    '# Linear Algebra\n## Module 1: Vectors\n- Span\n- Basis\n## Module 2: Transformations\n- Eigenvectors',
  );
  assert.equal(outline.length, 2);
  assert.equal(outline[0].lessons[1].title, 'Basis');
  const curriculum = p.saveCurriculum(outline);
  const id = curriculum[0].lessons[1].id;
  const moved = curriculum[0].lessons.pop();
  curriculum[1].lessons.splice(0, 0, moved);
  p.saveCurriculum(curriculum);
  assert.equal(p.lesson(id).moduleTitle, 'Module 2: Transformations');
  assert.equal(p.lesson(id).title, 'Basis');
  const invalid = normalizeCurriculum([
    {
      id: 'duplicate',
      title: 'One',
      lessons: [{ id: 'duplicate', title: 'Two' }],
    },
  ]);
  assert.notEqual(invalid[0].id, invalid[0].lessons[0].id);
});

test('projects are independent; full and content-only exports round-trip without credentials', (t) => {
  const s = fixture(t),
    a = s.create('Algebra'),
    b = s.create('Mechanics');
  s.saveSettings({
    connections: [{ apiKey: 'private-test-key' }],
    activeConnection: null,
  });
  const lesson = a.saveCurriculum([
    { title: 'Vectors', lessons: [{ title: 'Span' }] },
  ])[0].lessons[0];
  const file = a.addMaterial({
    name: 'reference.txt',
    mime: 'text/plain',
    data: Buffer.from('project-specific reference').toString('base64'),
  });
  const session = a.newSession(lesson.id, 'learn');
  session.messages.push({
    id: 'message-one',
    role: 'user',
    content: 'What is a span?',
  });
  a.saveSession(session);
  a.setProgress(lesson.id, 'complete');
  a.writeGenerated({
    title: 'A note',
    body: 'A study explanation',
    lessonId: lesson.id,
  });
  a.writeGraph({
    nodes: [
      {
        id: 'node-one',
        title: 'Span',
        statement: 'Span is a set of linear combinations.',
        lessonId: lesson.id,
        sources: [session.id],
      },
    ],
    edges: [],
  });
  fs.writeFileSync(a.file('cache/local.txt'), 'temporary data');
  assert.deepEqual(b.curriculum(), []);
  assert.deepEqual(b.graph(), { nodes: [], edges: [] });
  assert.equal(b.materials().length, 0);
  const archive = a.export(CATEGORIES);
  assert.ok(!JSON.stringify(archive).includes('private-test-key'));
  assert.ok(archive.files.every((f) => !f.path.includes('settings')));
  const copy = s.import(archive);
  assert.notEqual(copy.id, a.id);
  assert.equal(copy.lesson(lesson.id).title, 'Span');
  assert.deepEqual(copy.material(file.id).bytes, a.material(file.id).bytes);
  assert.equal(copy.sessions().length, 1);
  assert.equal(copy.graph().nodes.length, 1);
  assert.equal(copy.progress()[lesson.id], 'complete');
  assert.equal(copy.generated().length, 1);
  assert.equal(
    fs.readFileSync(copy.file('cache/local.txt'), 'utf8'),
    'temporary data',
  );
  const clean = s.import(a.export(['content']));
  assert.equal(clean.curriculum().length, 1);
  assert.equal(clean.materials().length, 1);
  assert.equal(clean.sessions().length, 0);
  assert.equal(clean.graph().nodes.length, 0);
  assert.equal(clean.generated().length, 0);
  a.clear(['history', 'cache', 'generated']);
  assert.equal(a.curriculum().length, 1);
  assert.equal(a.materials().length, 1);
  assert.equal(a.generated().length, 0);
  assert.equal(a.sessions().length, 0);
  assert.deepEqual(a.progress(), {});
  assert.equal(a.graph().nodes.length, 0);
  assert.equal(a.usage().cache.files, 0);
  assert.equal(copy.sessions().length, 1);
  s.delete(a.id);
  assert.throws(() => s.project(a.id));
  assert.equal(s.project(b.id).meta().name, 'Mechanics');
});

test('archive validation rejects unsupported paths and malformed metadata before creating a project', (t) => {
  const s = fixture(t);
  const invalid = {
    format: 'minilearn',
    version: 1,
    name: 'Invalid',
    files: [
      { path: 'settings.json', data: Buffer.from('{}').toString('base64') },
    ],
  };
  assert.throws(() => s.import(invalid), /invalid or duplicate path/);
  assert.equal(s.list().length, 0);
  invalid.files = [
    {
      path: 'curriculum.json',
      data: Buffer.from(
        '[{"id":"same","title":"Module","description":"","lessons":[{"id":"same","title":"Lesson","description":""}]}]',
      ).toString('base64'),
    },
  ];
  assert.throws(() => s.import(invalid), /duplicate curriculum IDs/);
  assert.equal(s.list().length, 0);
});

test('deleting a session removes only exclusively associated graph evidence', (t) => {
  const p = fixture(t).create('Calculus');
  const lesson = p.saveCurriculum([
    { title: 'Limits', lessons: [{ title: 'Continuity' }] },
  ])[0].lessons[0];
  const a = p.newSession(lesson.id, 'learn'),
    b = p.newSession(lesson.id, 'practice');
  p.writeGraph({
    nodes: [
      { id: 'one', title: 'One', statement: 'One', sources: [a.id, b.id] },
      { id: 'two', title: 'Two', statement: 'Two', sources: [a.id] },
      { id: 'three', title: 'Three', statement: 'Three', sources: [b.id] },
    ],
    edges: [
      { from: 'one', to: 'two', sources: [a.id] },
      { from: 'one', to: 'three', sources: [a.id] },
    ],
  });
  p.deleteSession(a.id);
  const g = p.graph();
  assert.deepEqual(
    g.nodes.map((n) => n.id),
    ['one', 'three'],
  );
  assert.deepEqual(g.nodes[0].sources, [b.id]);
  assert.deepEqual(g.edges, []);
});
