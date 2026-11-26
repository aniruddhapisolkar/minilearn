import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AppError,
  CATEGORIES,
  DATA_ROOT,
  DEFAULT_DATA_ROOT,
  Storage,
  parseOutline,
} from './storage.mjs';
import {
  activateConnection,
  connect,
  deleteConnection,
  discoverModels,
  getConnections,
  normalizeConnection,
  selectedConnection,
} from './models.mjs';
import { applyProposal, runPlanner, runTutor } from './tutor.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BODY = 32 * 1024 * 1024,
  MAX_IMPORT = 140 * 1024 * 1024;
const assets = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['web/app.js', 'text/javascript; charset=utf-8']],
  ['/graph.js', ['web/graph.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['web/styles.css', 'text/css; charset=utf-8']],
  ['/workspace.css', ['web/workspace.css', 'text/css; charset=utf-8']],
  ...[
    'jetbrains-mono-latin-wght-normal.woff2',
    'jetbrains-mono-latin-wght-italic.woff2',
  ].map((name) => [
    `/fonts/${name}`,
    [`web/fonts/${name}`, 'font/woff2'],
  ]),
  [
    '/vendor/marked.js',
    ['node_modules/marked/lib/marked.esm.js', 'text/javascript; charset=utf-8'],
  ],
  [
    '/vendor/purify.js',
    [
      'node_modules/dompurify/dist/purify.es.mjs',
      'text/javascript; charset=utf-8',
    ],
  ],
  [
    '/vendor/katex.js',
    ['node_modules/katex/dist/katex.mjs', 'text/javascript; charset=utf-8'],
  ],
  [
    '/vendor/katex.css',
    ['node_modules/katex/dist/katex.min.css', 'text/css; charset=utf-8'],
  ],
]);

