const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const width = 208,
  height = 56,
  hgap = 78,
  vgap = 34;

export function graphMarkup(project, state, { e, icon, button, pageHeader }) {
  const lessons = project.curriculum.flatMap((m) => m.lessons);
  return `<main class="page wide">${pageHeader('Knowledge map', 'A quiet view of the concepts you have demonstrated, and how they depend on one another.', project.graph.nodes.length ? button('Clear map', 'clear-graph', { style: 'ghost', i: 'trash' }) : '')}<div class="graph-shell"><div class="graph-toolbar"><input class="input" id="graph-search" type="search" aria-label="Search knowledge" placeholder="Search concepts…" value="${e(state.query)}"><select id="graph-lesson" aria-label="Filter by lesson"><option value="">All lessons</option>${lessons.map((l) => `<option value="${e(l.id)}" ${state.lesson === l.id ? 'selected' : ''}>${e(l.title)}</option>`).join('')}</select><span class="spacer"></span><div class="row" id="graph-zoom-controls"><button class="icon-button" data-graph="zoom-out" title="Zoom out" aria-label="Zoom out">${icon('minus')}</button><span id="graph-zoom-level" class="small muted mono">100%</span><button class="icon-button" data-graph="zoom-in" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button><button class="button minor ghost graph-fit" data-graph="fit" title="Fit the graph to view">${icon('fit')} Fit</button></div><button class="button minor" id="graph-view-switch" data-graph="toggle-view">${icon(state.view === 'list' ? 'graph' : 'list')} ${state.view === 'list' ? 'Graph' : 'List'}</button></div><div id="graph-body"></div><div id="graph-details"></div></div><div class="graph-stat" id="graph-stat"></div><p class="small muted">Drag the canvas to pan. Scroll to zoom. Select a concept to inspect its statement and related concepts.</p></main>`;
}

function layout(nodes, edges) {
  const positions = new Map();
  if (!nodes.length) return { positions, w: 1, h: 1 };
  if (!edges.length) {
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
    nodes.forEach((n, i) =>
      positions.set(n.id, {
        x: (i % cols) * (width + 36),
        y: Math.floor(i / cols) * (height + vgap),
      }),
    );
    return {
      positions,
      w: cols * (width + 36) - 36,
      h: Math.ceil(nodes.length / cols) * (height + vgap) - vgap,
    };
  }
  const ids = new Set(nodes.map((n) => n.id)),
    indegree = new Map(nodes.map((n) => [n.id, 0])),
    next = new Map(nodes.map((n) => [n.id, []])),
    rank = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    indegree.set(e.to, indegree.get(e.to) + 1);
    next.get(e.from).push(e.to);
  }
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const to of next.get(at)) {
      rank.set(to, Math.min(30, Math.max(rank.get(to), rank.get(at) + 1)));
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) queue.push(to);
    }
  }
  const cols = new Map();
  for (const n of nodes) {
    const r = rank.get(n.id);
    if (!cols.has(r)) cols.set(r, []);
    cols.get(r).push(n);
  }
  const maxRows = Math.max(...[...cols.values()].map((col) => col.length)),
    maxCol = Math.max(...cols.keys());
  for (const [r, col] of cols) {
    const offset = ((maxRows - col.length) * (height + vgap)) / 2;
    col.forEach((n, i) =>
      positions.set(n.id, {
        x: r * (width + hgap),
        y: offset + i * (height + vgap),
      }),
    );
  }
  return {
    positions,
    w: maxCol * (width + hgap) + width,
    h: maxRows * (height + vgap) - vgap,
  };
}
function wrapTitle(title) {
  const words = title.trim().split(/\s+/);
  let first = '',
    second = '';
  for (const word of words) {
    if ((first + ' ' + word).trim().length <= 27 && !second)
      first = (first + ' ' + word).trim();
    else if ((second + ' ' + word).trim().length <= 27)
      second = (second + ' ' + word).trim();
    else
      return [
        first || word.slice(0, 25) + '…',
        (second || word).slice(0, 25) + '…',
      ];
  }
  return second ? [first, second] : [first || title.slice(0, 25) + '…'];
}

