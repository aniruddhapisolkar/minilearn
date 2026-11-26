import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { createApp } from '../server/index.mjs';
import { Storage } from '../server/storage.mjs';

test('all interface typography uses the bundled monospaced font', () => {
  const css = ['styles.css', 'workspace.css']
    .map((name) =>
      fs.readFileSync(new URL(`../web/${name}`, import.meta.url), 'utf8'),
    )
    .join('\n');
  assert.match(css, /--font-ui:\s*'JetBrains Mono'/);
  const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map(
    (m) => m[1],
  );
  assert.ok(families.length > 2);
  assert.ok(
    families.every(
      (family) => family === "'JetBrains Mono'" || family === 'var(--font-ui)',
    ),
  );
  assert.ok(
    [...css.matchAll(/\bfont:\s*([^;]+);/g)].every(
      (m) => m[1] === 'inherit' || m[1].endsWith('var(--font-ui)'),
    ),
  );
});

// Exercise the real browser module against the real local API in a DOM.
// This is an interaction test, not a browser layout or visual test.
test('browser workflow: outline, quick model setup, tutor, map, AI insert, and data controls', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minilearn-ui-'));
  const model = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'local-test' }] }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks));
    const system = data.messages[0].content,
      last = data.messages.at(-1).content;
    let answer;
    if (system.includes('testing a connection')) answer = 'OK';
    else if (system.includes('author a curriculum'))
      answer = JSON.stringify({
        reply: 'I added a topic.',
        curriculum: [
          {
            title: 'Module 1: Vector spaces',
            lessons: [
              { title: 'Span' },
              { title: 'Linear independence' },
              { title: 'Basis' },
            ],
          },
          {
            title: 'Module 2: Transformations',
            lessons: [{ title: 'Linear maps' }],
          },
        ],
      });
    else if (last.includes('Every combination of the basis vectors.'))
      answer = JSON.stringify({
        reply:
          'Exactly. The **span** contains all $a\\mathbf{v}+b\\mathbf{w}$.',
        knowledge: [
          {
            title: 'Linear combination',
            statement: 'A linear combination is a weighted sum.',
            premises: [],
          },
          {
            title: 'Span',
            statement: 'The span is the set of all linear combinations.',
            premises: ['Linear combination'],
          },
        ],
        complete: true,
      });
    else
      answer = JSON.stringify({
        reply:
          'Let’s begin with the vectors you already know.\n\n$$a\\mathbf{v}+b\\mathbf{w}$$',
        question: {
          kind: 'prediction',
          prompt: 'What does it mean to span a vector space?',
          options: [
            'A single vector.',
            'Every combination of the basis vectors.',
            'Only the basis itself.',
          ],
        },
        knowledge: [],
        complete: false,
      });
    res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
  const listen = (server) =>
    new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve(`http://127.0.0.1:${server.address().port}`),
      ),
    );
  const modelUrl = await listen(model),
    app = createApp({ storage: new Storage(dir) }),
    url = await listen(app);
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const nativeFetch = globalThis.fetch;
  const dom = new JSDOM(
    fs.readFileSync(path.join(repo, 'web/index.html'), 'utf8'),
    { url, pretendToBeVisual: true },
  );
  const w = dom.window;
  t.after(async () => {
    globalThis.fetch = nativeFetch;
    dom.window.close();
    app.closeAllConnections();
    model.closeAllConnections();
    await Promise.all([
      new Promise((r) => app.close(r)),
      new Promise((r) => model.close(r)),
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const key of [
    'window',
    'document',
    'navigator',
    'location',
    'history',
    'NodeFilter',
    'FormData',
    'FileReader',
    'HTMLElement',
    'Element',
    'Node',
    'requestAnimationFrame',
  ])
    Object.defineProperty(globalThis, key, {
      value:
        key === 'window'
          ? w
          : key === 'requestAnimationFrame'
            ? w.requestAnimationFrame.bind(w)
            : w[key],
      configurable: true,
      writable: true,
    });
  w.scrollTo = () => {};
  w.confirm = () => true;
  if (!w.HTMLDialogElement.prototype.showModal)
    w.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
  if (!w.HTMLDialogElement.prototype.close)
    w.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
  globalThis.fetch = (target, options) =>
    nativeFetch(
      typeof target === 'string' && target.startsWith('/')
        ? url + target
        : target,
      options,
    );
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)];
  const click = (selector) => {
    const target = $(selector);
    assert.ok(target, `Missing ${selector}`);
    target.click();
  };
  const fill = (selector, value) => {
    const target = $(selector);
    assert.ok(target, `Missing ${selector}`);
    target.value = value;
    target.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  const submit = (selector) => {
    const target = $(selector);
    assert.ok(target, `Missing ${selector}`);
    target.dispatchEvent(
      new w.Event('submit', { bubbles: true, cancelable: true }),
    );
  };
  async function wait(predicate, label) {
    for (let i = 0; i < 250; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw Error(
      `Timed out: ${label}\n${document.body.textContent.slice(-1000)}`,
    );
  }
  const heading = (text) =>
    $$('h1,h2,h3').some((h) => h.textContent.trim() === text);
  let source = fs.readFileSync(path.join(repo, 'web/app.js'), 'utf8');
  for (const [from, to] of [
    ['/vendor/marked.js', 'node_modules/marked/lib/marked.esm.js'],
    ['/vendor/purify.js', 'node_modules/dompurify/dist/purify.es.mjs'],
    ['/vendor/katex.js', 'node_modules/katex/dist/katex.mjs'],
    ['/graph.js', 'web/graph.js'],
  ])
    source = source
      .replace(
        `'${from}'`,
        JSON.stringify(pathToFileURL(path.join(repo, to)).href),
      )
      .replace(
        `"${from}"`,
        JSON.stringify(pathToFileURL(path.join(repo, to)).href),
      );
  await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  await wait(() => heading('Knowledge graph'), 'graph home');
  assert.equal($('.wordmark').textContent, 'minilearn');
  assert.equal($('.brand svg'), null);
  assert.ok($('.sidebar') && $('#home-form') && !$('.topbar'));
  assert.equal($$('.sidebar [data-action="new-project"]').length, 1);
  assert.equal($('.session-search-row .icon-button'), null);
  click('[data-action="model-picker"]');
  assert.ok($('.model-picker-empty').textContent.includes('No models match'));
  click('[data-action="home"]');
  click('[data-action="draft"][data-mode="practice"]');
  assert.ok(heading('New practice session'));
  assert.equal(
    $('#home-form textarea').placeholder,
    'What do you want to practice?',
  );
  click('[data-action="home"]');
  click('[data-action="new-project"]');
  fill('#modal-form [name=name]', 'Linear Algebra');
  submit('#modal-form');
  await wait(
    () => $('.workspace-project')?.textContent.includes('Linear Algebra'),
    'project created',
  );
  assert.equal($$('.sidebar [data-action="new-project"]').length, 1);
  const moduleShortcut = $('.session-search-row [data-action="add-module"]');
  assert.ok(moduleShortcut);
  assert.notEqual(
    moduleShortcut.querySelector('svg').innerHTML,
    $('.workspace-picker [data-action="new-project"] svg').innerHTML,
  );
  click('[data-view="curriculum"]');
  await wait(() => heading('Curriculum'), 'curriculum page');
  click('[data-action="paste-outline"]');
  fill(
    '#modal-form [name=text]',
    'Module 1: Vector spaces\n- Span\n- Basis\nModule 2: Transformations\n- Linear maps',
  );
  submit('#modal-form');
  await wait(() => $('#replace-outline'), 'outline preview');
  click('#replace-outline');
  await wait(() => heading('Module 1: Vector spaces'), 'curriculum saved');
  click('[data-action="models"]');
  assert.ok($('.settings-rail') && $('.settings-content'));
  click('[data-action="add-model"]');
  assert.ok($('#provider-select option[value="opencode"]'));
  assert.ok($('#provider-select option[value="opencode-go"]'));
  fill('#provider-select', 'opencode-go');
  $('#provider-select').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok($('#custom-fields').classList.contains('hidden'));
  assert.match($('#key-hint').textContent, /coding agents/);
  fill('#provider-select', 'custom');
  $('#provider-select').dispatchEvent(new w.Event('change', { bubbles: true }));
  fill('#connection-form [name=baseUrl]', modelUrl + '/v1');
  click('#discover-models');
  await wait(
    () => $('#connection-form [name=model]').value === 'local-test',
    'discover model',
  );
  submit('#connection-form');
  await wait(() => !$('#dialog').open, 'connection saved');
  const spanLink = $$('.lesson-link').find(
    (b) => $('.session-name', b)?.textContent.trim() === 'Span',
  );
  spanLink.click();
  await wait(() => heading('Span'), 'lesson selected');
  assert.equal($('.window-title').textContent, 'Span');
  assert.ok($('.opening-composer'));
  assert.ok($('.model-pill').textContent.includes('local-test'));
  click('[data-action="begin-session"]');
  await wait(
    () =>
      document.body.textContent.includes(
        'What does it mean to span a vector space?',
      ),
    'first tutor turn',
  );
  assert.ok($('.katex'), 'math rendered');
  assert.ok($('.question-dock'));
  assert.equal($$('.quiz-option').length, 4);
  click('input[name="choice"][value="1"]');
  fill('#confidence', '75');
  assert.equal($('#confidence-value').textContent, '75%');
  fill('#lesson-form textarea', 'Every combination of the basis vectors.');
  submit('#lesson-form');
  await wait(
    () => document.body.textContent.includes('Exactly.'),
    'second tutor turn',
  );
  assert.ok($('.past-question'));
  click('[data-action="toggle-plan"]');
  assert.ok($('.session-plan'));
  click('[data-action="toggle-plan"]');
  click('[data-view="graph"]');
  await wait(
    () => $('#graph-stat')?.textContent.includes('2 concepts · 1 connection'),
    'graph',
  );
  assert.equal($$('.graph-dot').length, 2);
  const node = $$('[data-node-id]').find(
    (n) => n.getAttribute('aria-label') === 'Span',
  );
  node.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(
    () =>
      $('.graph-detail')?.textContent.includes(
        'The span is the set of all linear combinations.',
      ),
    'graph details',
  );
  click('[data-graph="zoom-in"]');
  click('[data-graph="fit"]');
  click('[data-graph="toggle-view"]');
  assert.ok($('.chains-table'));
  click('[data-graph="toggle-view"]');
  assert.ok($('#graph-canvas'));
  click('[data-view="curriculum"]');
  click('[data-view="planner"]');
  fill('#planner-form textarea', 'Add linear independence after span.');
  submit('#planner-form');
  await wait(() => $('[data-action="apply-proposal"]'), 'planner proposal');
  click('[data-action="apply-proposal"]');
  await wait(
    () =>
      $$('.session-name').some(
        (b) => b.textContent.trim() === 'Linear independence',
      ),
    'AI insertion applied',
  );
  // Start directly from the original-style home dock, without an extra page.
  click('[data-action="home"]');
  click('[data-action="home-mode"][data-mode="practice"]');
  fill('#home-form textarea', 'Composition of maps');
  submit('#home-form');
  await wait(() => $('#topic-position'), 'topic placement dialog');
  const moduleSelect = $('#modal-form select[name="module"]');
  moduleSelect.selectedIndex = 1;
  moduleSelect.dispatchEvent(new w.Event('change', { bubbles: true }));
  $('#modal-form select[name="after"]').value = 'start';
  submit('#modal-form');
  await wait(
    () =>
      $('.window-title')?.textContent === 'Composition of maps' &&
      $('.question-dock'),
    'practice started from graph home',
  );
  assert.ok($('.mode-indicator').textContent.includes('Practice'));
  assert.equal($('.session-filter .active').textContent, 'Practice');
  assert.equal(
    $('.session-folder:last-child .session-name')?.textContent,
    'Composition of maps',
  );
  assert.equal(decodeURIComponent(w.location.hash).split('/').length, 5);
  fill('#session-search', 'Composition');
  assert.equal($$('.session-name').length, 1);
  fill('#session-search', '');
  click('[data-view="data"]');
  click('[data-action="manage-history"]');
  assert.ok(document.body.textContent.includes('Learning sessions'));
  click('[data-action="close-dialog"]');
  click('[data-action="clear-data"]');
  $('#modal-form [value=history]').checked = true;
  submit('#modal-form');
  await wait(
    () => $('#toast').textContent === 'Selected data cleared.',
    'history clear',
  );
  assert.equal($$('[data-action="manage-history"]').length, 0);
});
