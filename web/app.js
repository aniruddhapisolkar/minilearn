import { marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';
import katex from '/vendor/katex.js';
import { graphMarkup, mountGraph } from '/graph.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const root = $('#app'),
  dialog = $('#dialog');
const e = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const icons = {
  book: '<path d="M12 6c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v13"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11H3Z"/>',
  folderPlus:
    '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11H3Z M12 10v6M9 13h6"/>',
  dumbbell:
    '<path d="m6.5 6.5 11 11M3 8l5-5 4 4-5 5Zm9 9 5-5 4 4-5 5ZM2 6l4-4M18 22l4-4"/>',
  enter: '<path d="M20 4v7a5 5 0 0 1-5 5H4m5-5-5 5 5 5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.9 1.9-.06-.06A1.7 1.7 0 0 0 15.96 18a1.7 1.7 0 0 0-1.05 1.55v.09h-2.7v-.09A1.7 1.7 0 0 0 11.16 18a1.7 1.7 0 0 0-1.88.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.72 14.56a1.7 1.7 0 0 0-1.55-1.05h-.09v-2.7h.09a1.7 1.7 0 0 0 1.55-1.05 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.9-1.9.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.05-1.55V4.7h2.7v.09a1.7 1.7 0 0 0 1.05 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.9 1.9-.06.06A1.7 1.7 0 0 0 19.4 9.76a1.7 1.7 0 0 0 1.55 1.05h.09v2.7h-.09A1.7 1.7 0 0 0 19.4 15Z" transform="translate(-1.5 -.2)"/>',
  back: '<path d="m12 19-7-7 7-7M5 12h14"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  file: '<path d="M6 3h8l4 4v14H6Z M14 3v5h4M9 12h6M9 16h6"/>',
  graph:
    '<circle cx="3.5" cy="12" r="2.5"/><circle cx="12" cy="3.5" r="2.5"/><circle cx="20.5" cy="12" r="2.5"/><circle cx="12" cy="20.5" r="2.5"/><path d="m5.3 10.2 4.9-4.9M6 12h12m-7.8 6.7 8.5-4.9"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  edit: '<path d="m4 16 11-11 4 4L8 20H4Zm9-9 4 4M15 5l2-2 4 4-2 2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  move: '<path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/>',
  spark:
    '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>',
  import: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  export: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="m3 11 18-8-8 18-2-8-8-2Zm8 2L21 3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  paperclip:
    '<path d="M8 12 15 5a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3M6 16l9-9a2 2 0 0 1 3 3l-9 9"/>',
  note: '<path d="M4 3h16v12l-6 6H4Z M14 21v-6h6M8 8h8M8 12h6"/>',
  flag: '<path d="M5 21V4m0 0c5-4 9 4 14 0v11c-5 4-9-4-14 0"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chat: '<path d="M4 4h16v12H9l-5 5Z"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',
  list: '<path d="M8 5h12M8 12h12M8 19h12M4 5h.1M4 12h.1M4 19h.1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  reset: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7h.01"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const attrs = (object) =>
  Object.entries(object || {})
    .map(([k, v]) =>
      v === undefined || v === null || v === false
        ? ''
        : ` ${k}="${e(v === true ? '' : v)}"`,
    )
    .join('');
const button = (
  label,
  action,
  { style = '', i = '', data = {}, disabled = false, title = '' } = {},
) =>
  `<button type="button" class="button ${style}" data-action="${action}"${attrs(data)}${disabled ? ' disabled' : ''}${title ? ` title="${e(title)}"` : ''}>${i ? icon(i) : ''}${e(label)}</button>`;
const ib = (i, action, label, data = {}, extra = '') =>
  `<button type="button" class="icon-button ${extra}" data-action="${action}" aria-label="${e(label)}" title="${e(label)}"${attrs(data)}>${icon(i)}</button>`;
const brand = () =>
  `<button class="brand" data-action="home" title="Home"><span class="wordmark">minilearn</span></button>`;
const state = {
  projects: [],
  project: null,
  view: 'overview',
  lessonId: null,
  mode: 'learn',
  session: null,
  connections: { connections: [], activeConnection: null },
  collapsed: window.innerWidth < 680,
  folded: new Set(),
  sidebarQuery: '',
  sessionFilter: 'learn',
  homeDraft: '',
  homeMode: 'learn',
  webSearch: false,
  planVisible: false,
  answerChoice: '',
  confidence: 50,
  practiceNodes: [],
  attachUpload: false,
  busy: null,
  draft: '',
  plannerDraft: '',
  selectedMaterials: [],
  graph: {
    query: '',
    lesson: '',
    view: 'graph',
    selected: null,
    zoom: 1,
    x: 0,
    y: 0,
    fit: true,
  },
};
const categoryInfo = {
  content: [
    'Curriculum & source materials',
    'Your course outline and imported reference files.',
    'book',
  ],
  generated: [
    'Generated study materials',
    'Saved explanations, notes, and other study content.',
    'note',
  ],
  history: [
    'Learning history & progress',
    'Sessions, curriculum conversations, progress, and knowledge map.',
    'clock',
  ],
  cache: [
    'Caches & temporary data',
    'Rebuildable local data, not your learning materials.',
    'data',
  ],
};
const activeModel = () =>
  state.connections.connections.find(
    (c) => c.id === state.connections.activeConnection,
  );
const lessons = () =>
  state.project?.curriculum.flatMap((m) =>
    m.lessons.map((l) => ({ ...l, moduleId: m.id, moduleTitle: m.title })),
  ) || [];
const selectedLesson = () => lessons().find((l) => l.id === state.lessonId);
const purl = (suffix) =>
  `/api/projects/${encodeURIComponent(state.project.id)}${suffix || ''}`;
const sizeLabel = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;
const dateLabel = (date) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(date));
  } catch {
    return '';
  }
};
const statusLabel = (status) =>
  status === 'complete'
    ? 'Complete'
    : status === 'started'
      ? 'In progress'
      : 'Not started';
const statusDot = (status) =>
  `<span class="lesson-status ${status === 'complete' ? 'complete' : status === 'started' ? 'started' : ''}" title="${statusLabel(status)}"></span>`;
const markdown = (raw, sources = []) => {
  const expressions = [];
  const safeRaw = String(raw).replace(
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g,
    (match, block, bracket, paren, inline) => {
      const expression = block ?? bracket ?? paren ?? inline;
      const token = `MINILEARNMATHTOKEN${expressions.length}END`;
      expressions.push({
        expression,
        display: Boolean(block ?? bracket),
        original: match,
      });
      return token;
    },
  );
  const html = DOMPurify.sanitize(
    marked.parse(safeRaw, { gfm: true, breaks: false }),
    {
      USE_PROFILES: { html: true },
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS: [
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'style',
        'iframe',
        'object',
        'embed',
        'video',
        'audio',
        'img',
      ],
      FORBID_ATTR: ['style', 'id', 'name', 'srcset'],
    },
  );
  const template = document.createElement('template');
  template.innerHTML = html;
  // Restore equations only in text nodes, never inside a URL or attribute.
  const walker = document.createTreeWalker(
    template.content,
    NodeFilter.SHOW_TEXT,
  );
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const matches = [
      ...node.textContent.matchAll(/MINILEARNMATHTOKEN(\d+)END/g),
    ];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const item = expressions[Number(match[1])];
      if (!item) continue;
      fragment.append(node.textContent.slice(offset, match.index));
      if (node.parentElement?.closest('pre,code'))
        fragment.append(item.original);
      else {
        const math = document.createElement('span');
        try {
          katex.render(item.expression, math, {
            displayMode: item.display,
            throwOnError: false,
            trust: false,
            strict: 'ignore',
          });
          fragment.append(math);
        } catch {
          fragment.append(item.original);
        }
      }
      offset = match.index + match[0].length;
    }
    fragment.append(node.textContent.slice(offset));
    node.replaceWith(fragment);
  }
  if (sources.length) {
    const citations = document.createTreeWalker(
      template.content,
      NodeFilter.SHOW_TEXT,
    );
    const textNodes = [];
    while (citations.nextNode()) textNodes.push(citations.currentNode);
    for (const node of textNodes) {
      if (node.parentElement?.closest('a,pre,code,.katex')) continue;
      const matches = [...node.textContent.matchAll(/\[([1-5])\]/g)];
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of matches) {
        fragment.append(node.textContent.slice(offset, match.index));
        const url = safeSourceURL(sources[Number(match[1]) - 1]?.url);
        if (url) {
          const link = document.createElement('a');
          link.className = 'web-citation';
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = match[0];
          fragment.append(link);
        } else fragment.append(match[0]);
        offset = match.index + match[0].length;
      }
      fragment.append(node.textContent.slice(offset));
      node.replaceWith(fragment);
    }
  }
  return template.innerHTML;
};
async function api(path, { method = 'GET', data, signal } = {}) {
  const res = await fetch(path, {
    method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
    cache: 'no-store',
  });
  const value = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(value.error || `Request failed (${res.status}).`);
  return value;
}
let toastTimer;
function toast(message, failure = false) {
  const node = $('#toast');
  node.textContent = message;
  node.className = `visible${failure ? ' failure' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = ''), 4200);
}
function errorMessage(error) {
  return error.name === 'AbortError'
    ? 'Request cancelled.'
    : error.message || 'Something went wrong.';
}
function modelPill() {
  const c = activeModel();
  return `<div class="model-control"><button class="model-pill" data-action="model-picker" title="${c ? e(c.model) : 'Select a model'}" aria-label="Select model"><span class="truncate">${c ? e(c.model) : '—'}</span><span class="model-caret">▾</span></button></div>`;
}
function empty(iconName, title, body, actions = '') {
  return `<div class="empty"><div class="empty-icon">${icon(iconName)}</div><h2>${e(title)}</h2><p>${e(body)}</p>${actions ? `<div class="row wrap" style="justify-content:center">${actions}</div>` : ''}</div>`;
}
function pageHeader(title, description, actions = '') {
  return `<div class="page-head between"><div class="grow"><h1>${e(title)}</h1><p>${e(description)}</p></div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}
function closeDialog() {
  if (dialog.open) dialog.close();
}
function showDialog(title, body, footer = '', wide = false) {
  dialog.className = wide ? 'wide-dialog' : '';
  dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2>${ib('close', 'close-dialog', 'Close')}</div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  if (!dialog.open) dialog.showModal();
}
function showSettings(body) {
  dialog.className = 'settings-dialog';
  dialog.innerHTML = `<div class="settings-heading"><h2 id="dialog-title">Settings</h2>${ib('close', 'close-dialog', 'Close settings')}</div><div class="settings-layout"><nav class="settings-rail" aria-label="Settings sections"><button class="settings-nav active" data-action="models">${icon('key')} Providers</button>${state.project ? `<button class="settings-nav" data-action="settings-data">${icon('data')} Data &amp; export</button>` : ''}</nav><section class="settings-content">${body}</section></div>`;
  if (!dialog.open) dialog.showModal();
}
function formDialog(
  title,
  fields,
  onSubmit,
  { submit = 'Save', danger = false, wide = false } = {},
) {
  showDialog(
    title,
    `<form id="modal-form">${fields}<div id="form-error" class="error hidden" role="alert"></div><div class="row" style="justify-content:flex-end;margin-top:20px">${button('Cancel', 'close-dialog', { style: 'ghost' })}<button type="submit" class="button ${danger ? 'danger' : 'primary'}">${e(submit)}</button></div></form>`,
    '',
    wide,
  );
  $('#modal-form', dialog).addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = $('button[type=submit]', form),
      error = $('#form-error', form);
    submitButton.disabled = true;
    error.classList.add('hidden');
    try {
      await onSubmit(new FormData(form), form);
      if (dialog.open && dialog.contains(form)) closeDialog();
    } catch (err) {
      error.textContent = errorMessage(err);
      error.classList.remove('hidden');
    } finally {
      submitButton.disabled = false;
    }
  });
}
function confirmDialog(title, description, doIt, submit = 'Delete') {
  formDialog(title, `<p>${e(description)}</p>`, doIt, { submit, danger: true });
}
const field = (label, name, value = '', placeholder = '', extra = '') =>
  `<label class="field">${e(label)}<input class="input" name="${name}" value="${e(value)}" placeholder="${e(placeholder)}" ${extra}></label>`;