export function mountGraph(project, state, { e, icon, button, ib, onDelete }) {
  const $ = (selector) => document.querySelector(selector);
  const body = $('#graph-body'),
    details = $('#graph-details'),
    search = $('#graph-search'),
    lesson = $('#graph-lesson');
  const fullNodes = project.graph.nodes,
    fullEdges = project.graph.edges;
  const nodeFor = (id) => fullNodes.find((n) => n.id === id);
  let currentLayout = null,
    svg = null,
    group = null;
  function filtered() {
    const query = state.query.trim().toLowerCase();
    const nodes = fullNodes.filter(
      (n) =>
        (!state.lesson || n.lessonId === state.lesson) &&
        (!query || `${n.title} ${n.statement}`.toLowerCase().includes(query)),
    );
    const ids = new Set(nodes.map((n) => n.id));
    return {
      nodes,
      edges: fullEdges.filter((x) => ids.has(x.from) && ids.has(x.to)),
    };
  }
  function updateTransform() {
    if (group)
      group.setAttribute(
        'transform',
        `translate(${state.x} ${state.y}) scale(${state.zoom})`,
      );
    $('#graph-zoom-level').textContent = `${Math.round(state.zoom * 100)}%`;
  }
  function fit() {
    if (!svg || !currentLayout) return;
    const W = svg.clientWidth,
      H = svg.clientHeight,
      l = currentLayout;
    state.zoom = clamp(Math.min((W - 45) / l.w, (H - 45) / l.h), 0.04, 1.25);
    state.x = (W - l.w * state.zoom) / 2;
    state.y = (H - l.h * state.zoom) / 2;
    state.fit = false;
    updateTransform();
  }
  function zoom(delta, px, py) {
    if (!svg) return;
    const old = state.zoom,
      next = clamp(old * delta, 0.03, 4);
    px ??= svg.clientWidth / 2;
    py ??= svg.clientHeight / 2;
    state.x = px - ((px - state.x) * next) / old;
    state.y = py - ((py - state.y) * next) / old;
    state.zoom = next;
    state.fit = false;
    updateTransform();
  }
  function setSelected(id) {
    state.selected = id;
    body
      .querySelectorAll('[data-node-id]')
      .forEach((el) =>
        el.classList.toggle('selected', el.dataset.nodeId === id),
      );
    updateDetails();
  }
  function updateDetails() {
    const node = nodeFor(state.selected);
    if (!node) {
      details.innerHTML = '';
      return;
    }
    const pre = fullEdges
      .filter((x) => x.to === node.id)
      .map((x) => nodeFor(x.from))
      .filter(Boolean);
    const children = fullEdges
      .filter((x) => x.from === node.id)
      .map((x) => nodeFor(x.to))
      .filter(Boolean);
    const links = (label, list) =>
      list.length
        ? `<div class="divider"></div><span class="caps">${label}</span>${list.map((n) => `<button type="button" class="relationship" data-related="${e(n.id)}">${e(n.title)}</button>`).join('')}`
        : '';
    details.innerHTML = `<aside class="graph-detail"><div class="between"><span class="caps">Concept</span><button class="icon-button" id="graph-close-detail" aria-label="Close concept">${icon('close')}</button></div><h3>${e(node.title)}</h3><p>${e(node.statement)}</p>${links('Premises', pre)}${links('Leads to', children)}<div class="divider"></div><button class="button minor ghost" id="graph-delete-node">${icon('trash')} Delete concept</button></aside>`;
    $('#graph-close-detail').onclick = () => setSelected(null);
    $('#graph-delete-node').onclick = () => onDelete(node.id);
    details.querySelectorAll('[data-related]').forEach(
      (b) =>
        (b.onclick = () => {
          const target = nodeFor(b.dataset.related);
          if (!target) return;
          if (!filtered().nodes.some((n) => n.id === target.id)) {
            state.query = '';
            state.lesson = '';
            search.value = '';
            lesson.value = '';
            state.fit = true;
            draw();
          }
          setSelected(target.id);
          if (svg && currentLayout.positions.has(target.id)) {
            const p = currentLayout.positions.get(target.id);
            state.x = svg.clientWidth / 2 - (p.x + width / 2) * state.zoom;
            state.y = svg.clientHeight / 2 - (p.y + height / 2) * state.zoom;
            updateTransform();
          }
        }),
    );
  }
  function draw() {
    const { nodes, edges } = filtered();
    $('#graph-stat').textContent =
      `${nodes.length} ${nodes.length === 1 ? 'concept' : 'concepts'} · ${edges.length} ${edges.length === 1 ? 'connection' : 'connections'}${nodes.length !== fullNodes.length ? ` (of ${fullNodes.length} concepts)` : ''}`;
    $('#graph-view-switch').innerHTML =
      `${icon(state.view === 'list' ? 'graph' : 'list')} ${state.view === 'list' ? 'Graph' : 'List'}`;
    $('#graph-zoom-controls').style.display =
      state.view === 'list' ? 'none' : 'flex';
    if (!nodes.length) {
      svg = null;
      group = null;
      body.innerHTML = `<div class="graph-empty">${icon('graph')}<strong>${fullNodes.length ? 'No matching concepts' : 'Your knowledge map is empty'}</strong><span>${fullNodes.length ? 'Try a different search or lesson.' : 'Concepts appear as your tutor checks what you understand.'}</span></div>`;
      updateDetails();
      return;
    }
    if (state.view === 'list') {
      svg = null;
      group = null;
      body.innerHTML = `<div class="graph-list">${nodes.map((n) => `<button data-node-id="${e(n.id)}"><strong>${e(n.title)}</strong><small>${e(n.statement)}</small></button>`).join('')}</div>`;
      body
        .querySelectorAll('[data-node-id]')
        .forEach((b) => (b.onclick = () => setSelected(b.dataset.nodeId)));
      updateDetails();
      return;
    }
    currentLayout = layout(nodes, edges);
    const pos = currentLayout.positions;
    body.innerHTML = `<svg class="graph-canvas" id="graph-canvas" role="img" aria-label="Interactive knowledge map"><defs><marker id="graph-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0 0L6 3L0 6" fill="#a8b6a6"/></marker></defs><g id="graph-world">${edges
      .map((edge) => {
        const a = pos.get(edge.from),
          b = pos.get(edge.to),
          x = a.x + width,
          y = a.y + height / 2,
          x2 = b.x,
          y2 = b.y + height / 2,
          mid = (x + x2) / 2;
        return `<path class="graph-edge" d="M${x} ${y} C${mid} ${y},${mid} ${y2},${x2 - 3} ${y2}" marker-end="url(#graph-arrow)"/>`;
      })
      .join('')}${nodes
      .map((n) => {
        const p = pos.get(n.id),
          lines = wrapTitle(n.title);
        return `<g class="graph-node ${state.selected === n.id ? 'selected' : ''}" data-node-id="${e(n.id)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${e(n.title)}"><title>${e(n.title)}</title><rect width="${width}" height="${height}"/><text x="12" y="${lines.length === 1 ? 32 : 24}">${lines.map((line, i) => `<tspan x="12" dy="${i ? 17 : 0}">${e(line)}</tspan>`).join('')}</text></g>`;
      })
      .join('')}</g></svg>`;
    svg = $('#graph-canvas');
    group = $('#graph-world');
    if (state.fit) fit();
    else updateTransform();
    svg.querySelectorAll('[data-node-id]').forEach((el) => {
      el.onclick = () => setSelected(el.dataset.nodeId);
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setSelected(el.dataset.nodeId);
        }
      });
    });
    let drag = null;
    svg.addEventListener('pointerdown', (event) => {
      if (event.target.closest('[data-node-id]') || event.button !== 0) return;
      drag = { x: event.clientX, y: event.clientY, ox: state.x, oy: state.y };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add('dragging');
    });
    svg.addEventListener('pointermove', (event) => {
      if (drag) {
        state.x = drag.ox + event.clientX - drag.x;
        state.y = drag.oy + event.clientY - drag.y;
        state.fit = false;
        updateTransform();
      }
    });
    const end = () => {
      drag = null;
      svg.classList.remove('dragging');
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = svg.getBoundingClientRect();
        zoom(
          Math.exp(-event.deltaY * 0.0014),
          event.clientX - rect.left,
          event.clientY - rect.top,
        );
      },
      { passive: false },
    );
    updateDetails();
  }
  search.addEventListener('input', () => {
    state.query = search.value;
    state.fit = true;
    draw();
  });
  lesson.addEventListener('change', () => {
    state.lesson = lesson.value;
    state.fit = true;
    draw();
  });
  document.querySelectorAll('[data-graph]').forEach((b) =>
    b.addEventListener('click', () => {
      switch (b.dataset.graph) {
        case 'zoom-out':
          zoom(1 / 1.25);
          break;
        case 'zoom-in':
          zoom(1.25);
          break;
        case 'fit':
          fit();
          break;
        case 'toggle-view':
          state.view = state.view === 'graph' ? 'list' : 'graph';
          state.fit = true;
          draw();
          break;
      }
    }),
  );
  draw();
}
