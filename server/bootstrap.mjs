import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const runtimeAssets = [
  'node_modules/marked/lib/marked.esm.js',
  'node_modules/dompurify/dist/purify.es.mjs',
  'node_modules/katex/dist/katex.mjs',
  'node_modules/katex/dist/katex.min.css',
];

// Check the installed production tree against the lockfile. No network calls
// or extra npm invocation are needed when the installation is already ready.
export function dependenciesReady(root) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    for (const [relative, pkg] of Object.entries(lock.packages)) {
      if (!relative || pkg.dev || pkg.optional) continue;
      const installed = JSON.parse(
        fs.readFileSync(path.join(root, relative, 'package.json'), 'utf8'),
      );
      if (installed.version !== pkg.version) return false;
    }
    return runtimeAssets.every((relative) => fs.existsSync(path.join(root, relative)));
  } catch {
    return false;
  }
}

export function ensureDependencies(root = ROOT, npm = process.env.npm_execpath) {
  if (dependenciesReady(root)) return;
  if (!npm) throw Error('Please launch minilearn with npm start.');
  console.log('Preparing minilearn dependencies (one-time setup)…');
  const result = spawnSync(
    process.execPath,
    [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error || result.status !== 0 || !dependenciesReady(root))
    throw Error('Dependency setup failed. Check your internet connection and run npm start again.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split('.')[0]) < 22)
      throw Error('minilearn requires Node.js 22 or newer.');
    ensureDependencies();
  } catch (error) {
    console.error(`minilearn: ${error.message}`);
    process.exitCode = 1;
  }
}
