import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchWeb } from '../server/search.mjs';
import { Storage } from '../server/storage.mjs';
import { normalizeConnection } from '../server/models.mjs';
import { runTutor, runPlanner } from '../server/tutor.mjs';

const EXA = 'https://mcp.exa.ai/mcp';
function exaResponse(options, results, streamed = false) {
  const request = JSON.parse(options.body);
  if (request.method === 'initialize')
    return Response.json(
      {
        jsonrpc: '2.0',
        id: request.id,
        result: { protocolVersion: '2025-11-25' },
      },
      { headers: { 'mcp-session-id': 'test-session' } },
    );
  assert.equal(options.headers['mcp-session-id'], 'test-session');
  assert.equal(options.headers['mcp-protocol-version'], '2025-11-25');
  if (request.method === 'notifications/initialized')
    return new Response(null, { status: 202 });
  assert.equal(request.method, 'tools/call');
  assert.equal(request.params.name, 'web_search_exa');
  assert.equal(request.params.arguments.numResults, 5);
  const reply = { jsonrpc: '2.0', id: request.id, result: results };
  if (!streamed) return Response.json(reply);
  // Keep the stream open to ensure the client stops reading after its reply.
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(
          ': keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n',
        ),
      );
      const event =
        'event: message\r\ndata: ' + JSON.stringify(reply) + '\r\n\r\n';
      controller.enqueue(encoder.encode(event.slice(0, 24)));
      controller.enqueue(encoder.encode(event.slice(24)));
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('keyless Exa MCP supports streamed replies, bounded excerpts and safe links', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, EXA);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, undefined);
    calls++;
    return exaResponse(
      options,
      {
        structuredContent: {
          results: [
            {
              url: 'https://example.org/lecture',
              title: 'Lecture',
              highlights: ['x'.repeat(5000)],
            },
            { url: 'https://example.org/lecture', title: 'Duplicate' },
            { url: 'javascript:alert(1)', title: 'Invalid' },
            { url: 'https://user:secret@example.org/', title: 'Credentials' },
          ],
        },
      },
      true,
    );
  });
  const result = await searchWeb(' linear   algebra ');
  assert.equal(calls, 3);
  assert.equal(result.query, 'linear algebra');
  assert.equal(result.provider, 'Exa');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].text.length, 2200);
  assert.equal(result.sources[0].url, 'https://example.org/lecture');
});

test('Exa text responses work, and free-limit or empty results fall back to Purili', async (t) => {
  let mode = 'text';
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push(url);
    if (url === EXA) {
      if (mode === 'limited') return new Response(null, { status: 429 });
      return exaResponse(
        options,
        mode === 'empty'
          ? { structuredContent: { results: [] } }
          : {
              content: [
                {
                  type: 'text',
                  text: 'Title: Lecture\nURL: https://example.org/lecture\nText: Some source text.',
                },
              ],
            },
      );
    }
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://puri.li');
    assert.equal(options.headers.authorization, undefined);
    if (parsed.pathname === '/api/search') {
      assert.equal(parsed.searchParams.get('q'), 'vector spaces');
      return Response.json({
        results: [
          {
            title: 'Textbook',
            url: 'https://example.edu/book',
            description: 'Snippet',
          },
        ],
      });
    }
    assert.equal(parsed.pathname, '/api/context');
    assert.equal(parsed.searchParams.get('url'), 'https://example.edu/book');
    return Response.json({ content: 'Indexed textbook passage' });
  });
  assert.equal(
    (await searchWeb('vector spaces')).sources[0].text,
    'Some source text.',
  );
  assert.ok(!seen.some((url) => url.startsWith('https://puri.li')));
  for (mode of ['limited', 'empty']) {
    const result = await searchWeb('vector spaces');
    assert.equal(result.provider, 'Purili');
    assert.equal(result.sources[0].text, 'Indexed textbook passage');
  }
});

