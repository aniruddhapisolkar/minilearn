// Keyless, read-only search integrations. Only a short query is sent to the
// search providers; no model credentials, files, or conversation transcript.
import { AppError } from './storage.mjs';

const EXA = 'https://mcp.exa.ai/mcp';
const PURILI = 'https://puri.li/api/';
const MAX_RESPONSE = 512 * 1024;
const MAX_SOURCES = 5;
const clean = (value, limit) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const deadline = (signal, ms) =>
  signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : AbortSignal.timeout(ms);

function checkCancelled(signal) {
  if (signal?.aborted) throw new AppError('Generation cancelled.', 499);
}

// Keep result URLs as data; minilearn never fetches arbitrary URLs supplied by
// the model or a page. Links must be ordinary HTTP(S) URLs without credentials.
function safeURL(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

function sourcesFrom(results) {
  const seen = new Set();
  const sources = [];
  for (const item of Array.isArray(results) ? results : []) {
    const url = safeURL(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const highlights = Array.isArray(item.highlights)
      ? item.highlights
          .filter((h) => typeof h === 'string')
          .slice(0, 5)
          .join('\n')
      : '';
    sources.push({
      url,
      title: clean(item.title, 300) || new URL(url).hostname,
      text: clean(highlights || item.text || item.description, 2200),
    });
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

// MCP may respond with either JSON or a stream of server-sent events. Stop
// reading once the requested reply arrives, even if the stream stays open.
async function readJSON(response, id) {
  if (!response.body) throw Error('Empty response');
  const sse = response.headers
    .get('content-type')
    ?.includes('text/event-stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '',
    size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw Error('Search response too large');
      buffer += decoder.decode(value, { stream: true });
      if (sse) {
        let boundary;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          const event = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const message = JSON.parse(data);
          if (message.id === id) return message;
        }
      }
    }
    if (sse) throw Error('Search stream ended without a reply');
    return JSON.parse(buffer + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function exaSearch(query, signal) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': 'minilearn/0.1.0',
  };
  const rpc = async (method, params, id) => {
    const res = await fetch(EXA, {
      method: 'POST',
      headers,
      signal,
      redirect: 'error',
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        params,
        ...(id === undefined ? {} : { id }),
      }),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw Error(`Exa HTTP ${res.status}`);
    }
    if (id === undefined) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    if (method === 'initialize') {
      const session = res.headers.get('mcp-session-id');
      if (session) headers['mcp-session-id'] = session;
    }
    const reply = await readJSON(res, id);
    if (reply.id !== id || reply.error || !reply.result)
      throw Error('Invalid Exa MCP reply');
    return reply.result;
  };
  const init = await rpc(
    'initialize',
    {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'minilearn', version: '0.1.0' },
    },
    1,
  );
  if (
    !['2025-03-26', '2025-06-18', '2025-11-25'].includes(init.protocolVersion)
  )
    throw Error('Unsupported Exa MCP protocol');
  headers['mcp-protocol-version'] = init.protocolVersion;
  await rpc('notifications/initialized', {}, undefined);
  const result = await rpc(
    'tools/call',
    {
      name: 'web_search_exa',
      arguments: { query, numResults: MAX_SOURCES },
    },
    2,
  );
  if (result.isError) throw Error('Exa search failed');
  if (Array.isArray(result.structuredContent?.results))
    return sourcesFrom(result.structuredContent.results);
  // Earlier MCP deployments expose the same results as plain text blocks.
  const blocks = (Array.isArray(result.content) ? result.content : [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .flatMap((part) => part.text.split(/\n\s*---\s*\n/));
  return sourcesFrom(
    blocks.map((block) => ({
      title: /^Title:\s*(.+)$/m.exec(block)?.[1],
      url: /^URL:\s*(\S+)$/m.exec(block)?.[1],
      text: block.split(/\n(?:Highlights|Text):\s*/)[1],
    })),
  );
}

async function puriliSearch(query, signal) {
  const get = async (endpoint, params) => {
    const res = await fetch(
      PURILI + endpoint + '?' + new URLSearchParams(params),
      {
        headers: {
          accept: 'application/json',
          'user-agent': 'minilearn/0.1.0',
        },
        redirect: 'error',
        signal,
      },
    );
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw Error(`Purili HTTP ${res.status}`);
    }
    return readJSON(res);
  };
  const result = await get('search', { q: query, page: '1' });
  if (!Array.isArray(result.results)) throw Error('Invalid Purili reply');
  const sources = sourcesFrom(result.results);
  // Obtain additional indexed text from the top two results when available.
  await Promise.all(
    sources.slice(0, 2).map(async (source) => {
      try {
        const data = await get('context', { url: source.url });
        const text = clean(data.content, 2200);
        if (text) source.text = text;
      } catch {
        /* A snippet is still useful if indexed context is missing. */
      }
    }),
  );
  return sources;
}

export async function searchWeb(query, signal) {
  checkCancelled(signal);
  const normalized = clean(query, 500).replace(/\s+/g, ' ');
  if (!normalized) return { query: '', status: 'unavailable', sources: [] };
  let hadResponse = false;
  for (const [provider, search, ms] of [
    ['Exa', exaSearch, 18000],
    ['Purili', puriliSearch, 12000],
  ]) {
    try {
      const sources = await search(normalized, deadline(signal, ms));
      checkCancelled(signal);
      hadResponse = true;
      if (sources.length)
        return { query: normalized, provider, status: 'ok', sources };
    } catch {
      checkCancelled(signal);
    }
  }
  return {
    query: normalized,
    status: hadResponse ? 'no-results' : 'unavailable',
    sources: [],
  };
}
