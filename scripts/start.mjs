// =====================================================================
// npm start      → install if needed, start Standupify, open the browser
// npm run demo   → the same, with mock engines (no GPU, no downloads)
// =====================================================================

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const noOpen = process.argv.includes('--no-open') || !!process.env.CI;
const port = Number(process.env.PORT) || 3210;

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, amber: (s) => `\x1b[38;5;215m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(c.red(`Standupify needs Node 18.17 or newer (you have ${process.versions.node}). Get it from https://nodejs.org`));
  process.exit(1);
}

if (!fs.existsSync(path.join(root, 'node_modules', 'vite'))) {
  console.log(c.amber('◆ First run — installing dependencies (about a minute)…'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(c.red('npm install failed — see above.')); process.exit(1); }
}

if (demo) {
  const mocks = await import('./mock-engines.mjs');
  await mocks.startNightshift();
  await mocks.startComfy();
  process.env.NIGHTSHIFT_URL = `http://127.0.0.1:${mocks.MOCK_NIGHTSHIFT_PORT}`;
  process.env.NIGHTSHIFT_TOKEN = mocks.MOCK_TOKEN;
  process.env.COMFYUI_URL = `http://127.0.0.1:${mocks.MOCK_COMFY_PORT}`;
  process.env.STANDUPIFY_STATION_DIR ||= path.join(root, 'engines', 'station-demo');   // demo shows never mix with yours
}

const { createServer } = await import('vite');
const server = await createServer({ root, server: { port, strictPort: false }, logLevel: 'warn' });
await server.listen();
const url = (server.resolvedUrls?.local?.[0] || `http://127.0.0.1:${port}/`).replace('localhost', '127.0.0.1');

console.log('');
console.log(`  ${c.amber('●')} ${c.bold('Standupify')} ${demo ? c.amber('(demo engines)') : ''}`);
console.log(`  ${c.dim('open')}  ${c.bold(url)}`);

try {
  const st = await (await fetch(`${url}api/status`)).json();
  const ns = st.nightshift, comfy = st.comfy;
  const line = (ok, name, text) => console.log(`  ${ok ? c.green('●') : c.dim('○')} ${name.padEnd(11)} ${c.dim(text)}`);
  line(ns.state === 'online', 'Nightshift', ns.state === 'online' ? `${ns.origin} · ${ns.modes} modes` : ns.reason);
  line(comfy.state === 'online', 'ComfyUI', comfy.state === 'online' ? `${comfy.origin}${comfy.gpu ? ` · ${comfy.gpu.name}` : ''}` : comfy.reason);
  if (ns.state !== 'online' || comfy.state !== 'online') console.log(c.dim('  Anything that is off can be started from the app (Engines).'));
} catch { /* status is shown in the app anyway */ }
console.log(c.dim('\n  Ctrl+C to stop.\n'));

if (!noOpen) {
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => { /* no browser to open */ }).unref();
}