const area = (label, name, value = '', placeholder = '', extra = '') =>
  `<label class="field">${e(label)}<textarea name="${name}" placeholder="${e(placeholder)}" ${extra}>${e(value)}</textarea></label>`;
function canNavigate() {
  if (state.busy) {
    toast('Stop or finish the current generation first.', true);
    return false;
  }
  return true;
}
function hashLocation() {
  if (!state.project) {
    history.replaceState(null, '', location.pathname);
    return;
  }
  const pieces = [state.project.id, state.view];
  if (state.view === 'lesson' && state.lessonId) {
    pieces.push(state.lessonId, state.mode);
    if (state.session) pieces.push(state.session.id);
  } else if (state.view === 'draft') {
    pieces.push(state.homeMode);
  }
  history.replaceState(
    null,
    '',
    `#${pieces.map(encodeURIComponent).join('/')}`,
  );
}
function go(view) {
  if (!canNavigate()) return;
  if (!state.project && !['overview', 'graph', 'draft'].includes(view)) {
    projectDialog();
    return;
  }
  state.view = view;
  state.session = null;
  state.planVisible = false;
  if (window.innerWidth < 680) state.collapsed = true;
  hashLocation();
  render();
  window.scrollTo(0, 0);
}
function applyProject(p) {
  state.project = p;
  if (state.lessonId && !selectedLesson() && state.view === 'lesson') {
    state.view = 'overview';
    state.lessonId = null;
    state.session = null;
  }
  if (state.session && !p.sessions.some((s) => s.id === state.session.id))
    state.session = null;
  state.selectedMaterials = state.selectedMaterials.filter((id) =>
    p.materials.some((m) => m.id === id),
  );
  state.practiceNodes = state.practiceNodes.filter((id) =>
    p.graph.nodes.some((n) => n.id === id),
  );
}
async function refreshProject() {
  applyProject(await api(purl()));
}
async function loadProjects() {
  state.projects = (await api('/api/projects')).projects;
}
async function loadConnections() {
  state.connections = await api('/api/connections');
}
async function openProject(
  id,
  view = 'overview',
  lessonId = null,
  mode = 'learn',
  sessionId = null,
) {
  if (!canNavigate()) return;
  state.project = await api(`/api/projects/${encodeURIComponent(id)}`);
  state.view = view;
  state.lessonId = lessonId;
  state.mode =
    (view === 'draft' ? lessonId : mode) === 'practice' ? 'practice' : 'learn';
  state.session = null;
  state.draft = '';
  state.homeDraft = '';
  state.homeMode = state.mode;
  state.sessionFilter = state.mode;
  state.answerChoice = '';
  state.confidence = 50;
  state.sidebarQuery = '';
  state.plannerDraft = '';
  state.selectedMaterials = [];
  state.practiceNodes = [];
  state.folded.clear();
  state.graph = {
    query: '',
    lesson: '',
    view: 'graph',
    selected: null,
    zoom: 1,
    x: 0,
    y: 0,
    fit: true,
  };
  if (
    view === 'lesson' &&
    sessionId &&
    state.project.sessions.some(
      (s) => s.id === sessionId && s.lessonId === lessonId,
    )
  ) {
    await openSession(sessionId);
    return;
  }
  if (view === 'lesson' && selectedLesson()) {
    await selectLesson(lessonId, state.mode);
    return;
  }
  if (
    ![
      'overview',
      'draft',
      'curriculum',
      'planner',
      'materials',
      'graph',
      'data',
    ].includes(view)
  )
    state.view = 'overview';
  hashLocation();
  render();
  window.scrollTo(0, 0);
}
async function selectLesson(id, mode = 'learn') {
  if (!canNavigate()) return;
  state.lessonId = id;
  state.mode = mode;
  if (state.sessionFilter !== 'all') state.sessionFilter = mode;
  state.view = 'lesson';
  state.session = null;
  state.draft = '';
  state.answerChoice = '';
  state.confidence = 50;
  state.planVisible = false;
  state.selectedMaterials = [];
  const l = selectedLesson();
  if (!l) {
    go('overview');
    return;
  }
  state.folded.delete(l.moduleId);
  if (window.innerWidth < 680) state.collapsed = true;
  const latest = state.project.sessions.find(
    (s) => s.lessonId === id && s.mode === mode,
  );
  if (latest) {
    state.session = await api(purl(`/sessions/${latest.id}`));
    state.selectedMaterials = state.session.materialIds.filter((id) =>
      state.project.materials.some((m) => m.id === id),
    );
  }
  hashLocation();
  render();
  window.scrollTo(0, 0);
  if (state.session?.messages.length) scrollMessages(false);
}
function sessionRows() {
  const p = state.project,
    q = state.sidebarQuery.trim().toLowerCase();
  if (!p)
    return `<div class="session-empty">${state.projects.length ? 'Choose a project.' : 'No sessions yet.'}</div>`;
  const matches = (value) => !q || String(value).toLowerCase().includes(q);
  const row = (l, s = null) => {
    const mode =
      s?.mode || (state.sessionFilter === 'practice' ? 'practice' : 'learn');
    const active =
      state.view === 'lesson' &&
      state.lessonId === l.id &&
      (s ? state.session?.id === s.id : !state.session);
    const meta = s
      ? `${state.sessionFilter === 'all' ? (mode === 'learn' ? 'Teaching' : 'Practice') + ' · ' : ''}${dateLabel(s.updatedAt)}`
      : statusLabel(p.progress[l.id]);
    return `<button class="session-row lesson-link ${active ? 'active' : ''}" data-action="${s ? 'open-session' : 'lesson'}" data-id="${e(s?.id || l.id)}" data-lesson="${e(l.id)}" data-mode="${mode}"><span class="session-name">${e(l.title)}</span><span class="session-subtitle">${e(meta)}</span></button>`;
  };
  let count = 0;
  const modules = p.curriculum
    .map((m) => {
      const rows = m.lessons.flatMap((l) => {
        if (!matches(l.title) && !matches(m.title)) return [];
        const sessions = p.sessions.filter(
          (s) =>
            s.lessonId === l.id &&
            (state.sessionFilter === 'all' || s.mode === state.sessionFilter),
        );
        const items = sessions.length
          ? sessions.map((s) => row(l, s))
          : [row(l)];
        count += items.length;
        return items;
      });
      if (q && !rows.length && !matches(m.title)) return '';
      const folded = state.folded.has(m.id) && !q;
      return `<div class="session-folder"><button class="session-folder-row" data-action="fold-module" data-id="${e(m.id)}" aria-expanded="${!folded}">${icon(folded ? 'right' : 'down')}${icon('folder')}<span class="grow">${e(m.title)}</span></button>${folded ? '' : `<div class="session-folder-children">${rows.join('')}</div>`}</div>`;
    })
    .join('');
  const archived = p.sessions.filter(
    (s) =>
      !lessons().some((l) => l.id === s.lessonId) &&
      (state.sessionFilter === 'all' || s.mode === state.sessionFilter) &&
      matches(s.lessonTitle),
  );
  const archivedRows = archived.length
    ? `<div class="session-folder"><div class="session-folder-row">${icon('folder')} Archived sessions</div>${archived.map((s) => `<button class="session-row lesson-link" data-action="view-session" data-id="${e(s.id)}"><span class="session-name">${e(s.lessonTitle)}</span><span class="session-subtitle">${e(dateLabel(s.updatedAt))}</span></button>`).join('')}</div>`
    : '';
  return (
    modules +
    archivedRows +
    (!count && !archived.length
      ? `<div class="session-empty">${q ? 'No sessions match.' : 'No sessions yet.'}</div>`
      : '')
  );
}
function renderSidebar() {
  const p = state.project;
  return `<aside class="sidebar"><div class="side-top between">${brand()}${ib('panel', 'toggle-sidebar', 'Collapse sidebar')}</div><div class="sidebar-doors"><button class="sidebar-door" data-action="draft" data-mode="learn">${icon('plus')} Teaching</button><button class="sidebar-door" data-action="draft" data-mode="practice">${icon('dumbbell')} Practice</button></div><div class="workspace-picker"><button class="workspace-project" data-action="projects">${icon('folder')}<span class="grow truncate">${e(p?.name || 'Projects')}</span>${icon('down')}</button>${ib('folderPlus', 'new-project', 'New project')}</div><div class="session-search-row"><span class="caps">Sessions</span><div class="session-search-box">${icon('search')}<input id="session-search" aria-label="Search sessions" placeholder="Search…" value="${e(state.sidebarQuery)}"></div>${p ? ib('plus', 'add-module', 'Add module') : ''}</div><div class="session-filter" role="group" aria-label="Filter sessions">${[
    ['learn', 'Teaching'],
    ['practice', 'Practice'],
    ['all', 'All'],
  ]
    .map(
      ([mode, label]) =>
        `<button class="${state.sessionFilter === mode ? 'active' : ''}" data-action="session-filter" data-mode="${mode}">${label}</button>`,
    )
    .join(
      '',
    )}</div><div class="session-list" id="sidebar-rows">${sessionRows()}</div><div class="sidebar-footer">${p ? `<div class="project-tools"><span class="caps">Project</span><div class="row">${ib('graph', 'go', 'Knowledge graph', { 'data-view': 'graph' })}${ib('book', 'go', 'Curriculum', { 'data-view': 'curriculum' })}${ib('file', 'go', 'Study materials', { 'data-view': 'materials' })}${ib('data', 'go', 'Data & export', { 'data-view': 'data' })}</div></div>` : ''}<button class="sidebar-door sidebar-settings" data-action="models">${icon('settings')} Settings</button></div></aside>`;
}
function topbar() {
  const title =
    state.view === 'lesson'
      ? selectedLesson()?.title
      : {
          overview: state.project.name,
          curriculum: 'Curriculum',
          planner: 'Plan with AI',
          materials: 'Study materials',
          graph: 'Knowledge map',
          data: 'Data & export',
        }[state.view];
  return `<header class="topbar">${state.collapsed ? ib('panel', 'toggle-sidebar', 'Open sidebar') : ''}<h1 class="window-title grow truncate" title="${e(title || '')}">${e(title || '')}</h1>${state.view === 'lesson' ? `<button class="plan-toggle ${state.planVisible ? 'active' : ''}" data-action="toggle-plan">${icon('graph')} Plan</button><span class="mode-indicator"><span class="mode-ring"></span>${state.mode === 'learn' ? 'Teaching' : 'Practice'}</span>${ib('more', 'session-options', 'Session options')}` : ib('close', 'go', 'Back to knowledge graph', { 'data-view': 'overview' })}</header>`;
}
function renderOverview() {
  const p = state.project,
    all = lessons(),
    complete = all.filter((l) => p.progress[l.id] === 'complete').length,
    next = all.find((l) => p.progress[l.id] !== 'complete') || all[0];
  return `<main class="page narrow"><div class="page-head"><span class="caps">Learning project</span><h1 style="margin-top:9px">${e(p.name)}</h1><p>${all.length ? 'Your curriculum, materials, and learning history.' : 'Build the curriculum the way you want to learn it.'}</p></div>${all.length ? `<div class="overview-progress"><div class="progress-track" aria-label="${complete} of ${all.length} lessons complete"><div style="width:${(complete / all.length) * 100}%"></div></div><span class="small muted">${complete} / ${all.length} complete</span></div><div class="row wrap">${next ? button('Continue learning', 'lesson', { style: 'primary', i: 'arrow', data: { 'data-id': next.id } }) : ''}${button('Edit curriculum', 'go', { i: 'edit', data: { 'data-view': 'curriculum' } })}</div><div class="section"><div class="section-heading between"><h2>Curriculum</h2>${button('Plan with AI', 'go', { style: 'ghost', i: 'spark', data: { 'data-view': 'planner' } })}</div>${p.curriculum.map((m) => `<div class="overview-module"><h3>${e(m.title)}</h3>${m.lessons.length ? m.lessons.map((l) => `<button class="overview-lesson" data-action="lesson" data-id="${e(l.id)}">${statusDot(p.progress[l.id])}<span class="grow">${e(l.title)}</span>${icon('right')}</button>`).join('') : '<span class="small muted">No lessons yet.</span>'}</div>`).join('')}</div>` : empty('book', 'Make a plan', 'Paste a syllabus, talk through a plan with AI, or start with an empty module.', button('Build curriculum', 'go', { style: 'primary', i: 'plus', data: { 'data-view': 'curriculum' } }) + button('Plan with AI', 'go', { i: 'spark', data: { 'data-view': 'planner' } }))}</main>`;
}
function modeSwitch(mode, action = 'home-mode') {
  return `<div class="dock-mode-switch" role="group" aria-label="Learning mode"><button class="${mode === 'learn' ? 'active' : ''}" data-action="${action}" data-mode="learn">Teach</button><button class="${mode === 'practice' ? 'active' : ''}" data-action="${action}" data-mode="practice">${icon('dumbbell')} Practice</button></div>`;
}
function dockSetup() {
  return activeModel()
    ? ''
    : button('Add a provider key', 'add-model', { style: 'setup-key' });
}
function webSearchToggle() {
  return `<button type="button" class="web-search-toggle ${state.webSearch ? 'active' : ''}" data-action="toggle-web-search" aria-pressed="${state.webSearch}" title="Optional web search. Only model-generated search queries go to Exa or Purili; results go to your model. No search key needed." ${state.busy ? 'disabled' : ''}>${icon('globe')} Web search</button>`;
}
function homeDock(switchMode = true) {
  const practice = state.homeMode === 'practice';
  const pick =
    practice && state.project
      ? button(
          state.practiceNodes.length
            ? `${state.practiceNodes.length} nodes`
            : 'Pick nodes',
          'practice-nodes',
          { style: 'pick-nodes', i: 'dumbbell' },
        )
      : '';
  return `<div class="home-dock"><div class="dock-inner"><div class="dock-actions">${pick}${dockSetup()}</div><form id="home-form" class="opening-composer" data-drop-composer><textarea name="topic" aria-label="${practice ? 'What do you want to practice?' : 'What do you want to learn?'}" placeholder="${practice ? 'What do you want to practice?' : 'What do you want to learn?'}" rows="1">${e(state.homeDraft)}</textarea>${ib('paperclip', 'choose-materials', 'Attach files', {}, 'composer-attach')}<button type="submit" class="send-square" aria-label="Start session" ${!state.homeDraft.trim() && !state.practiceNodes.length ? 'disabled' : ''}>${icon('enter')}</button></form><div class="dock-stats">${switchMode ? modeSwitch(state.homeMode) : ''}<span class="spacer"></span>${state.selectedMaterials.length ? `<span class="dock-source-count">${state.selectedMaterials.length} sources</span>` : ''}${webSearchToggle()}${modelPill()}</div></div></div>`;
}
const emptyGraphProject = { curriculum: [], graph: { nodes: [], edges: [] } };
function renderHome() {
  const p = state.project || emptyGraphProject;
  return `<main class="home-workspace">${state.collapsed ? `<div class="floating-sidebar-toggle">${ib('panel', 'toggle-sidebar', 'Open sidebar')}</div>` : ''}${graphMarkup(p, state.graph, { e, icon, button, ib, pageHeader })}${homeDock()}</main>`;
}
function renderDraft() {
  return `<main class="draft-workspace">${state.collapsed ? `<div class="floating-sidebar-toggle">${ib('panel', 'toggle-sidebar', 'Open sidebar')}</div>` : ''}<div class="draft-empty"><h2>${state.homeMode === 'practice' ? 'New practice session' : 'New session'}</h2><p>${state.homeMode === 'practice' ? 'Pick nodes from your knowledge graph, describe what you want to practice, or bring your own problem.' : 'The teacher will open by probing what you already know.'}</p></div>${homeDock(false)}</main>`;
}
function renderCurriculum() {
  const p = state.project;
  return `<main class="page"><div class="page-head"><h1>Curriculum</h1><p>Your plan is always yours to edit. Add, move, or refine any lesson.</p><div class="row wrap" style="margin-top:18px">${button('Add module', 'add-module', { style: 'primary', i: 'plus' })}${button('Paste outline', 'paste-outline', { i: 'file' })}${button('Plan with AI', 'go', { i: 'spark', data: { 'data-view': 'planner' } })}</div></div>${p.curriculum.length ? p.curriculum.map((m, i) => `<section class="module-card"><div class="module-card-header"><span class="module-number">${String(i + 1).padStart(2, '0')}</span><div class="grow"><h3>${e(m.title)}</h3>${m.description ? `<div class="module-desc">${e(m.description)}</div>` : ''}</div><div class="controls">${i > 0 ? ib('up', 'move-module', 'Move module up', { 'data-id': m.id, 'data-direction': '-1' }) : ''}${i < p.curriculum.length - 1 ? ib('down', 'move-module', 'Move module down', { 'data-id': m.id, 'data-direction': '1' }) : ''}${ib('edit', 'edit-module', 'Edit module', { 'data-id': m.id })}${ib('trash', 'delete-module', 'Delete module', { 'data-id': m.id }, 'danger')}</div></div><div class="module-lessons">${m.lessons.map((l, j) => `<div class="edit-lesson">${statusDot(p.progress[l.id])}<div class="grow"><div class="title">${e(l.title)}</div>${l.description ? `<small>${e(l.description)}</small>` : ''}</div><div class="controls">${ib('plus', 'add-lesson', 'Insert lesson after this one', { 'data-module': m.id, 'data-after': l.id })}${j > 0 ? ib('up', 'move-lesson', 'Move lesson up', { 'data-module': m.id, 'data-id': l.id, 'data-direction': '-1' }) : ''}${j < m.lessons.length - 1 ? ib('down', 'move-lesson', 'Move lesson down', { 'data-module': m.id, 'data-id': l.id, 'data-direction': '1' }) : ''}${ib('edit', 'edit-lesson', 'Edit or move lesson', { 'data-module': m.id, 'data-id': l.id })}${ib('trash', 'delete-lesson', 'Delete lesson', { 'data-module': m.id, 'data-id': l.id }, 'danger')}</div></div>`).join('')}<button class="add-inline" data-action="add-lesson" data-module="${e(m.id)}">${icon('plus')} Add lesson</button></div></section>`).join('') : empty('book', 'Start from scratch', 'You can build the outline manually or turn your own text into a curriculum.', button('Add module', 'add-module', { style: 'primary', i: 'plus' }) + button('Paste outline', 'paste-outline', { i: 'file' }))}</main>`;
}
function safeSourceURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
function webSearchSources(search) {
  if (!search) return '';
  if (search.status !== 'ok')
    return `<div class="web-search-note">${icon('globe')} ${search.status === 'no-results' ? 'Web search found no results.' : 'Web search temporarily unavailable.'} No web verification.</div>`;
  const items = Array.isArray(search.sources) ? search.sources : [];
  return `<details class="web-sources"><summary>${icon('globe')} ${items.length} web source${items.length === 1 ? '' : 's'} · ${e(search.provider)}</summary><div class="web-search-query">${e(search.query)}</div><ol>${items
    .map((source) => {
      const url = safeSourceURL(source?.url);
      return url
        ? `<li><a href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(source.title || url)}</a><span class="web-source-host">${e(new URL(url).hostname)}</span></li>`
        : '<li>Invalid source URL</li>';
    })
    .join('')}</ol></details>`;
}
function messageHTML(m, { save = false, showQuestion = true } = {}) {
  return m.role === 'user'
    ? `<article class="message user"><div class="user-bubble">${e(m.content)}</div></article>`
    : `<article class="message assistant">${m.content ? `<div class="markdown">${markdown(m.content, m.webSearch?.sources || [])}</div>` : ''}${webSearchSources(m.webSearch)}${showQuestion && m.question ? `<div class="past-question"><span class="caps">${e(questionLabel(m.question.kind))}</span><div class="markdown">${markdown(m.question.prompt)}</div>${m.question.options.length ? `<ol class="past-options">${m.question.options.map((option) => `<li>${markdown(option)}</li>`).join('')}</ol>` : ''}</div>` : ''}${save ? `<div class="message-actions">${m.content ? button('Save as study note', 'save-message', { i: 'note', style: 'minor', data: { 'data-id': m.id } }) : ''}${ib('trash', 'delete-exchange', 'Delete this exchange', { 'data-id': m.id }, 'danger')}</div>` : ''}</article>`;
}
function proposalList(curriculum) {
  return `<ul class="proposal-list">${curriculum.map((m) => `<li><strong>${e(m.title)}</strong><ol>${m.lessons.map((l) => `<li>${e(l.title)}</li>`).join('')}</ol></li>`).join('')}</ul>`;
}
function proposalChanges(proposal, current) {
  const flatten = (modules) =>
    new Map(
      modules.flatMap((m) => [
        [
          m.id,
          {
            title: m.title,
            description: m.description,
            kind: 'module',
            module: null,
          },
        ],
        ...m.lessons.map((l) => [
          l.id,
          { ...l, kind: 'lesson', module: m.id, moduleTitle: m.title },
        ]),
      ]),
    );
  const old = flatten(current),
    next = flatten(proposal),
    added = [],
    removed = [],
    changed = [];
  for (const [id, item] of next) {
    const previous = old.get(id);
    if (!previous) added.push(item);
    else if (
      previous.title !== item.title ||
      previous.description !== item.description ||
      previous.module !== item.module
    )
      changed.push(item);
  }
  for (const [id, item] of old) if (!next.has(id)) removed.push(item);
  const summary = [
    added.length ? `${added.length} added` : null,
    removed.length ? `${removed.length} removed` : null,
    changed.length ? `${changed.length} edited or moved` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `<details class="proposal-changes" ${removed.length ? 'open' : ''}><summary>${e(summary || 'No items added or removed')}</summary>${[
    ['Added', added],
    ['Removed', removed],
    ['Edited or moved', changed],
  ]
    .filter(([, items]) => items.length)
    .map(
      ([label, items]) =>
        `<div class="small" style="margin-top:8px"><strong>${label}</strong><ul style="padding-left:19px;margin:4px 0">${items.map((item) => `<li>${e(item.title)}${item.moduleTitle ? ` <span class="muted">· ${e(item.moduleTitle)}</span>` : ''}</li>`).join('')}</ul></div>`,
    )
    .join('')}</details>`;
}
function renderPlanner() {
  const planner = state.project.planner,
    working = state.busy?.kind === 'planner';
  return `<main class="page wide"><div class="page-head"><h1>Plan with AI</h1><p>Talk through your curriculum. Nothing changes until you apply a proposal.</p><div class="row wrap" style="margin-top:14px">${button('Back to editor', 'go', { i: 'back', data: { 'data-view': 'curriculum' } })}${planner.messages.length ? button('Clear conversation', 'clear-planner', { style: 'ghost', i: 'trash' }) : ''}</div></div><div class="planner-grid"><div><div class="planner-messages">${planner.messages.length ? planner.messages.map((m) => messageHTML(m)).join('') : `<div class="card"><h3>What would you like to learn?</h3><p class="muted">Paste a full syllabus, describe a subject and your goals, or ask for a specific change — for example, “Add spectral decomposition after eigenvectors in Module 5.”</p></div>`}${working ? `<div class="thinking"><span class="spinner"></span>Working on your curriculum…</div>` : ''}</div><form id="planner-form" class="planner-composer"><textarea name="message" aria-label="Message to curriculum planner" placeholder="Describe your curriculum or a change…" ${working ? 'disabled' : ''}>${e(state.plannerDraft)}</textarea><div class="row" style="justify-content:flex-end">${working ? button('Stop', 'stop', { i: 'stop' }) : `${webSearchToggle()}${button('Paste outline', 'paste-outline', { style: 'ghost', i: 'file' })}<button class="button primary" type="submit">${icon('send')} Send</button>`}</div></form></div><aside class="card planner-preview"><div class="between"><h3>${planner.proposal ? 'Proposed curriculum' : 'Current curriculum'}</h3><span class="tag ${planner.proposal ? 'complete' : ''}">${planner.proposal ? 'Review' : 'Saved'}</span></div>${planner.proposal ? proposalChanges(planner.proposal, state.project.curriculum) : ''}${(planner.proposal || state.project.curriculum).length ? proposalList(planner.proposal || state.project.curriculum) : '<p class="small muted">Your curriculum is empty.</p>'}${planner.proposal ? `<div class="notice small">Review the full outline before applying. Your existing lesson sessions and progress follow their stable IDs.</div><div class="row wrap" style="margin-top:12px">${button('Apply proposal', 'apply-proposal', { style: 'primary', i: 'check' })}${button('Discard', 'discard-proposal', { style: 'ghost' })}</div>` : ''}</aside></div></main>`;
}
const questionLabel = (kind) =>
  ({
    prediction: 'Prediction',
    check: 'Check your understanding',
    practice: 'Practice',
  })[kind] || 'Question';
function activeQuestion() {
  const message = state.session?.messages.at(-1);
  return message?.role === 'assistant' ? message.question : null;
}
function renderPlanPanel() {
  if (!state.planVisible) return '';
  const lesson = selectedLesson(),
    module = state.project.curriculum.find((m) => m.id === lesson?.moduleId);
  if (!module) return '';
  return `<aside class="session-plan"><div class="between"><span class="caps">${e(module.title)}</span>${ib('close', 'toggle-plan', 'Close plan')}</div><div class="plan-nodes">${module.lessons.map((l, i) => `${i ? '<span class="plan-arrow">↓</span>' : ''}<button class="plan-node ${l.id === lesson.id ? 'active' : ''}" data-action="lesson" data-id="${e(l.id)}" data-mode="${state.mode}">${e(l.title)}</button>`).join('')}</div></aside>`;
}
function answerDock(working) {
  const question = activeQuestion();
  const footer = `<div class="dock-stats"><span class="dock-source-count">${state.selectedMaterials.length ? `${state.selectedMaterials.length} sources` : ''}</span><span class="spacer"></span>${webSearchToggle()}${modelPill()}</div>`;
  if (!question)
    return `<div class="session-dock"><div class="dock-inner"><div class="dock-actions">${dockSetup()}</div><form id="lesson-form" class="opening-composer" data-drop-composer><textarea name="message" id="lesson-message" aria-label="Your message" placeholder="${state.session?.messages.length ? 'Ask a question or explain your thinking…' : state.mode === 'learn' ? 'What do you want to learn?' : 'What do you want to practice?'}" rows="1" ${working ? 'disabled' : ''}>${e(state.draft)}</textarea>${ib('paperclip', 'choose-materials', 'Attach files', {}, 'composer-attach')}${working ? `<button type="button" class="send-square stop-square" data-action="stop" aria-label="Stop">${icon('stop')}</button>` : `<button class="send-square" type="submit" aria-label="Submit message" ${!state.draft.trim() ? 'disabled' : ''}>${icon('enter')}</button>`}</form>${footer}</div></div>`;
  const hasChoices = question.options.length > 0;
  const options = hasChoices
    ? `<div class="quiz-options">${question.options.map((option, i) => `<label class="quiz-option ${state.answerChoice === String(i) ? 'selected' : ''}"><input type="radio" name="choice" value="${i}" ${state.answerChoice === String(i) ? 'checked' : ''} ${working ? 'disabled' : ''}><span class="markdown">${markdown(option)}</span></label>`).join('')}<label class="quiz-option unknown ${state.answerChoice === 'unknown' ? 'selected' : ''}"><input type="radio" name="choice" value="unknown" ${state.answerChoice === 'unknown' ? 'checked' : ''} ${working ? 'disabled' : ''}><span>I don't know</span></label></div>`
    : '';
  return `<div class="session-dock question-dock-wrap"><div class="dock-inner"><div class="dock-actions">${dockSetup()}</div><form id="lesson-form" class="question-dock" data-drop-composer><section class="question-body"><div class="caps question-kind">${questionLabel(question.kind)}</div><div class="markdown question-prompt">${markdown(question.prompt)}</div>${options}</section><div class="confidence-row"><label class="caps" for="confidence">Confidence</label><input id="confidence" name="confidence" type="range" min="0" max="100" value="${state.confidence}" style="--confidence:${state.confidence}%" ${working ? 'disabled' : ''}><output id="confidence-value">${state.confidence}%</output></div><div class="thinking-wrap"><label class="caps" for="lesson-message">Your thinking</label><textarea id="lesson-message" name="message" aria-label="Your message" placeholder="${hasChoices ? 'Why this answer? Whatever comes to mind.' : 'Work through your answer. Whatever comes to mind.'}" ${working ? 'disabled' : ''}>${e(state.draft)}</textarea><div class="thinking-footer"><span class="small muted">↵ submits · ⇧↵ newline</span><span class="spacer"></span>${ib('paperclip', 'choose-materials', 'Attach files', {}, 'composer-attach')}${working ? button('Stop', 'stop', { i: 'stop', style: 'danger' }) : `<button class="button primary submit-answer" type="submit" ${!state.draft.trim() && !state.answerChoice ? 'disabled' : ''}>Submit answer</button>`}</div></div></form>${footer}</div></div>`;
}
function renderLesson() {
  const l = selectedLesson();
  if (!l) return renderOverview();
  const s = state.session,
    working = state.busy?.kind === 'session',
    last = s?.messages.at(-1);
  return `<main class="session-page"><div class="lesson-content" id="messages">${s?.messages.length ? s.messages.map((m) => messageHTML(m, { save: true, showQuestion: m.id !== last?.id || !activeQuestion() })).join('') : `<div class="lesson-empty"><h2>${state.mode === 'learn' ? 'New session' : 'New practice session'}</h2><p>${l.description ? e(l.description) : state.mode === 'learn' ? 'The teacher will open by probing what you already know.' : 'Describe what you want to practice or bring your own problem.'}</p>${!working ? button(state.mode === 'learn' ? 'Begin lesson' : 'Begin practice', 'begin-session', { style: 'ghost minor', i: 'arrow' }) : ''}</div>`}${working ? `<div class="thinking"><span class="spinner"></span>Thinking…</div>` : ''}</div>${answerDock(working)}${renderPlanPanel()}</main>`;
}
function renderMaterials() {
  const p = state.project;
  return `<main class="page"><div class="page-head"><h1>Study materials</h1><p>Everything here belongs to this project. Source files are copied into its folder.</p></div><section class="section"><div class="section-heading between"><h2>Source files</h2>${button('Add files', 'upload-material', { i: 'plus' })}</div><div id="dropzone" class="dropzone">${icon('paperclip')}<strong> Drop your files here or ${button('browse', 'upload-material', { style: 'ghost minor' })}</strong><p>Text, PDFs, and images can be referenced during a session. Files up to 20 MB.</p></div>${p.materials.length ? p.materials.map((m) => `<div class="file-row"><div class="file-icon">${icon('file')}</div><div class="grow"><strong class="truncate">${e(m.name)}</strong><small>${e(sizeLabel(m.size))} · ${e(dateLabel(m.createdAt))}</small></div><a class="icon-button" title="Download file" aria-label="Download ${e(m.name)}" href="${purl(`/materials/${m.id}`)}" download>${icon('download')}</a>${ib('trash', 'delete-material', 'Delete source file', { 'data-id': m.id }, 'danger')}</div>`).join('') : '<p class="small muted">No source files added.</p>'}</section><section class="section"><div class="section-heading between"><h2>Study notes</h2>${button('New note', 'new-note', { i: 'plus' })}</div>${p.generated.length ? p.generated.map((n) => `<div class="note-row"><div class="file-icon">${icon('note')}</div><button class="grow" style="text-align:left;padding:0" data-action="view-note" data-id="${e(n.id)}"><strong>${e(n.title)}</strong><small>${e(dateLabel(n.createdAt))}</small></button>${ib('edit', 'edit-note', 'Edit note', { 'data-id': n.id })}${ib('trash', 'delete-note', 'Delete note', { 'data-id': n.id }, 'danger')}</div>`).join('') : '<p class="small muted">Save an explanation from a lesson, or create a note of your own.</p>'}</section></main>`;
}
function renderData() {
  const p = state.project;
  return `<main class="page narrow">${pageHeader('Data & export', 'You own what minilearn keeps. Export, reset, or remove any category of data.')}<div class="row wrap" style="margin-bottom:22px">${button('Export .learn', 'export', { style: 'primary', i: 'export' })}${button('Clear selected data', 'clear-data', { i: 'trash' })}</div><div class="card">${Object.entries(
    categoryInfo,
  )
    .map(
      ([key, [name, description, i]]) =>
        `<div class="data-category">${icon(i)}<div class="grow"><h3>${name}</h3><p>${description}</p>${key === 'history' && p.sessions.length ? `<div style="margin-top:7px">${button('Manage sessions', 'manage-history', { style: 'minor', i: 'chat' })}</div>` : ''}</div><span class="small muted">${p.storage[key].files} files · ${e(sizeLabel(p.storage[key].bytes))}</span></div>`,
    )
    .join(
      '',
    )}</div><div class="section"><h2>Project</h2><div class="card"><div class="between"><div><h3>${e(p.name)}</h3><p class="small muted">Created ${e(dateLabel(p.createdAt))}</p></div>${button('Rename', 'rename-project', { i: 'edit' })}</div><div class="divider"></div><div class="between"><span class="caps">Local folder</span>${button('Copy path', 'copy-folder', { style: 'ghost minor' })}</div><p class="mono" style="overflow-wrap:anywhere;margin:5px 0">${e(p.folder)}</p><p class="small muted">This folder is independent. Move or share a full .learn export to open it elsewhere.</p></div></div><div class="notice">Model credentials are global to your installation, never included in a .learn file. Clearing local caches does not delete data retained independently by your AI provider.</div><div class="danger-zone between"><div><h3>Delete project</h3><p class="small muted">Permanently remove this project and everything inside it.</p></div>${button('Delete project', 'delete-project', { style: 'danger', i: 'trash' })}</div></main>`;
}
function render() {
  const viewKey = `${state.project?.id || ''}/${state.view}/${state.lessonId || ''}/${state.session?.id || ''}`;
  const previousPanel = $('.main-panel');
  const sameView = previousPanel?.dataset.viewKey === viewKey;
  const transcriptScroll = sameView ? $('#messages')?.scrollTop : null;
  const pageScroll = sameView ? $('.main-panel > .page')?.scrollTop : null;
  const sidebarScroll = $('.session-list')?.scrollTop;
  let content;
  const home =
    (!state.project && state.view !== 'draft') ||
    ['overview', 'graph', 'library'].includes(state.view);
  const draft = state.view === 'draft';
  if (home) content = renderHome();
  else if (draft) content = renderDraft();
  else
    switch (state.view) {
      case 'curriculum':
        content = renderCurriculum();
        break;
      case 'planner':
        content = renderPlanner();
        break;
      case 'lesson':
        content = renderLesson();
        break;
      case 'materials':
        content = renderMaterials();
        break;
      case 'data':
        content = renderData();
        break;
      default:
        content = renderHome();
    }
  root.innerHTML = `<div class="app-shell ${state.collapsed ? 'collapsed' : ''}">${renderSidebar()}<div class="main-panel ${home || draft ? 'canvas-panel' : ''}">${home || draft ? '' : topbar()}${content}</div></div>`;
  $('.main-panel').dataset.viewKey = viewKey;
  if (transcriptScroll != null && $('#messages'))
    $('#messages').scrollTop = transcriptScroll;
  if (pageScroll != null && $('.main-panel > .page'))
    $('.main-panel > .page').scrollTop = pageScroll;
  if (sidebarScroll != null && $('.session-list'))
    $('.session-list').scrollTop = sidebarScroll;
  if (home)
    mountGraph(state.project || emptyGraphProject, state.graph, {
      e,
      icon,
      button,
      ib,
      onDelete: deleteGraphNode,
    });
}
function scrollMessages(smooth = true) {
  requestAnimationFrame(() => {
    const transcript = $('#messages');
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  });
}

async function saveCurriculum(curriculum) {
  applyProject(
    await api(purl('/curriculum'), { method: 'PUT', data: { curriculum } }),
  );
  render();
}
function curriculumCopy() {
  return structuredClone(state.project.curriculum);
}
function moduleDialog(moduleId) {
  const m = state.project.curriculum.find((m) => m.id === moduleId);
  formDialog(
    m ? 'Edit module' : 'Add module',
    field(
      'Module title',
      'title',
      m?.title || '',
      'e.g. Vector spaces',
      'required maxlength="300"',
    ) +
      area(
        'Description (optional)',
        'description',
        m?.description || '',
        'What should this module cover?',
      ),
    async (values) => {
      const c = curriculumCopy();
      const value = {
        title: values.get('title'),
        description: values.get('description'),
      };
      if (m)
        Object.assign(
          c.find((x) => x.id === m.id),
          value,
        );
      else c.push({ ...value, lessons: [] });
      await saveCurriculum(c);
    },
    { submit: m ? 'Save changes' : 'Add module' },
  );
}
function lessonDialog(moduleId, lessonId, after) {
  const m = state.project.curriculum.find((m) => m.id === moduleId),
    l = m.lessons.find((l) => l.id === lessonId);
  formDialog(
    l ? 'Edit lesson' : 'Add lesson',
    field(
      'Lesson title',
      'title',
      l?.title || '',
      'e.g. Linear independence',
      'required maxlength="300"',
    ) +
      area(
        'Description / learning objectives (optional)',
        'description',
        l?.description || '',
        'What should you understand after this lesson?',
      ) +
      (l
        ? `<label class="field">Module<select name="module">${state.project.curriculum.map((x) => `<option value="${e(x.id)}" ${x.id === m.id ? 'selected' : ''}>${e(x.title)}</option>`).join('')}</select></label>`
        : ''),
    async (values) => {
      const c = curriculumCopy(),
        source = c.find((x) => x.id === m.id);
      const value = {
        title: values.get('title'),
        description: values.get('description'),
      };
      if (l) {
        const index = source.lessons.findIndex((x) => x.id === l.id);
        const target = values.get('module');
        if (target && target !== m.id) {
          const [moved] = source.lessons.splice(index, 1);
          c.find((x) => x.id === target).lessons.push({ ...moved, ...value });
        } else Object.assign(source.lessons[index], value);
      } else {
        const ix = after
          ? source.lessons.findIndex((x) => x.id === after) + 1
          : source.lessons.length;
        source.lessons.splice(ix, 0, value);
      }
      await saveCurriculum(c);
    },
    { submit: l ? 'Save changes' : 'Add lesson' },
  );
}
function pasteOutline() {
  formDialog(
    'Paste curriculum',
    `<p class="small muted">Paste a course outline, with headings for modules and bullets for lessons. You can also use Plan with AI for arbitrary prose.</p>${area('Outline', 'text', '', 'Module 1: Vector spaces\n- Vectors\n- Span\n- Linear independence\n\nModule 2: Linear transformations', 'required rows="9"')}`,
    async (values) => {
      const { curriculum } = await api(purl('/curriculum/parse'), {
        method: 'POST',
        data: { text: values.get('text') },
      });
      showDialog(
        'Review curriculum',
        `<p class="small muted">Review the parsed outline. You can edit it after adding it.</p>${proposalList(curriculum)}`,
        `<button type="button" class="button" id="append-outline">Append</button><button type="button" class="button primary" id="replace-outline">${state.project.curriculum.length ? 'Replace curriculum' : 'Use curriculum'}</button>`,
      );
      $('#append-outline', dialog).onclick = async () => {
        try {
          await saveCurriculum([...curriculumCopy(), ...curriculum]);
          closeDialog();
          go('curriculum');
        } catch (err) {
          toast(errorMessage(err), true);
        }
      };
      $('#replace-outline', dialog).onclick = async () => {
        try {
          const apply = async () => {
            await saveCurriculum(curriculum);
            closeDialog();
            go('curriculum');
          };
          if (state.project.curriculum.length) {
            confirmDialog(
              'Replace curriculum',
              'Replace the existing curriculum? Learning history will be kept.',
              apply,
              'Replace curriculum',
            );
            return;
          }
          await apply();
        } catch (err) {
          toast(errorMessage(err), true);
        }
      };
    },
    { submit: 'Preview outline', wide: true },
  );
}
function noteDialog(note = null, initialBody = '') {
  formDialog(
    note ? 'Edit study note' : 'Save study note',
    field(
      'Title',
      'title',
      note?.title || selectedLesson()?.title || '',
      'Name this note',
      'required maxlength="300"',
    ) +
      area(
        'Note (Markdown supported)',
        'body',
        note?.body || initialBody,
        'Write your notes…',
        'required rows="10"',
      ),
    async (values) => {
      applyProject(
        await api(purl(`/generated${note ? `/${note.id}` : ''}`), {
          method: note ? 'PUT' : 'POST',
          data: {
            title: values.get('title'),
            body: values.get('body'),
            lessonId: note?.lessonId || state.lessonId || null,
          },
        }),
      );
      render();
      toast('Study note saved.');
    },
    { submit: 'Save note', wide: true },
  );
}
function modelSetup(existing = null) {
  const provider = existing?.provider || 'openai';
  const keyHint = (value) =>
    value === 'custom'
      ? 'No key is needed for many local model servers.'
      : value === 'opencode-go'
        ? 'Use your OpenCode Go key. Go is designed for coding agents; general tutoring may be restricted.'
        : value === 'opencode'
          ? 'Use your OpenCode Console key. Requests are billed to your workspace credits.'
          : 'The key will be stored locally and never exported.';
  const options = [
    ['openai', 'OpenAI'],
    ['anthropic', 'Anthropic (Claude)'],
    ['google', 'Google Gemini'],
    ['opencode-go', 'OpenCode Go'],
    ['opencode', 'OpenCode (pay-as-you-go)'],
    ['custom', 'OpenAI-compatible / local model'],
  ]
    .map(
      ([id, name]) =>
        `<option value="${id}" ${provider === id ? 'selected' : ''}>${name}</option>`,
    )
    .join('');
  showSettings(
    `<h3 class="settings-section-title">Providers</h3><div class="settings-section-label">${existing ? 'Edit provider' : 'Add a provider'}</div><form id="connection-form"><label class="field">Provider<select name="provider" id="provider-select" ${existing ? 'disabled' : ''}>${options}</select></label><div id="custom-fields" class="${provider === 'custom' ? '' : 'hidden'}">${field('API base URL', 'baseUrl', existing?.baseUrl || 'http://localhost:11434/v1', 'http://localhost:11434/v1')}<div class="provider-presets" style="margin-top:-9px;margin-bottom:15px"><button type="button" data-preset="http://localhost:11434/v1">Ollama</button><button type="button" data-preset="http://localhost:1234/v1">LM Studio</button><button type="button" data-preset="http://localhost:8080/v1">llama.cpp</button></div></div><label class="field"><span id="key-label">API key${provider === 'custom' ? ' (optional)' : ''}</span><input class="input" type="password" name="apiKey" autocomplete="off" placeholder="${existing?.hasKey ? 'Leave blank to keep existing key' : 'Paste your API key'}"><span class="hint" id="key-hint">${keyHint(provider)}</span></label><label class="field">Model<div class="row"><input class="input grow" name="model" list="model-options" value="${e(existing?.model || '')}" placeholder="Choose or type model ID" required><button class="button" type="button" id="discover-models">Find models</button></div><datalist id="model-options"></datalist><span id="discovery-hint" class="hint">Use Find models to list available models, or enter an ID manually.</span></label><label class="field">Connection name (optional)<input class="input" name="label" value="${e(existing?.label || '')}" placeholder="e.g. Local Ollama"></label><div id="connect-error" class="error hidden"></div><div class="row" style="justify-content:flex-end"><button type="button" class="button ghost" id="back-models">Back</button><button type="submit" class="button primary">${icon('check')} Test &amp; connect</button></div><p class="small muted" style="margin:9px 0 0;text-align:right">Tests with a tiny model request (your provider's normal billing applies).</p></form>`,
  );
  const form = $('#connection-form', dialog);
  const data = () => {
    const d = Object.fromEntries(new FormData(form));
    d.provider = existing?.provider || d.provider;
    if (existing) {
      d.id = existing.id;
      if (!d.apiKey) delete d.apiKey;
    }
    if (d.provider !== 'custom') delete d.baseUrl;
    return d;
  };
  $('#provider-select', dialog).addEventListener('change', (event) => {
    const custom = event.target.value === 'custom';
    $('#custom-fields', dialog).classList.toggle('hidden', !custom);
    $('#key-label', dialog).textContent =
      `API key${custom ? ' (optional)' : ''}`;
    $('#key-hint', dialog).textContent = keyHint(event.target.value);
    form.elements.model.value = '';
    $('#model-options', dialog).innerHTML = '';
    $('#discovered-models', dialog)?.remove();
    $('#discovery-hint', dialog).textContent =
      'Use Find models to list available models, or enter an ID manually.';
  });
  $$('[data-preset]', dialog).forEach(
    (b) =>
      (b.onclick = () => {
        form.elements.baseUrl.value = b.dataset.preset;
      }),
  );
  const error = $('#connect-error', dialog);
  const showError = (err) => {
    error.textContent = errorMessage(err);
    error.classList.remove('hidden');
  };
  $('#discover-models', dialog).onclick = async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Finding…';
    error.classList.add('hidden');
    try {
      const { models } = await api('/api/connections/discover', {
        method: 'POST',
        data: data(),
      });
      $('#model-options', dialog).innerHTML = models
        .map((m) => `<option value="${e(m.id)}">${e(m.name)}</option>`)
        .join('');
      $('#discovered-models', dialog)?.remove();
      if (!form.elements.model.value && models.length === 1)
        form.elements.model.value = models[0].id;
      const hint = $('#discovery-hint', dialog);
      hint.textContent = models.length
        ? `${models.length} ${models.length === 1 ? 'model' : 'models'} found. Select one below, or enter an ID.`
        : 'No models listed. You can enter the model ID manually.';
      if (models.length) {
        const choices = document.createElement('select');
        choices.id = 'discovered-models';
        choices.setAttribute('aria-label', 'Available models');
        choices.innerHTML =
          '<option value="">Select an available model</option>' +
          models
            .map(
              (m) =>
                `<option value="${e(m.id)}" ${form.elements.model.value === m.id ? 'selected' : ''}>${e(m.name === m.id ? m.id : `${m.name} · ${m.id}`)}</option>`,
            )
            .join('');
        choices.onchange = () => {
          if (choices.value) form.elements.model.value = choices.value;
        };
        hint.after(choices);
        if (models.length > 1) choices.focus();
        else form.elements.model.focus();
      }
    } catch (err) {
      showError(err);
      $('#discovery-hint', dialog).textContent =
        'If model discovery is not supported, type the model ID manually.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Find models';
    }
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    btn.textContent = 'Testing…';
    error.classList.add('hidden');
    try {
      await api('/api/connections', { method: 'POST', data: data() });
      await loadConnections();
      closeDialog();
      render();
      toast('Model connected. You’re ready to learn.');
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('check')} Test & connect`;
    }
  });
  $('#back-models', dialog).onclick = () => modelDialog();
}
function modelDialog() {
  showSettings(
    `<h3 class="settings-section-title">Providers</h3><div class="settings-section-label">Model API keys</div>${state.connections.connections.map((c) => `<div class="settings-provider-row"><div class="grow"><div class="provider-name">${e(c.label)}</div><div class="small muted truncate">${e(c.model)}</div></div>${c.id === state.connections.activeConnection ? '<span class="muted small">Active</span>' : button('Use', 'activate-model', { style: 'minor', data: { 'data-id': c.id } })}${ib('edit', 'edit-model', 'Edit connection', { 'data-id': c.id })}${ib('trash', 'delete-model', 'Remove connection', { 'data-id': c.id }, 'danger')}</div>`).join('')}<button class="settings-add-provider" data-action="add-model">${icon('plus')} Add a provider</button><div class="settings-rule"></div><p class="settings-note">Model keys stay in this installation. They are never included in exported projects.</p>`,
  );
}
function openModelPicker(target) {
  const control = target.closest('.model-control');
  const wasOpen = Boolean($('.model-popover', control));
  $$('.model-popover').forEach((p) => p.remove());
  if (wasOpen) return;
  const pop = document.createElement('div');
  pop.className = 'model-popover';
  pop.innerHTML = `<input class="model-search" aria-label="Search models" placeholder="Search models…"><div class="model-picker-list"></div><button class="model-picker-footer" data-action="add-model">${state.connections.connections.length ? '+ Add a provider' : 'No models — add a provider key in Settings'}</button>`;
  control.append(pop);
  const input = $('input', pop),
    list = $('.model-picker-list', pop);
  const update = () => {
    const query = input.value.toLowerCase().trim();
    const models = state.connections.connections.filter((c) =>
      `${c.label} ${c.model}`.toLowerCase().includes(query),
    );
    list.innerHTML = models.length
      ? models
          .map(
            (c) =>
              `<button class="model-picker-row" data-action="pick-model" data-id="${e(c.id)}"><span class="grow truncate">${e(c.model)}</span>${c.id === state.connections.activeConnection ? icon('check') : ''}</button>`,
          )
          .join('')
      : '<div class="model-picker-empty">No models match.</div>';
  };
  input.addEventListener('input', update);
  update();
  input.focus();
}

function newProjectDialog() {
  formDialog(
    'New learning project',
    field(
      'Project name',
      'name',
      '',
      'e.g. Linear Algebra',
      'required maxlength="120"',
    ),
    async (values) => {
      const p = await api('/api/projects', {
        method: 'POST',
        data: { name: values.get('name') },
      });
      await loadProjects();
      await openProject(p.id);
    },
    { submit: 'Create project' },
  );
}
function projectDialog() {
  showDialog(
    'Projects',
    `${state.projects.map((p) => `<button class="project-menu-row" data-action="open-project" data-id="${e(p.id)}">${icon('folder')}<span class="grow truncate">${e(p.name)}</span>${p.id === state.project?.id ? icon('check') : ''}</button>`).join('') || '<p class="muted small">No projects yet.</p>'}`,
    `${button('Import .learn', 'import', { i: 'import' })}${button('New project', 'new-project', { i: 'folderPlus', style: 'primary' })}`,
  );
}
function newDraft(mode) {
  if (!canNavigate()) return;
  state.view = 'draft';
  state.homeMode = mode;
  state.session = null;
  state.lessonId = null;
  state.homeDraft = '';
  state.selectedMaterials = [];
  state.practiceNodes = [];
  state.planVisible = false;
  if (window.innerWidth < 680) state.collapsed = true;
  hashLocation();
  render();
  $('#home-form textarea')?.focus();
}
async function openSession(sessionId) {
  if (!canNavigate()) return;
  const s = state.project.sessions.find((v) => v.id === sessionId);
  if (!s) return;
  state.lessonId = s.lessonId;
  state.mode = s.mode;
  state.view = 'lesson';
  state.session = await api(purl(`/sessions/${s.id}`));
  state.selectedMaterials = state.session.materialIds.filter((id) =>
    state.project.materials.some((m) => m.id === id),
  );
  state.draft = '';
  state.answerChoice = '';
  state.confidence = 50;
  state.planVisible = false;
  if (state.sessionFilter !== 'all') state.sessionFilter = s.mode;
  if (window.innerWidth < 680) state.collapsed = true;
  hashLocation();
  render();
  scrollMessages(false);
}
function choosePracticeNodes() {
  if (!state.project) {
    projectDialog();
    return;
  }
  const nodes = state.project.graph.nodes;
  showDialog(
    'Pick nodes',
    nodes.length
      ? nodes
          .map(
            (n) =>
              `<label class="check"><input type="checkbox" name="practice-node" value="${e(n.id)}" ${state.practiceNodes.includes(n.id) ? 'checked' : ''}><span><strong>${e(n.title)}</strong><small>${e(n.statement)}</small></span></label>`,
          )
          .join('')
      : '<p class="muted">No concepts in your knowledge graph yet.</p>',
    `<button class="button primary" type="button" id="apply-practice-nodes">Done</button>`,
    true,
  );
  $('#apply-practice-nodes', dialog).onclick = () => {
    state.practiceNodes = $$('input[name=practice-node]:checked', dialog).map(
      (el) => el.value,
    );
    closeDialog();
    render();
  };
}
async function startLessonSession(lessonId, mode, message, materialIds = []) {
  state.lessonId = lessonId;
  state.mode = mode;
  state.view = 'lesson';
  state.session = null;
  state.selectedMaterials = materialIds;
  state.draft = '';
  state.answerChoice = '';
  state.confidence = 50;
  state.planVisible = false;
  state.homeDraft = '';
  state.practiceNodes = [];
  if (state.sessionFilter !== 'all') state.sessionFilter = mode;
  const lesson = selectedLesson();
  if (lesson) state.folded.delete(lesson.moduleId);
  if (window.innerWidth < 680) state.collapsed = true;
  closeDialog();
  hashLocation();
  render();
  await turn(message);
}
async function startTopic(raw) {
  if (state.busy) return;
  const chosen =
    state.project?.graph.nodes.filter((n) =>
      state.practiceNodes.includes(n.id),
    ) || [];
  const topic =
    String(raw || '').trim() ||
    (chosen.length ? chosen.map((n) => n.title).join(', ') : '');
  if (!topic) return;
  state.homeDraft = topic;
  if (!activeModel()) {
    modelSetup();
    return;
  }
  const mode = state.homeMode,
    materials = [...state.selectedMaterials];
  const message =
    topic +
    (mode === 'practice' && chosen.length
      ? `\n\nPractice these knowledge concepts:\n${chosen.map((n) => `- ${n.title}: ${n.statement}`).join('\n')}`
      : '');
  const existing = lessons().find(
    (l) => l.title.trim().toLowerCase() === topic.toLowerCase(),
  );
  if (existing) {
    await startLessonSession(existing.id, mode, message, materials);
    return;
  }
  if (!state.project) {
    formDialog(
      'Create a learning project',
      `<p>Every session belongs to an independent project.</p>${field('Project name', 'name', topic.slice(0, 120), 'e.g. Linear Algebra', 'required maxlength="120"')}${field('First lesson', 'title', topic.slice(0, 300), 'Topic', 'required maxlength="300"')}`,
      async (values) => {
        const p = await api('/api/projects', {
          method: 'POST',
          data: { name: values.get('name') },
        });
        await loadProjects();
        await openProject(p.id);
        const saved = await api(purl('/curriculum'), {
          method: 'PUT',
          data: {
            curriculum: [
              { title: 'Topics', lessons: [{ title: values.get('title') }] },
            ],
          },
        });
        applyProject(saved);
        await startLessonSession(
          saved.curriculum[0].lessons[0].id,
          mode,
          message,
        );
      },
      { submit: 'Create & start' },
    );
    return;
  }
  const modules = state.project.curriculum;
  formDialog(
    'Add topic to curriculum',
    `<p>Choose where this session belongs in your project.</p>${field('Lesson title', 'title', topic.slice(0, 300), 'Topic', 'required maxlength="300"')}<label class="field">Module<select name="module">${modules.map((m) => `<option value="${e(m.id)}">${e(m.title)}</option>`).join('')}<option value="new">New module</option></select></label><div id="new-module-field" ${modules.length ? 'class="hidden"' : ''}>${field('New module name', 'moduleName', 'Topics', 'Module name', 'maxlength="300"')}</div><label class="field" id="topic-position">Position<select name="after"><option value="end">At end</option></select></label>`,
    async (values) => {
      const curriculum = curriculumCopy();
      let target = curriculum.find((m) => m.id === values.get('module'));
      if (!target) {
        const title = String(values.get('moduleName') || '').trim();
        if (!title) throw Error('Enter a module name.');
        target = { title, lessons: [] };
        curriculum.push(target);
      }
      const lesson = { title: values.get('title') },
        after = values.get('after');
      const idx =
        after === 'start'
          ? 0
          : after === 'end'
            ? target.lessons.length
            : target.lessons.findIndex((l) => l.id === after) + 1;
      target.lessons.splice(idx, 0, lesson);
      const moduleIdx = curriculum.indexOf(target);
      const saved = await api(purl('/curriculum'), {
        method: 'PUT',
        data: { curriculum },
      });
      applyProject(saved);
      await startLessonSession(
        saved.curriculum[moduleIdx].lessons[idx].id,
        mode,
        message,
        materials,
      );
    },
    { submit: 'Add & start' },
  );
  const form = $('#modal-form', dialog);
  const updatePositions = () => {
    const module = modules.find((m) => m.id === form.elements.module.value);
    $('#new-module-field', dialog).classList.toggle('hidden', Boolean(module));
    $('#topic-position', dialog).classList.toggle('hidden', !module);
    form.elements.after.innerHTML =
      '<option value="end">At end</option><option value="start">At beginning</option>' +
      (module?.lessons || [])
        .map((l) => `<option value="${e(l.id)}">After ${e(l.title)}</option>`)
        .join('');
  };
  form.elements.module.addEventListener('change', updatePositions);
  updatePositions();
}
function sessionOptions() {
  showDialog(
    'Session options',
    `<div class="stack">${button('New session', 'new-session', { i: 'plus' })}${button(state.project.progress[state.lessonId] === 'complete' ? 'Lesson complete' : 'Mark complete', 'progress', { i: 'flag' })}${button(state.mode === 'learn' ? 'Switch to practice' : 'Switch to teaching', 'mode', { i: state.mode === 'learn' ? 'dumbbell' : 'book', data: { 'data-mode': state.mode === 'learn' ? 'practice' : 'learn' } })}${state.session ? button('Delete session', 'delete-session', { i: 'trash', style: 'danger', data: { 'data-id': state.session.id } }) : ''}</div>`,
  );
}
function chooseMaterials() {
  const p = state.project;
  if (!p) {
    projectDialog();
    return;
  }
  showDialog(
    'Session sources',
    `<p class="small muted">Select files the tutor should receive with your messages. Only selected files are sent to your AI provider.</p>${p.materials.length ? p.materials.map((m) => `<label class="check"><input type="checkbox" name="source" value="${e(m.id)}" ${state.selectedMaterials.includes(m.id) ? 'checked' : ''}><span><strong>${e(m.name)}</strong><small>${e(sizeLabel(m.size))}</small></span></label>`).join('') : '<p class="muted">No source files in this project yet.</p>'}`,
    `${button('Add files', 'upload-material', { style: 'ghost', i: 'plus' })}<button type="button" class="button primary" id="apply-sources">Done</button>`,
  );
  $('#apply-sources', dialog).onclick = () => {
    state.selectedMaterials = $$('input[name=source]:checked', dialog).map(
      (x) => x.value,
    );
    closeDialog();
    render();
  };
}
function categoriesDialog(type) {
  const exporting = type === 'export';
  formDialog(
    exporting ? 'Export project' : 'Clear selected data',
    `<p>${exporting ? 'Choose which categories to include in the portable .learn file.' : 'Choose exactly what to remove from this project. This cannot be undone.'}</p>${Object.entries(
      categoryInfo,
    )
      .map(
        ([key, [title, description]]) =>
          `<label class="check"><input type="checkbox" name="category" value="${key}" ${exporting ? 'checked' : ''}><span><strong>${title}</strong><small>${description}</small></span></label>`,
      )
      .join(
        '',
      )}${exporting ? '<p class="notice small">Credentials are never included. You can share only curriculum and materials to give someone a fresh start.</p>' : ''}`,
    async (values) => {
      const categories = values.getAll('category');
      if (!categories.length) throw new Error('Select at least one category.');
      if (exporting) {
        const exportUrl = purl(
          `/export?include=${encodeURIComponent(categories.join(','))}`,
        );
        if (window.__MINILEARN_DESKTOP__) {
          const head = await fetch(exportUrl, { method: 'HEAD' });
          if (!head.ok) {
            const res = await fetch(exportUrl);
            const error = await res.json().catch(() => ({}));
            throw new Error(error.error || 'Export failed.');
          }
          const link = document.createElement('a');
          link.href = exportUrl;
          link.download = `${state.project.name}.learn`;
          link.hidden = true;
          (dialog.open ? dialog : document.body).appendChild(link);
          link.click();
          link.remove();
          toast('Project exported.');
          return;
        }
        const res = await fetch(exportUrl);
        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Export failed.');
        }
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${state.project.name}.learn`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        toast('Project exported.');
      } else {
        applyProject(
          await api(purl('/data'), { method: 'POST', data: { categories } }),
        );
        render();
        toast('Selected data cleared.');
      }
    },
    {
      submit: exporting ? 'Export .learn' : 'Clear selected data',
      danger: !exporting,
    },
  );
}
function historyDialog() {
  const curriculumIds = new Set(lessons().map((l) => l.id));
  showDialog(
    'Learning sessions',
    `<p class="small muted">Review or delete any session, including sessions from lessons removed from the curriculum.</p>${state.project.sessions.length ? state.project.sessions.map((s) => `<div class="file-row"><span class="file-icon">${icon('chat')}</span><button class="grow" data-action="view-session" data-id="${e(s.id)}" style="text-align:left;padding:0"><strong>${e(s.lessonTitle)}</strong><small>${s.mode === 'learn' ? 'Learn' : 'Practice'} · ${e(dateLabel(s.updatedAt))}${curriculumIds.has(s.lessonId) ? '' : ' · Archived lesson'}</small></button>${ib('trash', 'delete-session', 'Delete session', { 'data-id': s.id }, 'danger')}</div>`).join('') : '<p class="muted">No learning sessions saved.</p>'}`,
  );
}
async function makeSession() {
  const session = await api(purl('/sessions'), {
    method: 'POST',
    data: { lessonId: state.lessonId, mode: state.mode },
  });
  await refreshProject();
  state.session = session;
  hashLocation();
  state.selectedMaterials = [];
  render();
  return session;
}
async function turn(message, draftText = message) {
  if (state.busy) return;
  if (!activeModel()) {
    state.draft = draftText;
    modelSetup();
    return;
  }
  if (!message.trim()) return;
  state.draft = draftText;
  const selected = [...state.selectedMaterials];
  if (!state.session) {
    await makeSession();
    state.selectedMaterials = selected;
  }
  const controller = new AbortController();
  state.busy = { kind: 'session', controller };
  state.draft = '';
  render();
  scrollMessages();
  try {
    state.session = await api(purl(`/sessions/${state.session.id}/turn`), {
      method: 'POST',
      data: {
        message,
        materialIds: state.selectedMaterials,
        webSearch: state.webSearch,
      },
      signal: controller.signal,
    });
    await refreshProject();
    state.answerChoice = '';
    state.confidence = 50;
  } catch (err) {
    state.draft = draftText;
    toast(errorMessage(err), err.name !== 'AbortError');
  } finally {
    state.busy = null;
    render();
    scrollMessages();
    $('#lesson-form textarea')?.focus();
  }
}
async function plan(message) {
  if (state.busy) return;
  if (!activeModel()) {
    modelSetup();
    return;
  }
  if (!message.trim()) return;
  const controller = new AbortController();
  state.busy = { kind: 'planner', controller };
  state.plannerDraft = '';
  render();
  try {
    state.project.planner = await api(purl('/planner'), {
      method: 'POST',
      data: { message, webSearch: state.webSearch },
      signal: controller.signal,
    });
    await refreshProject();
  } catch (err) {
    state.plannerDraft = message;
    toast(errorMessage(err), err.name !== 'AbortError');
  } finally {
    state.busy = null;
    render();
    $('#planner-form textarea')?.focus();
  }
}
async function deleteGraphNode(id) {
  const node = state.project.graph.nodes.find((n) => n.id === id);
  if (!node) return;
  confirmDialog(
    'Delete knowledge concept',
    `Remove “${node.title}” and its connections from the knowledge map?`,
    async () => {
      applyProject(await api(purl(`/graph/${id}`), { method: 'DELETE' }));
      state.graph.selected = null;
      state.graph.fit = true;
      render();
    },
  );
}
async function uploadFiles(files, attach = false) {
  if (!state.project) {
    projectDialog();
    return;
  }
  if (!canNavigate()) return;
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      toast(`${file.name} exceeds the 20 MB limit.`, true);
      continue;
    }
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const oldIds = new Set(state.project.materials.map((m) => m.id));
    applyProject(
      await api(purl('/materials'), {
        method: 'POST',
        data: { name: file.name, mime: file.type, data },
      }),
    );
    if (attach)
      state.selectedMaterials.push(
        ...state.project.materials
          .filter((m) => !oldIds.has(m.id))
          .map((m) => m.id),
      );
  }
  closeDialog();
  render();
  toast('Source files added.');
}