test('search failure, empty results and cancellation are distinct', async (t) => {
  let mode = 'failure',
    calls = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    if (mode === 'cancel') controller.abort();
    if (mode === 'empty' && url.startsWith('https://puri.li/'))
      return Response.json({ results: [] });
    return new Response(null, { status: 503 });
  });
  assert.equal((await searchWeb('test')).status, 'unavailable');
  mode = 'empty';
  assert.equal((await searchWeb('test')).status, 'no-results');
  calls = 0;
  mode = 'cancel';
  await assert.rejects(searchWeb('test', controller.signal), { status: 499 });
  assert.equal(calls, 1, 'no fallback after cancellation');
});

test('model-directed search is opt-in, provider neutral, and stored with its response', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minilearn-search-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const storage = new Storage(dir);
  const p = storage.create('Private project name');
  const lesson = p.saveCurriculum([
    { title: 'Vectors', lessons: [{ title: 'Span' }] },
  ])[0].lessons[0];
  const session = p.newSession(lesson.id, 'learn');
  const connection = normalizeConnection({
    provider: 'custom',
    baseUrl: 'https://model.example/v1',
    apiKey: 'private-api-key',
    model: 'test-model',
  });
  const requests = [];
  let failure = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({
      url,
      options: { ...options, headers: { ...options.headers } },
    });
    if (url === EXA) {
      assert.ok(!JSON.stringify(options).includes('Private project name'));
      assert.ok(!JSON.stringify(options).includes('private-api-key'));
      if (failure) return new Response(null, { status: 429 });
      return exaResponse(options, {
        structuredContent: {
          results: [
            {
              title: 'Linear algebra text',
              url: 'https://example.org/math',
              highlights: ['A span is a set of linear combinations.'],
            },
          ],
        },
      });
    }
    if (url.startsWith('https://puri.li/'))
      return new Response(null, { status: 503 });
    assert.equal(url, 'https://model.example/v1/chat/completions');
    const payload = JSON.parse(options.body);
    const system = payload.messages[0].content;
    const result = system.includes('WEB SEARCH (enabled')
      ? { web_search: 'linear algebra textbook vector spaces' }
      : system.includes('WEB SEARCH RESULT')
        ? {
            reply: failure ? 'Search unavailable.' : 'Reference [1].',
            curriculum: null,
            knowledge: [],
          }
        : { reply: 'No search needed.', knowledge: [], curriculum: null };
    if (system.includes('WEB SEARCH RESULT') && !failure) {
      assert.ok(system.includes('https://example.org/math'));
      assert.ok(system.includes('A span is a set of linear combinations.'));
      assert.ok(system.includes('untrusted source data'));
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(result) } }],
    });
  });
  const normal = await runTutor(p, connection, session.id, { message: 'Hi' });
  assert.equal(requests.length, 1);
  assert.equal(normal.messages.at(-1).webSearch, undefined);
  const searched = await runTutor(p, connection, session.id, {
    message: 'Find a reference',
    webSearch: true,
  });
  assert.equal(
    requests.filter(
      (r) =>
        r.url === EXA && JSON.parse(r.options.body).method === 'tools/call',
    ).length,
    1,
  );
  const search = searched.messages.at(-1).webSearch;
  assert.deepEqual(search.sources, [
    { title: 'Linear algebra text', url: 'https://example.org/math' },
  ]);
  assert.equal(search.provider, 'Exa');
  assert.deepEqual(p.session(session.id).messages.at(-1).webSearch, search);
  const plan = await runPlanner(p, connection, 'Find a syllabus', undefined, {
    webSearch: true,
  });
  assert.deepEqual(plan.messages.at(-1).webSearch, search);
  const copy = storage.import(p.export(['content', 'history']));
  assert.deepEqual(copy.session(session.id).messages.at(-1).webSearch, search);
  assert.deepEqual(copy.planner().messages.at(-1).webSearch, search);
  failure = true;
  const unavailable = await runTutor(p, connection, session.id, {
    message: 'Search again',
    webSearch: true,
  });
  assert.equal(unavailable.messages.at(-1).webSearch.status, 'unavailable');
  assert.deepEqual(unavailable.messages.at(-1).webSearch.sources, []);
  p.clear(['history']);
  assert.equal(p.sessions().length, 0);
  assert.equal(p.planner().messages.length, 0);
});
