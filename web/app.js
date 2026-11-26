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
  plus: '<path d="M12 5v14M5 12h14"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.9 1.9-.06-.06A1.7 1.7 0 0 0 15.96 18a1.7 1.7 0 0 0-1.05 1.55v.09h-2.7v-.09A1.7 1.7 0 0 0 11.16 18a1.7 1.7 0 0 0-1.88.34l-.06.06-1.9-1.9.06-.06A1.7 1.7 0 0 0 7.72 14.56a1.7 1.7 0 0 0-1.55-1.05h-.09v-2.7h.09a1.7 1.7 0 0 0 1.55-1.05 1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.9-1.9.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.05-1.55V4.7h2.7v.09a1.7 1.7 0 0 0 1.05 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.9 1.9-.06.06A1.7 1.7 0 0 0 19.4 9.76a1.7 1.7 0 0 0 1.55 1.05h.09v2.7h-.09A1.7 1.7 0 0 0 19.4 15Z" transform="translate(-1.5 -.2)"/>',
  back: '<path d="m12 19-7-7 7-7M5 12h14"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  file: '<path d="M6 3h8l4 4v14H6Z M14 3v5h4M9 12h6M9 16h6"/>',
  graph:
    '<circle cx="5" cy="6" r="2.5"/><circle cx="17" cy="5" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m7.3 7.2 3.4 8.5m4.8-8.6-2.6 8.5m-5.4-9.8 7-.6"/>',
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
  `<button class="brand" data-action="library" title="Projects"><span class="wordmark">minilearn</span></button>`;