document.addEventListener('submit', (event) => {
  if (event.target.id === 'home-form') {
    event.preventDefault();
    startTopic(event.target.elements.topic.value).catch((err) =>
      toast(errorMessage(err), true),
    );
  }
  if (event.target.id === 'lesson-form') {
    event.preventDefault();
    const draft = event.target.elements.message.value;
    let message = draft;
    const q = activeQuestion();
    if (q && state.answerChoice) {
      const choice =
        state.answerChoice === 'unknown'
          ? "I don't know"
          : q.options[Number(state.answerChoice)];
      if (choice)
        message = `Answer: ${choice}\nConfidence: ${state.confidence}%${draft.trim() ? `\nMy thinking: ${draft}` : ''}`;
    } else if (q && draft.trim() && !q.options.length)
      message = `My answer: ${draft}\nConfidence: ${state.confidence}%`;
    turn(message, draft).catch((err) => toast(errorMessage(err), true));
  }
  if (event.target.id === 'planner-form') {
    event.preventDefault();
    plan(event.target.elements.message.value).catch((err) =>
      toast(errorMessage(err), true),
    );
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'session-search') {
    state.sidebarQuery = event.target.value;
    $('#sidebar-rows').innerHTML = sessionRows();
  }
  if (event.target.closest('#home-form') && event.target.name === 'topic') {
    state.homeDraft = event.target.value;
    const btn = $('#home-form button[type=submit]');
    if (btn)
      btn.disabled = !state.homeDraft.trim() && !state.practiceNodes.length;
  }
  if (event.target.id === 'confidence') {
    state.confidence = Number(event.target.value);
    event.target.style.setProperty('--confidence', `${state.confidence}%`);
    $('#confidence-value').textContent = `${state.confidence}%`;
  }
  if (event.target.closest('#lesson-form') && event.target.name === 'message') {
    state.draft = event.target.value;
    const btn = $('#lesson-form button[type=submit]');
    if (btn) btn.disabled = !state.draft.trim() && !state.answerChoice;
  }
  if (event.target.closest('#planner-form') && event.target.name === 'message')
    state.plannerDraft = event.target.value;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('.model-popover')) {
    $$('.model-popover').forEach((p) => p.remove());
    return;
  }
  if (
    event.key === 'Enter' &&
    !event.isComposing &&
    event.target.tagName === 'TEXTAREA'
  ) {
    const form = event.target.closest('form');
    if (
      (['home-form', 'lesson-form'].includes(form?.id) && !event.shiftKey) ||
      (form?.id === 'planner-form' && (event.metaKey || event.ctrlKey))
    ) {
      event.preventDefault();
      form.requestSubmit();
    }
  }
});
document.addEventListener('change', async (event) => {
  try {
    if (
      event.target.name === 'choice' &&
      event.target.closest('#lesson-form')
    ) {
      state.answerChoice = event.target.value;
      $$('.quiz-option').forEach((row) =>
        row.classList.toggle('selected', $('input', row).checked),
      );
      const btn = $('#lesson-form button[type=submit]');
      if (btn) btn.disabled = !state.draft.trim() && !state.answerChoice;
    }
    if (event.target.id === 'session-select' && event.target.value) {
      if (!canNavigate()) {
        render();
        return;
      }
      state.session = await api(purl(`/sessions/${event.target.value}`));
      state.selectedMaterials = state.session.materialIds.filter((id) =>
        state.project.materials.some((m) => m.id === id),
      );
      state.draft = '';
      render();
      scrollMessages(false);
    }
  } catch (err) {
    toast(errorMessage(err), true);
  }
});
$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 140 * 1024 * 1024)
      throw new Error('This .learn file is too large.');
    const data = JSON.parse(await file.text());
    const p = await api('/api/projects/import', { method: 'POST', data });
    await loadProjects();
    await openProject(p.id);
    toast('Project imported.');
  } catch (err) {
    toast(errorMessage(err), true);
  }
});
$('#material-file').addEventListener('change', (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  const attach = state.attachUpload;
  state.attachUpload = false;
  if (files.length)
    uploadFiles(files, attach).catch((err) => toast(errorMessage(err), true));
});
document.addEventListener('dragover', (event) => {
  const zone = event.target.closest(
    '#dropzone,[data-drop-composer],.home-workspace',
  );
  if (zone && event.dataTransfer?.types?.includes('Files')) {
    event.preventDefault();
    zone.classList.add('dragging');
  }
});
document.addEventListener('dragleave', (event) =>
  event.target
    .closest('#dropzone,[data-drop-composer],.home-workspace')
    ?.classList.remove('dragging'),
);
document.addEventListener('drop', (event) => {
  const zone = event.target.closest(
    '#dropzone,[data-drop-composer],.home-workspace',
  );
  if (zone && event.dataTransfer?.files?.length) {
    event.preventDefault();
    zone.classList.remove('dragging');
    uploadFiles([...event.dataTransfer.files], zone.id !== 'dropzone').catch(
      (err) => toast(errorMessage(err), true),
    );
  }
});
document.addEventListener('click', async (event) => {
  if (!event.target.closest('.model-control'))
    $$('.model-popover').forEach((p) => p.remove());
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const {
    action,
    id,
    view,
    module: moduleId,
    after,
    direction,
    mode,
  } = target.dataset;
  try {
    switch (action) {
      case 'close-dialog':
        closeDialog();
        break;
      case 'toggle-web-search':
        if (!state.busy) {
          state.webSearch = !state.webSearch;
          for (const toggle of $$('[data-action="toggle-web-search"]')) {
            toggle.classList.toggle('active', state.webSearch);
            toggle.setAttribute('aria-pressed', String(state.webSearch));
          }
        }
        break;
      case 'library':
      case 'projects':
        if (canNavigate()) projectDialog();
        break;
      case 'home':
        if (canNavigate()) {
          state.graph.view = 'graph';
          state.graph.fit = true;
          go('overview');
        }
        break;
      case 'new-project':
        newProjectDialog();
        break;
      case 'open-project':
        closeDialog();
        await openProject(id);
        break;
      case 'import':
        if (canNavigate()) $('#import-file').click();
        break;
      case 'go':
        closeDialog();
        go(view);
        break;
      case 'lesson':
        closeDialog();
        await selectLesson(id, mode || 'learn');
        break;
      case 'open-session':
        await openSession(id);
        break;
      case 'draft':
        newDraft(mode);
        break;
      case 'home-mode':
        state.homeMode = mode;
        render();
        break;
      case 'session-filter':
        state.sessionFilter = mode;
        render();
        break;
      case 'practice-nodes':
        choosePracticeNodes();
        break;
      case 'graph-materials':
        if (state.project) {
          state.attachUpload = false;
          $('#material-file').click();
        } else projectDialog();
        break;
      case 'toggle-plan':
        state.planVisible = !state.planVisible;
        render();
        break;
      case 'session-options':
        sessionOptions();
        break;
      case 'mode':
        closeDialog();
        await selectLesson(state.lessonId, mode);
        break;
      case 'toggle-sidebar':
        state.collapsed = !state.collapsed;
        render();
        break;
      case 'fold-module':
        if (state.folded.has(id)) state.folded.delete(id);
        else state.folded.add(id);
        render();
        break;
      case 'models':
        modelDialog();
        break;
      case 'settings-data':
        closeDialog();
        go('data');
        break;
      case 'model-picker':
        openModelPicker(target);
        break;
      case 'pick-model':
        state.connections = await api(`/api/connections/${id}/activate`, {
          method: 'POST',
        });
        render();
        toast('Model switched.');
        break;
      case 'add-model':
        modelSetup();
        break;
      case 'edit-model':
        modelSetup(state.connections.connections.find((c) => c.id === id));
        break;
      case 'activate-model':
        state.connections = await api(`/api/connections/${id}/activate`, {
          method: 'POST',
        });
        modelDialog();
        render();
        toast('Model switched.');
        break;
      case 'delete-model':
        confirmDialog(
          'Remove connection',
          'Remove this model connection and its locally stored API key?',
          async () => {
            state.connections = await api(`/api/connections/${id}`, {
              method: 'DELETE',
            });
            render();
          },
          'Remove',
        );
        break;
      case 'add-module':
        moduleDialog();
        break;
      case 'edit-module':
        moduleDialog(id);
        break;
      case 'add-lesson':
        lessonDialog(moduleId, null, after);
        break;
      case 'edit-lesson':
        lessonDialog(moduleId, id);
        break;
      case 'move-module': {
        const c = curriculumCopy(),
          i = c.findIndex((m) => m.id === id),
          n = i + Number(direction);
        if (n >= 0 && n < c.length) {
          [c[i], c[n]] = [c[n], c[i]];
          await saveCurriculum(c);
        }
        break;
      }
      case 'move-lesson': {
        const c = curriculumCopy(),
          m = c.find((m) => m.id === moduleId),
          i = m.lessons.findIndex((l) => l.id === id),
          n = i + Number(direction);
        if (n >= 0 && n < m.lessons.length) {
          [m.lessons[i], m.lessons[n]] = [m.lessons[n], m.lessons[i]];
          await saveCurriculum(c);
        }
        break;
      }
      case 'delete-module': {
        const m = state.project.curriculum.find((m) => m.id === id);
        confirmDialog(
          'Delete module',
          `Remove “${m.title}” and its lessons from the curriculum? Existing learning sessions are retained.`,
          () => saveCurriculum(curriculumCopy().filter((x) => x.id !== id)),
        );
        break;
      }
      case 'delete-lesson': {
        const l = lessons().find((x) => x.id === id);
        confirmDialog(
          'Delete lesson',
          `Remove “${l.title}” from the curriculum? Existing sessions remain in project history.`,
          () => {
            const c = curriculumCopy();
            c.find((x) => x.id === moduleId).lessons = c
              .find((x) => x.id === moduleId)
              .lessons.filter((x) => x.id !== id);
            return saveCurriculum(c);
          },
        );
        break;
      }
      case 'paste-outline':
        pasteOutline();
        break;
      case 'apply-proposal':
        applyProject(await api(purl('/planner/apply'), { method: 'POST' }));
        render();
        toast('Curriculum updated.');
        break;
      case 'discard-proposal':
        applyProject(
          await api(purl('/planner/proposal'), { method: 'DELETE' }),
        );
        render();
        break;
      case 'clear-planner':
        confirmDialog(
          'Clear curriculum conversation',
          'Delete the planning conversation and any unapplied proposal? Your saved curriculum is unchanged.',
          async () => {
            applyProject(await api(purl('/planner'), { method: 'DELETE' }));
            render();
          },
        );
        break;
      case 'new-session':
        if (canNavigate()) {
          closeDialog();
          await makeSession();
          state.draft = '';
          state.answerChoice = '';
          state.confidence = 50;
          render();
        }
        break;
      case 'begin-session':
        await turn(
          state.mode === 'learn'
            ? 'Teach me this lesson, starting from my current understanding.'
            : 'Begin a practice session. Give me the first problem.',
        );
        break;
      case 'stop':
        if (state.busy) {
          const operation = state.busy;
          await api(purl('/cancel'), { method: 'POST' }).catch(() => {});
          operation.controller.abort();
        }
        break;
      case 'progress': {
        const status = state.project.progress[state.lessonId];
        formDialog(
          'Lesson progress',
          `<p>Choose how this lesson should be marked.</p><label class="field">Status<select name="status"><option value="none" ${!status ? 'selected' : ''}>Not started</option><option value="started" ${status === 'started' ? 'selected' : ''}>In progress</option><option value="complete" ${status === 'complete' ? 'selected' : ''}>Complete</option></select></label>`,
          async (values) => {
            applyProject(
              await api(purl(`/progress/${state.lessonId}`), {
                method: 'PUT',
                data: {
                  status:
                    values.get('status') === 'none'
                      ? null
                      : values.get('status'),
                },
              }),
            );
            render();
          },
        );
        break;
      }
      case 'delete-session':
        confirmDialog(
          'Delete learning session',
          'Delete this conversation and knowledge claims derived exclusively from it? Saved study notes are kept.',
          async () => {
            applyProject(
              await api(purl(`/sessions/${id}`), { method: 'DELETE' }),
            );
            if (state.view === 'lesson') {
              state.session = null;
              await selectLesson(state.lessonId, state.mode);
            } else {
              render();
              toast('Session deleted.');
            }
          },
        );
        break;
      case 'manage-history':
        historyDialog();
        break;
      case 'delete-exchange':
        confirmDialog(
          'Delete exchange',
          'Remove this reply, its preceding message, and knowledge claims derived exclusively from the exchange? Saved notes are kept.',
          async () => {
            state.session = await api(
              purl(`/sessions/${state.session.id}/exchanges/${id}`),
              { method: 'DELETE' },
            );
            await refreshProject();
            render();
          },
        );
        break;
      case 'view-session': {
        const s = await api(purl(`/sessions/${id}`));
        showDialog(
          s.lessonTitle,
          s.messages.length
            ? s.messages.map((m) => messageHTML(m)).join('')
            : '<p class="muted">This session is empty.</p>',
          button('Back to sessions', 'manage-history', { i: 'back' }),
          true,
        );
        break;
      }
      case 'copy-folder':
        await navigator.clipboard.writeText(state.project.folder);
        toast('Folder path copied.');
        break;
      case 'choose-materials':
        chooseMaterials();
        break;
      case 'upload-material':
        state.attachUpload =
          dialog.open &&
          $('#dialog-title', dialog)?.textContent === 'Session sources';
        $('#material-file').click();
        break;
      case 'delete-material': {
        const m = state.project.materials.find((v) => v.id === id);
        confirmDialog(
          'Delete source file',
          `Permanently remove “${m.name}” from this project?`,
          async () => {
            applyProject(
              await api(purl(`/materials/${id}`), { method: 'DELETE' }),
            );
            render();
          },
        );
        break;
      }
      case 'new-note':
        noteDialog();
        break;
      case 'save-message': {
        const m = state.session?.messages.find((v) => v.id === id);
        if (m) {
          const links = (m.webSearch?.sources || [])
            .map((source, i) => {
              const url = safeSourceURL(source?.url);
              return url ? `${i + 1}. <${url}>` : '';
            })
            .filter(Boolean);
          noteDialog(
            null,
            m.content +
              (links.length ? '\n\nSources:\n' + links.join('\n') : ''),
          );
        }
        break;
      }
      case 'view-note': {
        const n = state.project.generated.find((v) => v.id === id);
        showDialog(
          n.title,
          `<div class="markdown">${markdown(n.body)}</div>`,
          button('Edit note', 'edit-note', {
            i: 'edit',
            data: { 'data-id': n.id },
          }),
          true,
        );
        break;
      }
      case 'edit-note':
        noteDialog(state.project.generated.find((v) => v.id === id));
        break;
      case 'delete-note':
        confirmDialog(
          'Delete study note',
          'Permanently remove this saved study note?',
          async () => {
            applyProject(
              await api(purl(`/generated/${id}`), { method: 'DELETE' }),
            );
            render();
          },
        );
        break;
      case 'export':
        categoriesDialog('export');
        break;
      case 'clear-data':
        categoriesDialog('clear');
        break;
      case 'rename-project':
        formDialog(
          'Rename project',
          field(
            'Name',
            'name',
            state.project.name,
            '',
            'required maxlength="120"',
          ),
          async (v) => {
            applyProject(
              await api(purl(), {
                method: 'PATCH',
                data: { name: v.get('name') },
              }),
            );
            render();
          },
        );
        break;
      case 'delete-project':
        confirmDialog(
          'Delete project',
          `Permanently delete “${state.project.name}” and all its local data? Export a .learn file first if you want a backup.`,
          async () => {
            await api(purl(), { method: 'DELETE' });
            state.project = null;
            state.view = 'overview';
            state.session = null;
            state.lessonId = null;
            state.selectedMaterials = [];
            state.practiceNodes = [];
            state.homeDraft = '';
            state.sidebarQuery = '';
            state.graph = {
              query: '',
              lesson: '',
              view: 'graph',
              selected: null,
              zoom: 1,
              x: 0,
              y: 0,
              fit: true,
            };
            await loadProjects();
            if (state.projects.length) await openProject(state.projects[0].id);
            else {
              hashLocation();
              render();
            }
          },
          'Delete project',
        );
        break;
      case 'clear-graph':
        confirmDialog(
          'Clear knowledge map',
          'Delete all concepts and connections in the knowledge map? Learning sessions and your curriculum are kept.',
          async () => {
            applyProject(await api(purl('/graph'), { method: 'DELETE' }));
            state.graph.selected = null;
            state.graph.fit = true;
            render();
          },
        );
        break;
    }
  } catch (err) {
    toast(errorMessage(err), true);
  }
});

async function boot() {
  try {
    await Promise.all([loadProjects(), loadConnections()]);
    const parts = location.hash.slice(1).split('/').map(decodeURIComponent);
    if (parts[0] && state.projects.some((p) => p.id === parts[0]))
      await openProject(
        parts[0],
        parts[1] || 'overview',
        parts[2],
        parts[3],
        parts[4],
      );
    else if (state.projects.length) await openProject(state.projects[0].id);
    else render();
  } catch (err) {
    root.innerHTML = `<div class="boot"><span class="wordmark">minilearn</span><p>${e(errorMessage(err))}</p><button class="button" id="retry-boot">Try again</button></div>`;
    $('#retry-boot').onclick = boot;
  }
}
boot();
