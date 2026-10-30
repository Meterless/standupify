// =====================================================================
// Stage the desktop installer's payload (run by `npm run desktop:build`).
//
// The desktop app is the real thing, not a static page: its window runs
// the same local server as `npm start` (bridge + Station), so Nightshift
// and ComfyUI are found and started for the user. That needs Node and the
// app's source next to the shell. This writes:
//
//   src-tauri/app-bundle/app/       the app source + runtime node_modules
//   src-tauri/app-bundle/runtime/   node.exe (the Node running this script)
//
// src-tauri/tauri.bundle.json ships both as installer resources; the shell
// (src-tauri/src/lib.rs) copies app/ somewhere writable on first launch.
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'src-tauri', 'app-bundle');
const appDir = path.join(stage, 'app');
const runtimeDir = path.join(stage, 'runtime');

// The app's own files: everything git would commit (tracked or new, not ignored) except what only the repo needs.
const SKIP_TOP = new Set(['landing', 'docs', 'src-tauri', 'promo', '.gitignore', '.env.example', 'package-lock.json']);
// Dev-only weight the running app never loads (tests use typescript; the shell needs no CLI).
const SKIP_MODULES = new Set(['typescript', '@types', '@tauri-apps/cli', '@tauri-apps/cli-win32-x64-msvc', '.vite', '.cache']);

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });

const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
let files = 0;
for (const rel of tracked) {
  if (SKIP_TOP.has(rel.split('/')[0])) continue;
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(path.join(appDir, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(appDir, rel));
  files++;
}

const modulesSrc = path.join(root, 'node_modules');
if (!fs.existsSync(path.join(modulesSrc, 'vite'))) throw new Error('Run `npm install` first: the installer ships node_modules.');
const copyModules = (src, dst, rel = '') => {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (SKIP_MODULES.has(r)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyModules(s, d, r); }
    else if (e.isFile()) { fs.copyFileSync(s, d); files++; }
  }
};
fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });
copyModules(modulesSrc, path.join(appDir, 'node_modules'));

fs.copyFileSync(process.execPath, path.join(runtimeDir, 'node.exe'));
fs.writeFileSync(path.join(runtimeDir, 'NOTICE.txt'), `Node.js ${process.version} (https://nodejs.org), MIT licensed: https://github.com/nodejs/node/blob/main/LICENSE\n`);

// A new stamp per build tells the shell to refresh its writable copy.
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(appDir, '.bundle-stamp'), `${version}+${Date.now()}`);

const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`desktop payload → src-tauri/app-bundle  (${files} app files, ${(size(stage) / 1024 / 1024).toFixed(0)} MB, Node ${process.version})`);
