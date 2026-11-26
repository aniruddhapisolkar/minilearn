import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  connect,
  discoverModels,
  generate,
  normalizeConnection,
  selectedConnection,
} from '../server/models.mjs';
import { Storage } from '../server/storage.mjs';
import { runPlanner, runTutor } from '../server/tutor.mjs';

test('provider adapters discover and generate with the correct request formats', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.includes('anthropic'))
      return Response.json(
        options.method === 'GET'
          ? { data: [{ id: 'claude-test', display_name: 'Claude' }] }
          : { content: [{ type: 'text', text: 'Anthropic reply' }] },
      );
    if (url.includes('googleapis'))
      return Response.json(
        options.method === 'GET'
          ? {
              models: [
                {
                  name: 'models/gemini-test',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }
          : {
              candidates: [{ content: { parts: [{ text: 'Gemini reply' }] } }],
            },
      );
    return Response.json(
      options.method === 'GET'
        ? { data: [{ id: 'gpt-test' }, { id: 'text-embedding-test' }] }
        : { choices: [{ message: { content: 'OpenAI reply' } }] },
    );
  });
  const openai = normalizeConnection({
    provider: 'openai',
    apiKey: 'fake',
    model: 'gpt-test',
  });
  assert.deepEqual(
    (await discoverModels(openai)).map((m) => m.id),
    ['gpt-test'],
  );
  assert.equal(
    await generate(openai, 'system', [{ role: 'user', content: 'hello' }]),
    'OpenAI reply',
  );
  assert.equal(calls.at(-1).options.headers.authorization, 'Bearer fake');
  const anthropic = normalizeConnection({
    provider: 'anthropic',
    apiKey: 'fake',
    model: 'claude-test',
  });
  assert.equal((await discoverModels(anthropic))[0].id, 'claude-test');
  assert.equal(
    await generate(anthropic, 'system', [{ role: 'user', content: 'hello' }]),
    'Anthropic reply',
  );
  assert.equal(JSON.parse(calls.at(-1).options.body).system, 'system');
  assert.equal(calls.at(-1).options.headers['x-api-key'], 'fake');
  const google = normalizeConnection({
    provider: 'google',
    apiKey: 'fake',
    model: 'gemini-test',
  });
  assert.equal((await discoverModels(google))[0].id, 'gemini-test');
  assert.equal(
    await generate(google, 'system', [{ role: 'user', content: 'hello' }]),
    'Gemini reply',
  );
  assert.equal(
    JSON.parse(calls.at(-1).options.body).contents[0].parts[0].text,
    'hello',
  );
  assert.equal(calls.at(-1).options.headers['x-goog-api-key'], 'fake');
  const local = normalizeConnection({
    provider: 'custom',
    baseUrl: 'http://127.0.0.1:1234',
    model: 'local',
  });
  assert.equal(local.baseUrl, 'http://127.0.0.1:1234/v1');
  assert.equal(local.apiKey, '');
});

test('OpenCode uses official endpoints and conversation-scoped session headers', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minilearn-opencode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = new Storage(dir);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith('https://opencode.ai/')) {
      assert.equal(options.headers.authorization, 'Bearer fake-key');
      assert.match(options.headers['user-agent'], /^minilearn\//);
      if (!options.headers['x-opencode-session'])
        return Response.json({ error: { message: 'Request is missing x-opencode-session' } }, { status: 400 });
      assert.match(options.headers['x-opencode-session'], /^ses_[a-f0-9]{64}$/);
    }
    if (options.method === 'GET')
      return Response.json({ data: [
        { id: 'model-test', name: 'Test Model', type: 'chat' },
        { id: 'decision-test', type: 'decision' },
      ] });
    return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: 'Hello', curriculum: null, knowledge: [] }) } }] });
  });
  const key = { apiKey: 'fake-key', model: 'model-test' };
  for (const [provider, base] of [
    ['opencode-go', 'https://opencode.ai/inference/go'],
    ['opencode', 'https://opencode.ai/inference'],
  ]) {
    const c = normalizeConnection({ provider, ...key });
    assert.equal(c.baseUrl, base);
    assert.deepEqual(await discoverModels(c), [{ id: 'model-test', name: 'Test Model' }]);
    assert.equal(requests.at(-1).url, base + '/v1/models');
    const publicValue = await connect(storage, { provider, ...key });
    assert.equal(requests.at(-1).url, base + '/openai/v1/chat/completions');
    assert.equal(publicValue.hasKey, true);
    assert.ok(!Object.hasOwn(publicValue, 'apiKey'));
  }

  await connect(storage, { provider: 'opencode-go', ...key });
  const c = selectedConnection(storage);
  const route = () => requests.at(-1).options.headers['x-opencode-session'];
  const testRoute = route();
  const project = storage.create('Linear Algebra');
  const lesson = project.saveCurriculum([{ title: 'Vectors', lessons: [{ title: 'Span' }] }])[0].lessons[0];
  const session = project.newSession(lesson.id, 'learn');
  await runTutor(project, c, session.id, { message: 'Teach me' });
  const tutorRoute = route();
  assert.notEqual(tutorRoute, testRoute);
  // Reopen on disk to check that routing does not depend on memory.
  await runTutor(storage.project(project.id), c, session.id, { message: 'Continue' });
  assert.equal(route(), tutorRoute);
  const another = project.newSession(lesson.id, 'practice');
  await runTutor(project, c, another.id, { message: 'Practice' });
  assert.notEqual(route(), tutorRoute);
  await runPlanner(project, c, 'Plan vectors');
  const plannerRoute = route();
  assert.notEqual(plannerRoute, tutorRoute);
  await runPlanner(storage.project(project.id), c, 'Continue planning');
  assert.equal(route(), plannerRoute);
  project.clearPlanner();
  await runPlanner(project, c, 'New plan');
  assert.notEqual(route(), plannerRoute);
  const other = storage.create('Another subject');
  await runPlanner(other, c, 'New plan');
  assert.notEqual(route(), plannerRoute);

  // Old manual Go connections gain the headers too. Unrelated hosts don't.
  const legacy = normalizeConnection({ provider: 'custom', baseUrl: 'https://opencode.ai/zen/go/v1', ...key });
  await generate(legacy, 'system', [{ role: 'user', content: 'Hi' }], { conversationId: 'conversation' });
  const legacyRoute = route();
  await generate(legacy, 'system', [{ role: 'user', content: 'Again' }], { conversationId: 'conversation' });
  assert.equal(route(), legacyRoute);
  const local = normalizeConnection({ provider: 'custom', baseUrl: 'http://localhost:11434/v1', model: 'local' });
  await generate(local, 'system', [{ role: 'user', content: 'Hi' }], { conversationId: 'conversation' });
  assert.equal(route(), undefined);
});
