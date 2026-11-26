import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Storage } from '../server/storage.mjs';
import { createApp } from '../server/index.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
function close(server) {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(resolve));
}

test('complete API workflow: model setup, curriculum proposal, tutor, map, export and clear', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minilearn-api-')),
    storage = new Storage(dir);
  const seen = [];
  let hold = null;
  const fake = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    seen.push(payload);
    const prompt = payload.messages[0].content;
    const last = payload.messages.at(-1).content;
    let answer;
    if (prompt.includes('testing a connection')) answer = 'OK';
    else if (prompt.includes('author a curriculum'))
      answer = JSON.stringify({
        reply: 'Here is your proposed curriculum.',
        curriculum: [
          {
            title: 'Vectors',
            lessons:
              last === 'Insert independence after span'
                ? [
                    { title: 'Span' },
                    { title: 'Independence' },
                    { title: 'Basis' },
                  ]
                : [{ title: 'Span' }, { title: 'Basis' }],
          },
        ],
      });
    else if (last === 'hold generation') {
      await new Promise((resolve) => (hold = resolve));
      answer = JSON.stringify({
        reply: 'Late reply',
        knowledge: [],
        complete: false,
      });
    } else if (last === 'A span contains every linear combination.')
      answer = JSON.stringify({
        reply: 'Correct. A span includes all linear combinations.',
        knowledge: [
          {
            title: 'Span',
            statement: 'The span of a set consists of all linear combinations.',
            premises: [],
          },
        ],
        complete: true,
      });
    else
      answer = JSON.stringify({
        reply: 'What do you know about linear combinations? $a\\mathbf{v}$',
        knowledge: [],
        complete: false,
      });
    if (!res.destroyed)
      res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
  const provider = await listen(fake),
    app = createApp({ storage }),
    base = await listen(app);
  t.after(async () => {
    hold?.();
    await close(app);
    await close(fake);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const asset of [
    '/',
    '/app.js',
    '/vendor/katex.css',
    '/fonts/jetbrains-mono-latin-wght-normal.woff2',
    '/fonts/jetbrains-mono-latin-wght-italic.woff2',
    '/fonts/source-sans-3-latin-wght-normal.woff2',
    '/fonts/source-sans-3-latin-wght-italic.woff2',
    '/fonts/cmu-serif-bold.ttf',
  ]) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 0);
    if (asset.startsWith('/fonts/'))
      assert.match(response.headers.get('content-type'), /^font\//);
  }
  const call = async (url, method = 'GET', data, status = 200) => {
    const result = await fetch(base + url, {
      method,
      headers: data === undefined ? {} : { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const content = await result.json();
    assert.equal(result.status, status, JSON.stringify(content));
    return content;
  };
  const discovered = await call('/api/connections/discover', 'POST', {
    provider: 'custom',
    baseUrl: provider + '/v1',
  });
  assert.deepEqual(
    discovered.models.map((m) => m.id),
    ['test-model'],
  );
  const connection = await call(
    '/api/connections',
    'POST',
    {
      provider: 'custom',
      baseUrl: provider + '/v1',
      model: 'test-model',
      apiKey: 'test-secret',
    },
    201,
  );
  assert.ok(connection.hasKey);
  assert.ok(!Object.hasOwn(connection, 'apiKey'));
  const publicSettings = await call('/api/connections');
  assert.ok(!JSON.stringify(publicSettings).includes('test-secret'));
  const p = await call(
      '/api/projects',
      'POST',
      { name: 'Linear algebra' },
      201,
    ),
    other = await call(
      '/api/projects',
      'POST',
      { name: 'Separate subject' },
      201,
    ),
    url = `/api/projects/${p.id}`;
  await call(`/api/projects/${other.id}/curriculum`, 'PUT', {
    curriculum: [
      { title: 'OTHER PROJECT PRIVATE', lessons: [{ title: 'Secret' }] },
    ],
  });
  const planner = await call(url + '/planner', 'POST', {
    message: 'Help me plan a unit about vectors.',
  });
  assert.equal(planner.proposal[0].lessons.length, 2);
  assert.equal((await call(url)).curriculum.length, 0);
  const planned = await call(url + '/planner/apply', 'POST');
  assert.equal(planned.curriculum.length, 1);
  const lesson = planned.curriculum[0].lessons[0].id;
  const insertion = await call(url + '/planner', 'POST', {
    message: 'Insert independence after span',
  });
  assert.deepEqual(
    insertion.proposal[0].lessons.map((l) => l.title),
    ['Span', 'Independence', 'Basis'],
  );
  assert.equal(insertion.proposal[0].lessons[0].id, lesson);
  assert.equal(
    insertion.proposal[0].lessons[2].id,
    planned.curriculum[0].lessons[1].id,
  );
  await call(url + '/planner/apply', 'POST');
  const s = await call(
    url + '/sessions',
    'POST',
    { lessonId: lesson, mode: 'learn' },
    201,
  );
  const first = await call(url + `/sessions/${s.id}/turn`, 'POST', {
    message: 'Teach me.',
    materialIds: [],
  });
  assert.equal(first.messages.length, 2);
  assert.equal((await call(url)).graph.nodes.length, 0);
  const second = await call(url + `/sessions/${s.id}/turn`, 'POST', {
    message: 'A span contains every linear combination.',
    materialIds: [],
  });
  assert.equal(second.messages.length, 4);
  const updated = await call(url);
  assert.equal(updated.graph.nodes.length, 1);
  assert.equal(updated.progress[lesson], 'complete');
  assert.equal((await call(`/api/projects/${other.id}`)).graph.nodes.length, 0);
  assert.ok(
    seen.every((r) => !JSON.stringify(r).includes('OTHER PROJECT PRIVATE')),
  );
  await call(
    url + '/generated',
    'POST',
    {
      title: 'Saved explanation',
      body: second.messages.at(-1).content,
      lessonId: lesson,
    },
    201,
  );
  const archive = await call(url + '/export');
  const copy = await call('/api/projects/import', 'POST', archive, 201);
  assert.equal(copy.curriculum[0].lessons[0].id, lesson);
  assert.equal(copy.graph.nodes.length, 1);
  assert.equal(copy.generated.length, 1);
  assert.notEqual(copy.id, p.id);
  const trimmed = await call(
    url + `/sessions/${s.id}/exchanges/${second.messages.at(-1).id}`,
    'DELETE',
  );
  assert.equal(trimmed.messages.length, 2);
  const afterDelete = await call(url);
  assert.equal(afterDelete.graph.nodes.length, 0);
  assert.equal(afterDelete.generated.length, 1);
  // Cancellation, and refusal to clear data during an active generation.
  const pending = fetch(base + url + `/sessions/${s.id}/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hold generation', materialIds: [] }),
  });
  for (let i = 0; i < 100 && !hold; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(hold);
  await call(url + '/data', 'POST', { categories: ['history'] }, 409);
  await call(url + '/cancel', 'POST');
  const cancelled = await pending;
  assert.equal(cancelled.status, 499);
  hold();
  const cleared = await call(url + '/data', 'POST', {
    categories: ['history', 'cache'],
  });
  assert.equal(cleared.sessions.length, 0);
  assert.equal(cleared.graph.nodes.length, 0);
  assert.equal(cleared.generated.length, 1);
  assert.equal(cleared.curriculum.length, 1);
  const response = await fetch(base + '/api/projects', {
    headers: { origin: 'https://not-local.example' },
  });
  assert.equal(response.status, 403);
});
