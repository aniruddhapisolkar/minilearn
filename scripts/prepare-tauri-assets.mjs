import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dependenciesReady } from '../server/bootstrap.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VENDOR_DIR = path.join(ROOT, 'src-tauri', 'vendor');
const VENDOR_FONTS_DIR = path.join(VENDOR_DIR, 'fonts');
const KATEX_FONTS_DIR = path.join(ROOT, 'node_modules', 'katex', 'dist', 'fonts');

const REQUIRED_SOURCES = [
  ['node_modules/marked/lib/marked.esm.js', 'marked.js'],
  ['node_modules/dompurify/dist/purify.es.mjs', 'purify.js'],
  ['node_modules/katex/dist/katex.mjs', 'katex.js'],
  ['node_modules/katex/dist/katex.min.css', 'katex.css'],
];

function ensureProdDeps() {
  const ready =
    dependenciesReady(ROOT) &&
    REQUIRED_SOURCES.every(([src]) => fs.existsSync(path.join(ROOT, src))) &&
    fs.existsSync(KATEX_FONTS_DIR);
  if (ready) return;

  console.log('Installing production frontend dependencies for Tauri...');
  const npmExec = process.env.npm_execpath;
  const result = npmExec
    ? spawnSync(
        process.execPath,
        [npmExec, 'ci', '--omit=dev', '--no-audit', '--no-fund'],
        { cwd: ROOT, stdio: 'inherit' },
      )
    : spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

  if (result.error || result.status !== 0) {
    throw new Error('Failed to install frontend dependencies with npm ci.');
  }
}

function copyVendorAssets() {
  fs.rmSync(VENDOR_DIR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR_FONTS_DIR, { recursive: true });

  for (const [srcRel, destName] of REQUIRED_SOURCES) {
    const src = path.join(ROOT, srcRel);
    const dest = path.join(VENDOR_DIR, destName);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing vendor asset: ${srcRel}`);
    }
    fs.copyFileSync(src, dest);
  }

  let fontCount = 0;
  for (const entry of fs.readdirSync(KATEX_FONTS_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(?:woff2|woff|ttf)$/i.test(entry.name)) continue;
    fs.copyFileSync(
      path.join(KATEX_FONTS_DIR, entry.name),
      path.join(VENDOR_FONTS_DIR, entry.name),
    );
    fontCount++;
  }
  if (fontCount === 0) {
    throw new Error('No KaTeX font files were found in node_modules/katex/dist/fonts.');
  }
  console.log(`Prepared ${REQUIRED_SOURCES.length} vendor files and ${fontCount} KaTeX fonts in src-tauri/vendor.`);
}

ensureProdDeps();
copyVendorAssets();