const state = {
  projects: [],
  project: null,
  view: 'library',
  lessonId: null,
  mode: 'learn',
  session: null,
  connections: { connections: [], activeConnection: null },
  collapsed: window.innerWidth < 680,
  folded: new Set(),
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
const markdown = (raw) => {
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
  return `<button class="model-pill" data-action="models" title="${c ? e(c.model) : 'Connect a model'}"><span class="dot ${c ? '' : 'off'}"></span><span class="truncate">${c ? e(c.model) : 'Connect model'}</span>${icon('down')}</button>`;
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
  if (state.view === 'lesson' && state.lessonId)
    pieces.push(state.lessonId, state.mode);
  history.replaceState(
    null,
    '',
    `#${pieces.map(encodeURIComponent).join('/')}`,
  );
}
function go(view) {
  if (!canNavigate()) return;
  state.view = view;
  state.session = null;
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
) {
  if (!canNavigate()) return;
  state.project = await api(`/api/projects/${encodeURIComponent(id)}`);
  state.view = view;
  state.lessonId = lessonId;
  state.mode = mode === 'practice' ? 'practice' : 'learn';
  state.session = null;
  state.draft = '';
  state.plannerDraft = '';
  state.selectedMaterials = [];
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
  if (view === 'lesson' && selectedLesson()) {
    await selectLesson(lessonId, state.mode);
    return;
  }
  if (
    ![
      'overview',
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
  state.view = 'lesson';
  state.session = null;
  state.draft = '';
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
function renderLibrary() {
  const cards = state.projects
    .map(
      (p) =>
        `<button class="project-card" data-action="open-project" data-id="${e(p.id)}"><span class="card-icon">${icon('folder')}</span><span class="grow"><h2>${e(p.name)}</h2><span class="project-meta">${p.lessonCount} ${p.lessonCount === 1 ? 'lesson' : 'lessons'} · Updated ${e(dateLabel(p.updatedAt))}</span></span>${icon('right')}</button>`,
    )
    .join('');
  return `<header class="library-header">${brand()}<div class="row">${modelPill()}${ib('settings', 'models', 'Model settings')}</div></header><main class="library"><div class="library-hero"><h1>What are you learning?</h1></div><div class="section-heading between wrap"><span class="caps">Projects · ${state.projects.length}</span><div class="row wrap">${button('New project', 'new-project', { style: 'primary', i: 'plus' })}${button('Import .learn', 'import', { i: 'import' })}</div></div><div class="project-grid">${cards || '<p class="muted library-empty">No projects yet.</p>'}</div></main>`;
}
function nav(label, key, i) {
  return `<button class="nav-link ${state.view === key ? 'active' : ''}" data-action="go" data-view="${key}">${icon(i)}${label}</button>`;
}
function renderSidebar() {
  const p = state.project;
  return `<aside class="sidebar"><div class="side-top between">${brand()}${ib('panel', 'toggle-sidebar', 'Collapse sidebar')}</div><div class="side-project"><button class="project-back" data-action="library">${icon('back')} All projects</button><button class="project-title truncate" data-action="go" data-view="overview" title="${e(p.name)}">${e(p.name)}</button></div><div class="side-curriculum"><div class="side-heading between"><span class="caps">Curriculum</span>${ib('edit', 'go', 'Edit curriculum', { 'data-view': 'curriculum' })}</div>${p.curriculum.length ? p.curriculum.map((m) => `<div class="side-module"><button class="module-trigger" data-action="fold-module" data-id="${e(m.id)}" aria-expanded="${!state.folded.has(m.id)}">${icon(state.folded.has(m.id) ? 'right' : 'down')}<span class="grow">${e(m.title)}</span></button>${state.folded.has(m.id) ? '' : m.lessons.map((l) => `<button class="lesson-link ${state.view === 'lesson' && state.lessonId === l.id ? 'active' : ''}" data-action="lesson" data-id="${e(l.id)}">${statusDot(p.progress[l.id])}<span>${e(l.title)}</span></button>`).join('')}</div>`).join('') : `<button class="add-inline" data-action="go" data-view="curriculum">${icon('plus')} Add your curriculum</button>`}</div><nav class="side-nav">${nav('Curriculum editor', 'curriculum', 'book')}${nav('Study materials', 'materials', 'file')}${nav('Knowledge map', 'graph', 'graph')}${nav('Data & export', 'data', 'data')}</nav></aside>`;
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
  return `<header class="topbar">${state.collapsed ? ib('panel', 'toggle-sidebar', 'Open sidebar') : ''}<h1 class="window-title grow truncate" title="${e(title || '')}">${e(title || '')}</h1>${modelPill()}${ib('settings', 'models', 'Model settings')}</header>`;
}
function renderOverview() {
  const p = state.project,
    all = lessons(),
    complete = all.filter((l) => p.progress[l.id] === 'complete').length,
    next = all.find((l) => p.progress[l.id] !== 'complete') || all[0];
  return `<main class="page narrow"><div class="page-head"><span class="caps">Learning project</span><h1 style="margin-top:9px">${e(p.name)}</h1><p>${all.length ? 'Your curriculum, materials, and learning history.' : 'Build the curriculum the way you want to learn it.'}</p></div>${all.length ? `<div class="overview-progress"><div class="progress-track" aria-label="${complete} of ${all.length} lessons complete"><div style="width:${(complete / all.length) * 100}%"></div></div><span class="small muted">${complete} / ${all.length} complete</span></div><div class="row wrap">${next ? button('Continue learning', 'lesson', { style: 'primary', i: 'arrow', data: { 'data-id': next.id } }) : ''}${button('Edit curriculum', 'go', { i: 'edit', data: { 'data-view': 'curriculum' } })}</div><div class="section"><div class="section-heading between"><h2>Curriculum</h2>${button('Plan with AI', 'go', { style: 'ghost', i: 'spark', data: { 'data-view': 'planner' } })}</div>${p.curriculum.map((m) => `<div class="overview-module"><h3>${e(m.title)}</h3>${m.lessons.length ? m.lessons.map((l) => `<button class="overview-lesson" data-action="lesson" data-id="${e(l.id)}">${statusDot(p.progress[l.id])}<span class="grow">${e(l.title)}</span>${icon('right')}</button>`).join('') : '<span class="small muted">No lessons yet.</span>'}</div>`).join('')}</div>` : empty('book', 'Make a plan', 'Paste a syllabus, talk through a plan with AI, or start with an empty module.', button('Build curriculum', 'go', { style: 'primary', i: 'plus', data: { 'data-view': 'curriculum' } }) + button('Plan with AI', 'go', { i: 'spark', data: { 'data-view': 'planner' } }))}</main>`;
}
function renderCurriculum() {
  const p = state.project;
  return `<main class="page"><div class="page-head"><h1>Curriculum</h1><p>Your plan is always yours to edit. Add, move, or refine any lesson.</p><div class="row wrap" style="margin-top:18px">${button('Add module', 'add-module', { style: 'primary', i: 'plus' })}${button('Paste outline', 'paste-outline', { i: 'file' })}${button('Plan with AI', 'go', { i: 'spark', data: { 'data-view': 'planner' } })}</div></div>${p.curriculum.length ? p.curriculum.map((m, i) => `<section class="module-card"><div class="module-card-header"><span class="module-number">${String(i + 1).padStart(2, '0')}</span><div class="grow"><h3>${e(m.title)}</h3>${m.description ? `<div class="module-desc">${e(m.description)}</div>` : ''}</div><div class="controls">${i > 0 ? ib('up', 'move-module', 'Move module up', { 'data-id': m.id, 'data-direction': '-1' }) : ''}${i < p.curriculum.length - 1 ? ib('down', 'move-module', 'Move module down', { 'data-id': m.id, 'data-direction': '1' }) : ''}${ib('edit', 'edit-module', 'Edit module', { 'data-id': m.id })}${ib('trash', 'delete-module', 'Delete module', { 'data-id': m.id }, 'danger')}</div></div><div class="module-lessons">${m.lessons.map((l, j) => `<div class="edit-lesson">${statusDot(p.progress[l.id])}<div class="grow"><div class="title">${e(l.title)}</div>${l.description ? `<small>${e(l.description)}</small>` : ''}</div><div class="controls">${ib('plus', 'add-lesson', 'Insert lesson after this one', { 'data-module': m.id, 'data-after': l.id })}${j > 0 ? ib('up', 'move-lesson', 'Move lesson up', { 'data-module': m.id, 'data-id': l.id, 'data-direction': '-1' }) : ''}${j < m.lessons.length - 1 ? ib('down', 'move-lesson', 'Move lesson down', { 'data-module': m.id, 'data-id': l.id, 'data-direction': '1' }) : ''}${ib('edit', 'edit-lesson', 'Edit or move lesson', { 'data-module': m.id, 'data-id': l.id })}${ib('trash', 'delete-lesson', 'Delete lesson', { 'data-module': m.id, 'data-id': l.id }, 'danger')}</div></div>`).join('')}<button class="add-inline" data-action="add-lesson" data-module="${e(m.id)}">${icon('plus')} Add lesson</button></div></section>`).join('') : empty('book', 'Start from scratch', 'You can build the outline manually or turn your own text into a curriculum.', button('Add module', 'add-module', { style: 'primary', i: 'plus' }) + button('Paste outline', 'paste-outline', { i: 'file' }))}</main>`;
}
function messageHTML(m, { save = false } = {}) {
  return m.role === 'user'
    ? `<article class="message user"><div class="user-bubble">${e(m.content)}</div></article>`
    : `<article class="message assistant"><div class="markdown">${markdown(m.content)}</div>${save ? `<div class="message-actions">${button('Save as study note', 'save-message', { i: 'note', style: 'minor', data: { 'data-id': m.id } })}${ib('trash', 'delete-exchange', 'Delete this exchange', { 'data-id': m.id }, 'danger')}</div>` : ''}</article>`;
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
  return `<main class="page wide"><div class="page-head"><h1>Plan with AI</h1><p>Talk through your curriculum. Nothing changes until you apply a proposal.</p><div class="row wrap" style="margin-top:14px">${button('Back to editor', 'go', { i: 'back', data: { 'data-view': 'curriculum' } })}${planner.messages.length ? button('Clear conversation', 'clear-planner', { style: 'ghost', i: 'trash' }) : ''}</div></div><div class="planner-grid"><div><div class="planner-messages">${planner.messages.length ? planner.messages.map((m) => messageHTML(m)).join('') : `<div class="card"><h3>What would you like to learn?</h3><p class="muted">Paste a full syllabus, describe a subject and your goals, or ask for a specific change — for example, “Add spectral decomposition after eigenvectors in Module 5.”</p></div>`}${working ? `<div class="thinking"><span class="spinner"></span>Working on your curriculum…</div>` : ''}</div><form id="planner-form" class="planner-composer"><textarea name="message" aria-label="Message to curriculum planner" placeholder="Describe your curriculum or a change…" ${working ? 'disabled' : ''}>${e(state.plannerDraft)}</textarea><div class="row" style="justify-content:flex-end">${working ? button('Stop', 'stop', { i: 'stop' }) : `${button('Paste outline', 'paste-outline', { style: 'ghost', i: 'file' })}<button class="button primary" type="submit">${icon('send')} Send</button>`}</div></form></div><aside class="card planner-preview"><div class="between"><h3>${planner.proposal ? 'Proposed curriculum' : 'Current curriculum'}</h3><span class="tag ${planner.proposal ? 'complete' : ''}">${planner.proposal ? 'Review' : 'Saved'}</span></div>${planner.proposal ? proposalChanges(planner.proposal, state.project.curriculum) : ''}${(planner.proposal || state.project.curriculum).length ? proposalList(planner.proposal || state.project.curriculum) : '<p class="small muted">Your curriculum is empty.</p>'}${planner.proposal ? `<div class="notice small">Review the full outline before applying. Your existing lesson sessions and progress follow their stable IDs.</div><div class="row wrap" style="margin-top:12px">${button('Apply proposal', 'apply-proposal', { style: 'primary', i: 'check' })}${button('Discard', 'discard-proposal', { style: 'ghost' })}</div>` : ''}</aside></div></main>`;
}
function renderLesson() {
  const l = selectedLesson();
  if (!l) return renderOverview();
  const p = state.project,
    s = state.session,
    matching = p.sessions.filter(
      (v) => v.lessonId === l.id && v.mode === state.mode,
    ),
    working = state.busy?.kind === 'session',
    progress = p.progress[l.id];
  return `<main class="session-page"><div class="lesson-head"><div class="between wrap lesson-meta"><span class="caps grow">${e(l.moduleTitle)}</span><div class="tabs" role="group" aria-label="Learning mode"><button class="tab ${state.mode === 'learn' ? 'active' : ''}" data-action="mode" data-mode="learn">Teaching</button><button class="tab ${state.mode === 'practice' ? 'active' : ''}" data-action="mode" data-mode="practice">Practice</button></div><button class="button minor ${progress === 'complete' ? '' : 'ghost'}" data-action="progress">${icon(progress === 'complete' ? 'check' : 'flag')} ${progress === 'complete' ? 'Complete' : 'Mark complete'}</button></div>${l.description ? `<p class="muted lesson-description">${e(l.description)}</p>` : ''}</div><div class="session-tools"><div class="row"><select class="session-select" id="session-select" aria-label="Choose a session" ${!matching.length ? 'disabled' : ''}>${!matching.length ? '<option>No sessions yet</option>' : matching.map((v, i) => `<option value="${e(v.id)}" ${s?.id === v.id ? 'selected' : ''}>${i === 0 ? 'Latest session' : `Session ${matching.length - i}`} · ${e(dateLabel(v.updatedAt))}</option>`).join('')}</select>${s ? ib('trash', 'delete-session', 'Delete this session', { 'data-id': s.id }, 'danger') : ''}</div>${button('New session', 'new-session', { i: 'plus', style: 'minor', disabled: Boolean(working) })}</div><div class="lesson-content" id="messages">${s?.messages.length ? s.messages.map((m) => messageHTML(m, { save: true })).join('') : `<div class="lesson-empty"><h2>${state.mode === 'learn' ? 'Start a teaching session' : 'Start a practice session'}</h2>${!working ? button(state.mode === 'learn' ? 'Begin lesson' : 'Begin practice', 'begin-session', { style: 'primary', i: 'arrow' }) : ''}</div>`}${working ? `<div class="thinking"><span class="spinner"></span>Thinking…</div>` : ''}</div><div class="composer-shell"><form id="lesson-form" class="composer"><label class="caps composer-label" for="lesson-message">Your thinking</label><textarea id="lesson-message" name="message" aria-label="Your message" placeholder="${state.mode === 'learn' ? 'Ask a question or explain your thinking…' : 'Work through your answer or ask for a hint…'}" ${working ? 'disabled' : ''}>${e(state.draft)}</textarea><div class="composer-footer">${button(state.selectedMaterials.length ? `${state.selectedMaterials.length} sources` : 'Sources', 'choose-materials', { style: 'ghost minor', i: 'paperclip', disabled: Boolean(working) })}<span class="spacer"></span>${working ? button('Stop', 'stop', { i: 'stop' }) : `<button type="submit" class="button primary">${icon('send')} Submit</button>`}</div></form><div class="composer-caption">Your model may make mistakes. Verify important claims.</div></div></main>`;
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
  if (!state.project) {
    root.innerHTML = renderLibrary();
    return;
  }
  let content;
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
    case 'graph':
      content = graphMarkup(state.project, state.graph, {
        e,
        icon,
        button,
        ib,
        pageHeader,
      });
      break;
    case 'data':
      content = renderData();
      break;
    default:
      content = renderOverview();
  }
  root.innerHTML = `<div class="app-shell ${state.collapsed ? 'collapsed' : ''}">${renderSidebar()}<div class="main-panel">${topbar()}${content}</div></div>`;
  if (state.view === 'graph')
    mountGraph(state.project, state.graph, {
      e,
      icon,
      button,
      ib,
      onDelete: deleteGraphNode,
    });
}
function scrollMessages(smooth = true) {
  requestAnimationFrame(() =>
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    }),
  );
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
          if (
            state.project.curriculum.length &&
            !window.confirm(
              'Replace the existing curriculum? Learning history will be kept.',
            )
          )
            return;
          await saveCurriculum(curriculum);
          closeDialog();
          go('curriculum');
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
  showDialog(
    'Connect an AI model',
    `<p class="muted small">Choose a provider, enter its credentials, and choose your model. Keys stay on your computer.</p><form id="connection-form"><label class="field">Provider<select name="provider" id="provider-select" ${existing ? 'disabled' : ''}><option value="openai" ${provider === 'openai' ? 'selected' : ''}>OpenAI</option><option value="anthropic" ${provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option><option value="google" ${provider === 'google' ? 'selected' : ''}>Google Gemini</option><option value="custom" ${provider === 'custom' ? 'selected' : ''}>OpenAI-compatible / local model</option></select></label><div id="custom-fields" class="${provider === 'custom' ? '' : 'hidden'}">${field('API base URL', 'baseUrl', existing?.baseUrl || 'http://localhost:11434/v1', 'http://localhost:11434/v1')}<div class="provider-presets" style="margin-top:-9px;margin-bottom:15px"><button type="button" data-preset="http://localhost:11434/v1">Ollama</button><button type="button" data-preset="http://localhost:1234/v1">LM Studio</button><button type="button" data-preset="http://localhost:8080/v1">llama.cpp</button></div></div><label class="field"><span id="key-label">API key${provider === 'custom' ? ' (optional)' : ''}</span><input class="input" type="password" name="apiKey" autocomplete="off" placeholder="${existing?.hasKey ? 'Leave blank to keep existing key' : 'Paste your API key'}"><span class="hint" id="key-hint">${provider === 'custom' ? 'No key is needed for many local model servers.' : 'The key will be stored locally and never exported.'}</span></label><label class="field">Model<div class="row"><input class="input grow" name="model" list="model-options" value="${e(existing?.model || '')}" placeholder="Choose or type model ID" required><button class="button" type="button" id="discover-models">Find models</button></div><datalist id="model-options"></datalist><span id="discovery-hint" class="hint">Use Find models to list available models, or enter an ID manually.</span></label><label class="field">Connection name (optional)<input class="input" name="label" value="${e(existing?.label || '')}" placeholder="e.g. Local Ollama"></label><div id="connect-error" class="error hidden"></div><div class="row" style="justify-content:flex-end"><button type="button" class="button ghost" id="back-models">Back</button><button type="submit" class="button primary">${icon('check')} Test &amp; connect</button></div><p class="small muted" style="margin:9px 0 0;text-align:right">Tests with a tiny model request (your provider's normal billing applies).</p></form>`,
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
    $('#key-hint', dialog).textContent = custom
      ? 'No key is needed for many local model servers.'
      : 'The key will be stored locally and never exported.';
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
  if (!state.connections.connections.length) {
    modelSetup();
    return;
  }
  showDialog(
    'AI models',
    `<p class="small muted">Choose a model for teaching, practice, and curriculum planning. You can switch at any time.</p>${state.connections.connections.map((c) => `<div class="connection-row"><div class="provider-badge">${e(c.label.slice(0, 1))}</div><div class="grow"><strong class="truncate">${e(c.label)}</strong><div class="small muted truncate">${e(c.model)}</div></div>${c.id === state.connections.activeConnection ? '<span class="tag complete">Active</span>' : button('Use', 'activate-model', { style: 'minor', data: { 'data-id': c.id } })}${ib('edit', 'edit-model', 'Edit connection', { 'data-id': c.id })}${ib('trash', 'delete-model', 'Remove connection', { 'data-id': c.id }, 'danger')}</div>`).join('')}`,
    button('Add connection', 'add-model', { style: 'primary', i: 'plus' }),
  );
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
function chooseMaterials() {
  const p = state.project;
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
        const res = await fetch(
          purl(`/export?include=${encodeURIComponent(categories.join(','))}`),
        );
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
  state.selectedMaterials = [];
  render();
  return session;
}
async function turn(message) {
  if (state.busy) return;
  if (!activeModel()) {
    modelDialog();
    return;
  }
  if (!message.trim()) return;
  state.draft = message;
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
      data: { message, materialIds: state.selectedMaterials },
      signal: controller.signal,
    });
    await refreshProject();
  } catch (err) {
    state.draft = message;
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
    modelDialog();
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
      data: { message },
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
async function uploadFiles(files) {
  if (!state.project || !canNavigate()) return;
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
    applyProject(
      await api(purl('/materials'), {
        method: 'POST',
        data: { name: file.name, mime: file.type, data },
      }),
    );
  }
  closeDialog();
  render();
  toast('Source files added.');
}

document.addEventListener('submit', (event) => {
  if (event.target.id === 'lesson-form') {
    event.preventDefault();
    turn(event.target.elements.message.value).catch((err) =>
      toast(errorMessage(err), true),
    );
  }
  if (event.target.id === 'planner-form') {
    event.preventDefault();
    plan(event.target.elements.message.value).catch((err) =>
      toast(errorMessage(err), true),
    );
  }
});
document.addEventListener('input', (event) => {
  if (event.target.closest('#lesson-form') && event.target.name === 'message')
    state.draft = event.target.value;
  if (event.target.closest('#planner-form') && event.target.name === 'message')
    state.plannerDraft = event.target.value;
});
document.addEventListener('keydown', (event) => {
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key === 'Enter' &&
    event.target.tagName === 'TEXTAREA'
  ) {
    const form = event.target.closest('form');
    if (form?.id === 'lesson-form' || form?.id === 'planner-form') {
      event.preventDefault();
      form.requestSubmit();
    }
  }
});
document.addEventListener('change', async (event) => {
  try {
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
  if (files.length)
    uploadFiles(files).catch((err) => toast(errorMessage(err), true));
});
document.addEventListener('dragover', (event) => {
  const zone = event.target.closest('#dropzone');
  if (zone) {
    event.preventDefault();
    zone.classList.add('dragging');
  }
});
document.addEventListener('dragleave', (event) =>
  event.target.closest('#dropzone')?.classList.remove('dragging'),
);
document.addEventListener('drop', (event) => {
  const zone = event.target.closest('#dropzone');
  if (zone) {
    event.preventDefault();
    zone.classList.remove('dragging');
    uploadFiles([...event.dataTransfer.files]).catch((err) =>
      toast(errorMessage(err), true),
    );
  }
});
document.addEventListener('click', async (event) => {
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
      case 'library':
        if (!canNavigate()) break;
        state.project = null;
        state.view = 'library';
        await loadProjects();
        hashLocation();
        render();
        window.scrollTo(0, 0);
        break;
      case 'new-project':
        newProjectDialog();
        break;
      case 'open-project':
        await openProject(id);
        break;
      case 'import':
        if (canNavigate()) $('#import-file').click();
        break;
      case 'go':
        go(view);
        break;
      case 'lesson':
        await selectLesson(id, 'learn');
        break;
      case 'mode':
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
          await makeSession();
          state.draft = '';
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
        if (m) noteDialog(null, m.content);
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
            state.view = 'library';
            await loadProjects();
            hashLocation();
            render();
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
      await openProject(parts[0], parts[1] || 'overview', parts[2], parts[3]);
    else render();
  } catch (err) {
    root.innerHTML = `<div class="boot"><span class="wordmark">minilearn</span><p>${e(errorMessage(err))}</p><button class="button" id="retry-boot">Try again</button></div>`;
    $('#retry-boot').onclick = boot;
  }
}
boot();