function json(res, value, status = 200) {
  if (res.destroyed) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
function fail(res, error) {
  if (res.destroyed || res.headersSent) return;
  const status = error instanceof AppError ? error.status : 500;
  if (status === 500) console.error('minilearn:', error.message);
  json(
    res,
    {
      error:
        status === 500 && !(error instanceof AppError)
          ? 'Something went wrong. See the local server log.'
          : error.message,
    },
    status,
  );
}
async function body(req, limit = MAX_BODY) {
  if (
    !String(req.headers['content-type'])
      .toLowerCase()
      .startsWith('application/json')
  )
    throw new AppError('Expected JSON request.', 415);
  if (Number(req.headers['content-length']) > limit)
    throw new AppError('Request exceeds the size limit.', 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit)
      throw new AppError('Request exceeds the size limit.', 413);
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object') throw Error();
    return result;
  } catch {
    throw new AppError('Invalid JSON request.');
  }
}
function security(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
  );
  // Local-only server. Refuse cross-origin web pages including DNS rebinding.
  const host = String(req.headers.host || '');
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host))
    throw new AppError('This app only accepts localhost requests.', 403);
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`)
    throw new AppError('Cross-origin requests are not allowed.', 403);
  if (req.headers['sec-fetch-site'] === 'cross-site')
    throw new AppError('Cross-site requests are not allowed.', 403);
}
function download(res, data, filename) {
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'cache-control': 'no-store',
  });
  res.end(data);
}
function streamAsset(url, res) {
  let item = assets.get(url);
  if (!item && /^\/vendor\/fonts\/[a-zA-Z0-9_.-]+\.(?:woff2?|ttf)$/.test(url))
    item = [
      `node_modules/katex/dist/fonts/${path.basename(url)}`,
      url.endsWith('.woff2')
        ? 'font/woff2'
        : url.endsWith('.woff')
          ? 'font/woff'
          : 'font/ttf',
    ];
  if (!item) throw new AppError('Not found.', 404);
  const file = path.join(ROOT, item[0]);
  if (!fs.existsSync(file))
    throw new AppError(
      'An app asset is missing. Restart minilearn with npm start.',
      500,
    );
  res.writeHead(200, {
    'content-type': item[1],
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

export function createApp({ storage = new Storage() } = {}) {
  const running = new Map();
  function idle(project) {
    if (running.has(project.id))
      throw new AppError(
        'A model is working in this project. Stop it or wait before changing project data.',
        409,
      );
  }
  async function operation(project, res, action) {
    idle(project);
    const controller = new AbortController();
    running.set(project.id, controller);
    const close = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', close);
    try {
      return await action(controller.signal);
    } finally {
      res.off('close', close);
      if (running.get(project.id) === controller) running.delete(project.id);
    }
  }
  const server = http.createServer(async (req, res) => {
    try {
      security(req, res);
      const url = new URL(req.url, 'http://localhost');
      const method = req.method;
      if (!url.pathname.startsWith('/api/')) {
        if (method !== 'GET') throw new AppError('Not found.', 404);
        return streamAsset(url.pathname, res);
      }
      let parts;
      try {
        parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
      } catch {
        throw new AppError('Invalid URL.');
      }
      const [resource, projectId, section, item, action, detail] = parts;
      if (resource === 'connections') {
        if (!projectId && method === 'GET')
          return json(res, getConnections(storage));
        if (projectId === 'discover' && method === 'POST' && !section) {
          const value = await body(req);
          const previous = value.id
            ? storage.settings().connections.find((c) => c.id === value.id)
            : null;
          return json(res, {
            models: await discoverModels(
              normalizeConnection(value, previous, false),
            ),
          });
        }
        if (!projectId && method === 'POST')
          return json(res, await connect(storage, await body(req)), 201);
        if (projectId && section === 'activate' && method === 'POST')
          return json(res, activateConnection(storage, projectId));
        if (projectId && !section && method === 'DELETE')
          return json(res, deleteConnection(storage, projectId));
      }
      if (resource !== 'projects') throw new AppError('Not found.', 404);
      if (!projectId) {
        if (method === 'GET') return json(res, { projects: storage.list() });
        if (method === 'POST')
          return json(
            res,
            storage.create((await body(req)).name).snapshot(),
            201,
          );
      }
      if (projectId === 'import' && !section && method === 'POST')
        return json(
          res,
          storage.import(await body(req, MAX_IMPORT)).snapshot(),
          201,
        );
      // Read the request before claiming the project mutation boundary. No
      // awaited request parsing can race a live tutor or a project deletion.
      const payload =
        method !== 'GET' && req.headers['content-type'] ? await body(req) : {};
      const p = storage.project(projectId);
      if (section === 'cancel' && method === 'POST') {
        running.get(p.id)?.abort();
        return json(res, { cancelled: true });
      }
      if (!section && method === 'GET') return json(res, p.snapshot());
      if (method !== 'GET') idle(p);
      if (!section && method === 'PATCH') {
        p.rename(payload.name);
        return json(res, p.snapshot());
      }
      if (!section && method === 'DELETE') {
        storage.delete(p.id);
        return json(res, { deleted: true });
      }
      if (section === 'curriculum' && !item && method === 'PUT') {
        p.saveCurriculum(payload.curriculum);
        return json(res, p.snapshot());
      }
      if (section === 'curriculum' && item === 'parse' && method === 'POST')
        return json(res, { curriculum: parseOutline(payload.text) });
      if (section === 'planner' && !item && method === 'POST') {
        const c = selectedConnection(storage);
        return json(
          res,
          await operation(p, res, (signal) =>
            runPlanner(p, c, payload.message, signal),
          ),
        );
      }
      if (section === 'planner' && !item && method === 'DELETE') {
        p.clearPlanner();
        return json(res, p.snapshot());
      }
      if (section === 'planner' && item === 'apply' && method === 'POST')
        return json(res, applyProposal(p));
      if (section === 'planner' && item === 'proposal' && method === 'DELETE') {
        const planner = p.planner();
        planner.proposal = null;
        delete planner.base;
        p.savePlanner(planner);
        return json(res, p.snapshot());
      }
      if (section === 'materials' && !item && method === 'POST') {
        p.addMaterial(payload);
        return json(res, p.snapshot(), 201);
      }
      if (section === 'materials' && item && !action && method === 'GET') {
        const material = p.material(item);
        return download(res, material.bytes, material.name);
      }
      if (section === 'materials' && item && !action && method === 'DELETE') {
        p.deleteMaterial(item);
        return json(res, p.snapshot());
      }
      if (section === 'generated' && !item && method === 'POST') {
        p.writeGenerated(payload);
        return json(res, p.snapshot(), 201);
      }
      if (section === 'generated' && item && !action && method === 'PUT') {
        p.writeGenerated(payload, item);
        return json(res, p.snapshot());
      }
      if (section === 'generated' && item && !action && method === 'DELETE') {
        p.deleteGenerated(item);
        return json(res, p.snapshot());
      }
      if (section === 'sessions' && !item && method === 'POST')
        return json(res, p.newSession(payload.lessonId, payload.mode), 201);
      if (section === 'sessions' && item && !action && method === 'GET')
        return json(res, p.session(item));
      if (section === 'sessions' && item && !action && method === 'DELETE') {
        p.deleteSession(item);
        return json(res, p.snapshot());
      }
      if (
        section === 'sessions' &&
        item &&
        action === 'exchanges' &&
        detail &&
        method === 'DELETE'
      ) {
        return json(res, p.deleteExchange(item, detail));
      }
      if (
        section === 'sessions' &&
        item &&
        action === 'turn' &&
        method === 'POST'
      ) {
        const c = selectedConnection(storage);
        return json(
          res,
          await operation(p, res, (signal) =>
            runTutor(p, c, item, payload, signal),
          ),
        );
      }
      if (section === 'progress' && item && method === 'PUT') {
        p.setProgress(item, payload.status);
        return json(res, p.snapshot());
      }
      if (section === 'graph' && item && method === 'DELETE') {
        p.deleteNode(item);
        return json(res, p.snapshot());
      }
      if (section === 'graph' && !item && method === 'DELETE') {
        p.clearGraph();
        return json(res, p.snapshot());
      }
      if (section === 'data' && !item && method === 'POST') {
        p.clear(payload.categories);
        return json(res, p.snapshot());
      }
      if (section === 'export' && method === 'GET') {
        const categories = url.searchParams.has('include')
          ? url.searchParams.get('include').split(',').filter(Boolean)
          : CATEGORIES;
        return download(
          res,
          JSON.stringify(p.export(categories)),
          `${p.meta().name}.learn`,
        );
      }
      throw new AppError('Not found.', 404);
    } catch (error) {
      fail(res, error);
    }
  });
  return server;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 3210);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be between 1 and 65535.');
    process.exitCode = 1;
  } else {
    const legacy = path.join(os.homedir(), '.minilearn');
    const portableProjects = path.join(DEFAULT_DATA_ROOT, 'projects');
    if (
      !process.env.MINILEARN_DATA_DIR &&
      (fs.existsSync(path.join(legacy, 'settings.json')) ||
        fs.existsSync(path.join(legacy, 'projects'))) &&
      !fs.existsSync(path.join(DEFAULT_DATA_ROOT, 'settings.json')) &&
      (!fs.existsSync(portableProjects) ||
        fs.readdirSync(portableProjects).length === 0)
    ) {
      console.log(
        `Previous minilearn data remains at ${legacy}. See the README to migrate it safely into this installation.`,
      );
    }
    createApp().listen(port, '127.0.0.1', () =>
      console.log(
        `\n  minilearn  http://127.0.0.1:${port}\n  Data: ${DATA_ROOT}\n  Your learning, at your pace.\n`,
      ),
    );
  }
}
