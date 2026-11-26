import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const VERSION = 1;
// Anchor portable data to the installed application, not the caller's cwd.
export const DEFAULT_DATA_ROOT = fileURLToPath(
  new URL('../data/', import.meta.url),
);
export const DATA_ROOT = path.resolve(
  process.env.MINILEARN_DATA_DIR || DEFAULT_DATA_ROOT,
);
export const CATEGORIES = ['content', 'generated', 'history', 'cache'];
const MAX_ARCHIVE = 100 * 1024 * 1024;
const MAX_MATERIAL = 20 * 1024 * 1024;
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const validId = (value) =>
  typeof value === 'string' &&
  idPattern.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const now = () => new Date().toISOString();
const uid = () => randomUUID();

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function requiredText(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(`${label} must be between 1 and ${max} characters.`);
  return value.trim();
}
function text(value, max = 100000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}
function id(value) {
  if (!validId(value)) throw new AppError('Invalid identifier.');
  return value;
}
function read(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new AppError(`Could not read ${path.basename(file)}.`, 500);
  }
}
export function writeJSON(file, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${uid()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function files(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
function clearDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
function slug(name) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 58) || 'project'
  );
}
function emptyGraph() {
  return { nodes: [], edges: [] };
}
function emptyPlanner() {
  return { messages: [], proposal: null };
}
function sourceFilename(name) {
  let safe = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (
    !safe ||
    safe === '.' ||
    safe === '..' ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)
  )
    safe = `file_${safe || 'source'}`;
  while (Buffer.byteLength(safe) > 220)
    safe = Array.from(safe).slice(0, -1).join('');
  return safe;
}
function safeBase64(value, max = MAX_MATERIAL) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 + 4 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new AppError('Invalid or oversized file.');
  const data = Buffer.from(value, 'base64');
  if (data.length > max) throw new AppError('File is too large.');
  return data;
}

// IDs are stable through moves and edits. New nodes get independent IDs.
export function normalizeCurriculum(value, { preserveIds = true } = {}) {
  if (!Array.isArray(value) || value.length > 200)
    throw new AppError(
      'Curriculum must contain an array of up to 200 modules.',
    );
  const seen = new Set();
  const allocate = (candidate) => {
    const next =
      preserveIds && validId(candidate) && !seen.has(candidate)
        ? candidate
        : uid();
    seen.add(next);
    return next;
  };
  let total = 0;
  return value.map((module) => {
    if (!module || typeof module !== 'object' || !Array.isArray(module.lessons))
      throw new AppError('Each module needs a title and lessons array.');
    total += module.lessons.length;
    if (total > 3000)
      throw new AppError('Curriculum contains too many lessons.');
    return {
      id: allocate(module.id),
      title: requiredText(module.title, 'Module title', 300),
      description: text(module.description, 5000),
      lessons: module.lessons.map((lesson) => {
        if (!lesson || typeof lesson !== 'object')
          throw new AppError('Invalid lesson.');
        return {
          id: allocate(lesson.id),
          title: requiredText(lesson.title, 'Lesson title', 300),
          description: text(lesson.description, 10000),
        };
      }),
    };
  });
}

export function parseOutline(raw) {
  const source = requiredText(raw, 'Outline', 100000);
  const rows = source.split(/\r?\n/).filter((x) => x.trim());
  const modules = [];
  let current = null;
  const start = (title) => {
    current = { title: title.trim(), lessons: [] };
    modules.push(current);
  };
  const add = (title) => {
    if (!current) start('Topics');
    current.lessons.push({ title: title.trim() });
  };
  for (const rawLine of rows) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const moduleLabel =
      /^(?:module|unit|chapter|part|section)\s+[\w.-]+\s*[:.\-–—]?\s*(.*)$/i.exec(
        line,
      );
    const bullet = line.match(/^(?:[-*+•]\s+|\d+(?:\.\d+)*[.)]\s+)(.+)$/);
    if (
      heading &&
      heading[1].length === 1 &&
      rows.some((r) => /^##\s+/.test(r.trim()))
    )
      continue;
    if (heading && heading[1].length <= 2) start(heading[2]);
    else if (moduleLabel && !/^\s/.test(rawLine)) start(line);
    else if (heading || bullet) add((heading?.[2] ?? bullet?.[1]).trim());
    else if (line.endsWith(':') && !/^\s/.test(rawLine))
      start(line.slice(0, -1));
    else add(line);
  }
  return normalizeCurriculum(modules);
}

