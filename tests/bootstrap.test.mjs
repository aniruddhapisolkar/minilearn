import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dependenciesReady, ensureDependencies } from '../server/bootstrap.mjs';

test('first launch installs only production dependencies; later launches reuse them', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minilearn-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(new URL('../package-lock.json', import.meta.url), path.join(root, 'package-lock.json'));
  const npm = path.join(root, 'fake-npm.mjs');
  // A local stand-in for npm exercises the first-start path without network
  // access or altering the real installation's node_modules directory.
  fs.writeFileSync(npm, `
    import fs from 'node:fs';
    import path from 'node:path';
    if (fs.existsSync('fail-install')) process.exit(1);
    fs.appendFileSync('install-log', JSON.stringify(process.argv.slice(2)) + '\\n');
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    for (const [name, pkg] of Object.entries(lock.packages)) {
      if (!name || pkg.dev || pkg.optional) continue;
      fs.mkdirSync(name, { recursive: true });
      fs.writeFileSync(path.join(name, 'package.json'), JSON.stringify({version: pkg.version}));
    }
    for (const file of ['node_modules/marked/lib/marked.esm.js', 'node_modules/dompurify/dist/purify.es.mjs', 'node_modules/katex/dist/katex.mjs', 'node_modules/katex/dist/katex.min.css']) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'fixture');
    }
  `);
  const installs = () => fs.readFileSync(path.join(root, 'install-log'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(dependenciesReady(root), false);
  ensureDependencies(root, npm);
  assert.ok(dependenciesReady(root));
  assert.deepEqual(installs(), [['ci', '--omit=dev', '--no-audit', '--no-fund']]);
  // No development-only dependencies are required to start minilearn.
  assert.ok(!fs.existsSync(path.join(root, 'node_modules/jsdom')));
  ensureDependencies(root, npm);
  assert.equal(installs().length, 1);

  // An updated lockfile or a missing runtime asset triggers repair.
  fs.writeFileSync(path.join(root, 'node_modules/marked/package.json'), '{"version":"0.0.0"}');
  ensureDependencies(root, npm);
  assert.equal(installs().length, 2);
  fs.unlinkSync(path.join(root, 'node_modules/katex/dist/katex.min.css'));
  ensureDependencies(root, npm);
  assert.equal(installs().length, 3);
  fs.unlinkSync(path.join(root, 'node_modules/katex/dist/katex.min.css'));
  fs.writeFileSync(path.join(root, 'fail-install'), '');
  assert.throws(() => ensureDependencies(root, npm), /Dependency setup failed/);
});
