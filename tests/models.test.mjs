import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverModels,
  generate,
  normalizeConnection,
} from '../server/models.mjs';

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