export class Storage {
  constructor(root = DATA_ROOT) {
    this.root = path.resolve(root);
    this.projects = path.join(this.root, 'projects');
    fs.mkdirSync(this.projects, { recursive: true, mode: 0o700 });
  }
  settings() {
    return read(path.join(this.root, 'settings.json'), {
      connections: [],
      activeConnection: null,
    });
  }
  saveSettings(value) {
    writeJSON(path.join(this.root, 'settings.json'), value);
  }
  list() {
    return fs
      .readdirSync(this.projects, { withFileTypes: true })
      .filter((d) => d.isDirectory() && idPattern.test(d.name))
      .flatMap((d) => {
        try {
          const p = this.project(d.name);
          return [
            {
              ...p.meta(),
              lessonCount: p
                .curriculum()
                .reduce((n, m) => n + m.lessons.length, 0),
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  create(name) {
    name = requiredText(name, 'Project name', 120);
    const projectId = `${slug(name)}-${uid().slice(0, 8)}`;
    const dir = path.join(this.projects, projectId);
    fs.mkdirSync(dir, { mode: 0o700 });
    const project = new Project(dir, projectId);
    writeJSON(project.file('project.json'), {
      version: VERSION,
      id: projectId,
      name,
      createdAt: now(),
      updatedAt: now(),
    });
    writeJSON(project.file('curriculum.json'), []);
    for (const subdir of [
      'materials',
      'generated',
      'learning-history/sessions',
      'cache',
    ])
      fs.mkdirSync(project.file(subdir), { recursive: true });
    return project;
  }
  project(projectId) {
    id(projectId);
    const directory = path.join(this.projects, projectId);
    let stat;
    try {
      stat = fs.lstatSync(directory);
    } catch {
      throw new AppError('Project not found.', 404);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new AppError('Project not found.', 404);
    const project = new Project(directory, projectId);
    project.meta();
    return project;
  }
  delete(projectId) {
    const project = this.project(projectId);
    fs.rmSync(project.dir, { recursive: true });
  }
  import(archive) {
    if (
      !archive ||
      archive.format !== 'minilearn' ||
      archive.version !== VERSION ||
      !Array.isArray(archive.files)
    )
      throw new AppError('This is not a supported .learn file.');
    if (archive.files.length > 20000)
      throw new AppError('Archive contains too many files.');
    const name = requiredText(archive.name, 'Project name', 120);
    const entries = new Map();
    let total = 0;
    for (const entry of archive.files) {
      if (!entry || !archiveCategory(entry.path) || entries.has(entry.path))
        throw new AppError('Archive includes an invalid or duplicate path.');
      const bytes = safeBase64(entry.data, MAX_ARCHIVE);
      total += bytes.length;
      if (total > MAX_ARCHIVE)
        throw new AppError('Project exceeds the 100 MB import limit.');
      entries.set(entry.path, bytes);
    }
    // Parse and validate all JSON metadata before writing a project directory.
    for (const [relative, bytes] of entries) {
      if (relative === 'curriculum.json')
        validateCurriculum(parseJSON(bytes, relative));
      else if (relative === 'materials/index.json')
        validateMaterials(parseJSON(bytes, relative), entries);
      else if (relative.startsWith('generated/'))
        validateGenerated(parseJSON(bytes, relative), relative);
      else if (relative.startsWith('learning-history/sessions/'))
        validateSession(parseJSON(bytes, relative), relative);
      else if (relative === 'learning-history/graph.json')
        validateGraph(parseJSON(bytes, relative));
      else if (relative === 'learning-history/progress.json')
        validateProgress(parseJSON(bytes, relative));
      else if (relative === 'learning-history/planner.json')
        validatePlanner(parseJSON(bytes, relative));
    }
    const materialIndex = entries.has('materials/index.json')
      ? parseJSON(entries.get('materials/index.json'), 'materials/index.json')
      : [];
    const materialPaths = new Set(
      materialIndex.map((m) => `materials/${m.id}/${m.fileName}`),
    );
    for (const relative of entries.keys())
      if (
        relative.startsWith('materials/') &&
        relative !== 'materials/index.json' &&
        !materialPaths.has(relative)
      )
        throw new AppError('Archive contains an unindexed source file.');
    const p = this.create(name);
    try {
      for (const [relative, bytes] of entries) {
        const dest = p.file(relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, bytes, { mode: 0o600 });
      }
      p.snapshot();
      return p;
    } catch (error) {
      this.delete(p.id);
      throw error;
    }
  }
}

// Only known data paths are imported. No executable project files or absolute paths.
function archiveCategory(relative) {
  if (
    typeof relative !== 'string' ||
    relative.length > 512 ||
    relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    return null;
  if (relative === 'curriculum.json' || relative === 'materials/index.json')
    return 'content';
  const material = relative.match(
    /^materials\/([a-zA-Z0-9_-]{1,100})\/([^/]+)$/,
  );
  if (
    material &&
    validId(material[1]) &&
    sourceFilename(material[2]) === material[2]
  )
    return 'content';
  if (/^generated\/[a-zA-Z0-9_-]{1,100}\.json$/.test(relative))
    return 'generated';
  if (
    /^learning-history\/(?:graph|progress|planner)\.json$/.test(relative) ||
    /^learning-history\/sessions\/[a-zA-Z0-9_-]{1,100}\.json$/.test(relative)
  )
    return 'history';
  if (/^cache\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(relative))
    return 'cache';
  return null;
}
function parseJSON(bytes, name) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new AppError(`Invalid JSON in ${name}.`);
  }
}
function validateCurriculum(value) {
  const normalized = normalizeCurriculum(value);
  const originalIds = value.flatMap((m) => [
    m.id,
    ...m.lessons.map((l) => l.id),
  ]);
  const normalizedIds = normalized.flatMap((m) => [
    m.id,
    ...m.lessons.map((l) => l.id),
  ]);
  if (originalIds.some((v, i) => v !== normalizedIds[i]))
    throw new AppError('Invalid or duplicate curriculum IDs.');
  if (
    value.some(
      (m) =>
        typeof m.description !== 'string' ||
        m.lessons.some((l) => typeof l.description !== 'string'),
    )
  )
    throw new AppError('Invalid curriculum description.');
}
function validateMaterials(value, entries) {
  if (!Array.isArray(value) || value.length > 5000)
    throw new AppError('Invalid material index.');
  const seen = new Set();
  for (const m of value) {
    if (
      !m ||
      seen.has(id(m.id)) ||
      typeof m.name !== 'string' ||
      /[\r\n\u0000]/.test(m.name) ||
      typeof m.fileName !== 'string' ||
      !m.fileName ||
      sourceFilename(m.fileName) !== m.fileName ||
      typeof m.mime !== 'string' ||
      typeof m.createdAt !== 'string' ||
      !Number.isInteger(m.size) ||
      m.size < 0 ||
      !entries.has(`materials/${m.id}/${m.fileName}`) ||
      entries.get(`materials/${m.id}/${m.fileName}`).length !== m.size
    )
      throw new AppError('Invalid material record.');
    seen.add(m.id);
  }
}
function validateGenerated(value, relative) {
  if (
    !value ||
    typeof value.title !== 'string' ||
    typeof value.body !== 'string' ||
    typeof value.createdAt !== 'string' ||
    relative !== `generated/${id(value.id)}.json`
  )
    throw new AppError('Invalid study material.');
}
function validateSession(value, relative) {
  if (
    !value ||
    relative !== `learning-history/sessions/${id(value.id)}.json` ||
    !validId(value.lessonId) ||
    !['learn', 'practice'].includes(value.mode) ||
    typeof value.lessonTitle !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !Array.isArray(value.messages) ||
    value.messages.some(
      (m) =>
        !m ||
        !validId(m.id) ||
        !['user', 'assistant'].includes(m.role) ||
        typeof m.content !== 'string' ||
        (m.question !== undefined &&
          (m.role !== 'assistant' ||
            !m.question ||
            !['prediction', 'check', 'practice'].includes(m.question.kind) ||
            typeof m.question.prompt !== 'string' ||
            !Array.isArray(m.question.options) ||
            m.question.options.length > 5 ||
            m.question.options.some((v) => typeof v !== 'string'))),
    ) ||
    !Array.isArray(value.materialIds) ||
    value.materialIds.some((i) => !validId(i))
  )
    throw new AppError('Invalid learning session.');
}
function validateGraph(value) {
  if (
    !value ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    value.nodes.length > 50000 ||
    value.edges.length > 100000
  )
    throw new AppError('Invalid knowledge map.');
  const ids = new Set();
  for (const n of value.nodes) {
    if (
      !n ||
      ids.has(id(n.id)) ||
      typeof n.title !== 'string' ||
      typeof n.statement !== 'string' ||
      !Array.isArray(n.sources) ||
      n.sources.some((s) => !validId(s)) ||
      !validEvidence(n.evidence)
    )
      throw new AppError('Invalid knowledge node.');
    ids.add(n.id);
  }
  for (const e of value.edges)
    if (
      !e ||
      !ids.has(e.from) ||
      !ids.has(e.to) ||
      (e.sources !== undefined &&
        (!Array.isArray(e.sources) || e.sources.some((s) => !validId(s)))) ||
      !validEvidence(e.evidence)
    )
      throw new AppError('Invalid knowledge connection.');
}
function validEvidence(value) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every((v) => v && validId(v.sessionId) && validId(v.messageId)))
  );
}
function removeExchangeEvidence(item, sessionId, messageIds) {
  if (!item.evidence?.length) return item;
  const remaining = item.evidence.filter(
    (v) => v.sessionId !== sessionId || !messageIds.has(v.messageId),
  );
  if (remaining.length === item.evidence.length) return item;
  const trackedBefore = new Set(item.evidence.map((v) => v.sessionId));
  const sources = [
    ...new Set([
      ...(item.sources || []).filter((s) => !trackedBefore.has(s)),
      ...remaining.map((v) => v.sessionId),
    ]),
  ];
  return sources.length ? { ...item, sources, evidence: remaining } : null;
}
function validateProgress(value) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    Object.entries(value).some(
      ([k, v]) => !validId(k) || !['started', 'complete'].includes(v),
    )
  )
    throw new AppError('Invalid lesson progress.');
}
function validatePlanner(value) {
  if (
    !value ||
    (value.id !== undefined && !validId(value.id)) ||
    !Array.isArray(value.messages) ||
    value.messages.some(
      (m) =>
        !m ||
        !['assistant', 'user'].includes(m.role) ||
        typeof m.content !== 'string',
    )
  )
    throw new AppError('Invalid curriculum conversation.');
  if (value.proposal !== null) validateCurriculum(value.proposal);
}

export class Project {
  constructor(dir, projectId) {
    this.dir = dir;
    this.id = projectId;
  }
  file(relative) {
    const file = path.resolve(this.dir, relative);
    if (!file.startsWith(this.dir + path.sep))
      throw new AppError('Invalid path.');
    let current = this.dir;
    for (const part of path.relative(this.dir, file).split(path.sep)) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink())
          throw new AppError('Project data cannot use symbolic links.');
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
    return file;
  }
  meta() {
    const meta = read(this.file('project.json'), null);
    if (!meta || meta.id !== this.id || meta.version !== VERSION)
      throw new AppError('Invalid project.', 404);
    return meta;
  }
  touch() {
    writeJSON(this.file('project.json'), { ...this.meta(), updatedAt: now() });
  }
  rename(name) {
    writeJSON(this.file('project.json'), {
      ...this.meta(),
      name: requiredText(name, 'Project name', 120),
      updatedAt: now(),
    });
  }
  curriculum() {
    return read(this.file('curriculum.json'), []);
  }
  saveCurriculum(value) {
    const curriculum = normalizeCurriculum(value);
    writeJSON(this.file('curriculum.json'), curriculum);
    this.touch();
    return curriculum;
  }
  lesson(lessonId) {
    id(lessonId);
    for (const module of this.curriculum()) {
      const lesson = module.lessons.find((l) => l.id === lessonId);
      if (lesson) return { ...lesson, moduleTitle: module.title };
    }
    throw new AppError('Lesson not found.', 404);
  }
  materials() {
    return read(this.file('materials/index.json'), []);
  }
  material(materialId) {
    id(materialId);
    const value = this.materials().find((m) => m.id === materialId);
    if (!value) throw new AppError('Material not found.', 404);
    if (
      typeof value.fileName !== 'string' ||
      sourceFilename(value.fileName) !== value.fileName
    )
      throw new AppError('Invalid material filename.');
    return {
      ...value,
      bytes: fs.readFileSync(
        this.file(`materials/${materialId}/${value.fileName}`),
      ),
    };
  }
  addMaterial({ name, mime, data }) {
    name = requiredText(name, 'File name', 255).replace(
      /[\\/\u0000-\u001f]/g,
      '_',
    );
    const bytes = safeBase64(data);
    const material = {
      id: uid(),
      name,
      fileName: sourceFilename(name),
      mime: text(mime, 120) || 'application/octet-stream',
      size: bytes.length,
      createdAt: now(),
    };
    fs.mkdirSync(this.file(`materials/${material.id}`), { recursive: true });
    fs.writeFileSync(
      this.file(`materials/${material.id}/${material.fileName}`),
      bytes,
      { mode: 0o600 },
    );
    writeJSON(this.file('materials/index.json'), [
      ...this.materials(),
      material,
    ]);
    this.touch();
    return material;
  }
  deleteMaterial(materialId) {
    const material = this.material(materialId);
    fs.unlinkSync(this.file(`materials/${materialId}/${material.fileName}`));
    try {
      fs.rmdirSync(this.file(`materials/${materialId}`));
    } catch (error) {
      if (error.code !== 'ENOTEMPTY') throw error;
    }
    writeJSON(
      this.file('materials/index.json'),
      this.materials().filter((m) => m.id !== materialId),
    );
    this.touch();
  }
  generated() {
    return files(this.file('generated'))
      .filter((f) => /^[a-zA-Z0-9_-]+\.json$/.test(f))
      .map((f) => read(this.file(`generated/${f}`), null))
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  writeGenerated({ title, body, lessonId = null }, existingId) {
    const record = {
      id: existingId ? id(existingId) : uid(),
      title: requiredText(title, 'Note title', 300),
      body: requiredText(body, 'Note', 200000),
      lessonId: lessonId ? id(lessonId) : null,
      createdAt: now(),
    };
    if (existingId) {
      const previous = read(this.file(`generated/${existingId}.json`), null);
      if (!previous) throw new AppError('Note not found.', 404);
      record.createdAt = previous.createdAt;
    }
    writeJSON(this.file(`generated/${record.id}.json`), record);
    this.touch();
    return record;
  }
  deleteGenerated(noteId) {
    const file = this.file(`generated/${id(noteId)}.json`);
    if (!fs.existsSync(file)) throw new AppError('Note not found.', 404);
    fs.unlinkSync(file);
    this.touch();
  }
  sessions() {
    return files(this.file('learning-history/sessions'))
      .filter((f) => /^[a-zA-Z0-9_-]+\.json$/.test(f))
      .map((f) => read(this.file(`learning-history/sessions/${f}`), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  session(sessionId) {
    const s = read(
      this.file(`learning-history/sessions/${id(sessionId)}.json`),
      null,
    );
    if (!s) throw new AppError('Session not found.', 404);
    return s;
  }
  newSession(lessonId, mode) {
    if (!['learn', 'practice'].includes(mode))
      throw new AppError('Invalid session mode.');
    const lesson = this.lesson(lessonId);
    const session = {
      id: uid(),
      lessonId,
      lessonTitle: lesson.title,
      mode,
      createdAt: now(),
      updatedAt: now(),
      messages: [],
      materialIds: [],
    };
    this.saveSession(session);
    return session;
  }
  saveSession(session) {
    session.updatedAt = now();
    writeJSON(
      this.file(`learning-history/sessions/${id(session.id)}.json`),
      session,
    );
    this.touch();
  }
  deleteSession(sessionId) {
    this.session(sessionId);
    fs.unlinkSync(this.file(`learning-history/sessions/${sessionId}.json`));
    const g = this.graph();
    const nodes = g.nodes
      .map((n) => ({
        ...n,
        sources: n.sources.filter((s) => s !== sessionId),
        evidence: n.evidence?.filter((v) => v.sessionId !== sessionId),
      }))
      .filter((n) => n.sources.length);
    const remaining = new Set(nodes.map((n) => n.id));
    const edges = g.edges
      .map((e) => ({
        ...e,
        sources: e.sources?.filter((s) => s !== sessionId),
        evidence: e.evidence?.filter((v) => v.sessionId !== sessionId),
      }))
      .filter(
        (e) =>
          remaining.has(e.from) &&
          remaining.has(e.to) &&
          (!e.sources || e.sources.length),
      );
    this.writeGraph({ nodes, edges });
    this.touch();
  }
  deleteExchange(sessionId, messageId) {
    const session = this.session(sessionId);
    const i = session.messages.findIndex((m) => m.id === id(messageId));
    if (i < 0) throw new AppError('Message not found.', 404);
    const message = session.messages[i];
    const paired =
      message.role === 'assistant'
        ? session.messages[i - 1]?.role === 'user'
          ? i - 1
          : -1
        : session.messages[i + 1]?.role === 'assistant'
          ? i + 1
          : -1;
    const removed = new Set([
      message.id,
      ...(paired >= 0 ? [session.messages[paired].id] : []),
    ]);
    session.messages = session.messages.filter((m) => !removed.has(m.id));
    this.saveSession(session);
    const graph = this.graph();
    const nodes = graph.nodes
      .map((n) => removeExchangeEvidence(n, sessionId, removed))
      .filter(Boolean);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges
      .map((e) => removeExchangeEvidence(e, sessionId, removed))
      .filter((e) => e && ids.has(e.from) && ids.has(e.to));
    this.writeGraph({ nodes, edges });
    return session;
  }
  progress() {
    return read(this.file('learning-history/progress.json'), {});
  }
  setProgress(lessonId, status) {
    this.lesson(lessonId);
    const value = this.progress();
    if (status === null) delete value[lessonId];
    else if (['started', 'complete'].includes(status)) value[lessonId] = status;
    else throw new AppError('Invalid progress status.');
    writeJSON(this.file('learning-history/progress.json'), value);
    this.touch();
  }
  graph() {
    return read(this.file('learning-history/graph.json'), emptyGraph());
  }
  writeGraph(graph) {
    writeJSON(this.file('learning-history/graph.json'), graph);
  }
  deleteNode(nodeId) {
    id(nodeId);
    const g = this.graph();
    this.writeGraph({
      nodes: g.nodes.filter((n) => n.id !== nodeId),
      edges: g.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
    });
    this.touch();
  }
  clearGraph() {
    this.writeGraph(emptyGraph());
    this.touch();
  }
  planner() {
    return read(this.file('learning-history/planner.json'), emptyPlanner());
  }
  savePlanner(value) {
    writeJSON(this.file('learning-history/planner.json'), value);
    this.touch();
  }
  clearPlanner() {
    this.savePlanner(emptyPlanner());
  }
  snapshot() {
    const sessions = this.sessions().map(({ messages, ...session }) => ({
      ...session,
      messageCount: messages.length,
    }));
    return {
      ...this.meta(),
      folder: this.dir,
      curriculum: this.curriculum(),
      materials: this.materials(),
      generated: this.generated(),
      sessions,
      graph: this.graph(),
      progress: this.progress(),
      planner: this.planner(),
      storage: this.usage(),
    };
  }
  walk(dir = this.dir, result = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) this.walk(file, result);
      else if (entry.isFile()) {
        const relative = path
          .relative(this.dir, file)
          .split(path.sep)
          .join('/');
        const category = archiveCategory(relative);
        if (category)
          result.push({
            relative,
            file,
            category,
            bytes: fs.statSync(file).size,
          });
      }
    }
    return result;
  }
  usage() {
    const totals = Object.fromEntries(
      CATEGORIES.map((c) => [c, { files: 0, bytes: 0 }]),
    );
    for (const f of this.walk()) {
      totals[f.category].files++;
      totals[f.category].bytes += f.bytes;
    }
    return totals;
  }
  clear(categories) {
    if (
      !Array.isArray(categories) ||
      categories.some((c) => !CATEGORIES.includes(c))
    )
      throw new AppError('Invalid data category.');
    for (const category of new Set(categories)) {
      if (category === 'content') {
        writeJSON(this.file('curriculum.json'), []);
        clearDir(this.file('materials'));
      } else if (category === 'generated') clearDir(this.file('generated'));
      else if (category === 'history') {
        clearDir(this.file('learning-history'));
        fs.mkdirSync(this.file('learning-history/sessions'));
      } else if (category === 'cache') clearDir(this.file('cache'));
    }
    this.touch();
  }
  export(categories) {
    if (
      !Array.isArray(categories) ||
      categories.some((c) => !CATEGORIES.includes(c))
    )
      throw new AppError('Invalid export category.');
    const selected = this.walk().filter((f) => categories.includes(f.category));
    if (selected.reduce((n, f) => n + f.bytes, 0) > MAX_ARCHIVE)
      throw new AppError('Export exceeds the 100 MB limit.');
    return {
      format: 'minilearn',
      version: VERSION,
      name: this.meta().name,
      exportedAt: now(),
      categories,
      files: selected.map((f) => ({
        path: f.relative,
        data: fs.readFileSync(f.file).toString('base64'),
      })),
    };
  }
}
