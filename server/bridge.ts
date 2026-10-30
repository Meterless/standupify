// =====================================================================
// Standupify local bridge — the reason there is nothing to configure.
//
// Runs inside the Vite dev/preview server (127.0.0.1 only) and gives the
// browser one origin for everything:
//
//   GET  /api/status              both engines, probed and explained
//   GET  /api/comfy-inventory     installed ComfyUI nodes + model files
//   GET  /api/workflows           API-format workflows shipped in ./workflows
//   POST /api/launch/nightshift   start the installed Nightshift app
//   POST /api/launch/comfy        start the installed ComfyUI
//   *    /api/nightshift/*        → Nightshift, bearer token injected from disk
//   *    /api/comfy/*             → ComfyUI (HTTP + the /ws progress socket)
//
// Nightshift's port is read from its own config.toml and its token from
// <stateDir>/proxy-token, so a user never pastes either. Nothing here is
// reachable from another machine: the server binds loopback and every
// request must carry a loopback Host header (DNS-rebinding guard).
// =====================================================================

import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const APP_ID = 'standupify';
const BRIDGE_VERSION = 1;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

type NightshiftState = 'online' | 'unauthorized' | 'starting' | 'offline';
type ComfyState = 'online' | 'offline';

interface NightshiftStatus {
  state: NightshiftState;
  origin: string | null;
  tokenSource: 'env' | 'file' | null;
  installed: boolean;
  canLaunch: boolean;
  modes: number;
  classes: Record<string, { availability: string | null; why: string | null; chat_carrier?: boolean }> | null;
  reason: string;
}

interface ComfyStatus {
  state: ComfyState;
  origin: string | null;
  version: string | null;
  gpu: { name: string; vramTotal: number; vramFree: number } | null;
  installed: boolean;
  canLaunch: boolean;
  installDir: string | null;
  inventoryStamp: number;
  reason: string;
}

// ---------------------------------------------------------------------
// small utils
// ---------------------------------------------------------------------

function exists(p: string | undefined | null): p is string {
  if (!p) return false;
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readText(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function toOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try { return new URL(s).origin; } catch { return null; }
}

function uniq<T>(xs: (T | null | undefined)[]): T[] {
  const out: T[] = [];
  for (const x of xs) if (x != null && !out.includes(x)) out.push(x);
  return out;
}

async function probe(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function hostIsLoopback(req: IncomingMessage): boolean {
  const host = String(req.headers.host || '');
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOOPBACK_HOSTS.has(name.toLowerCase());
}

// ---------------------------------------------------------------------
// Nightshift discovery
// ---------------------------------------------------------------------

function nightshiftStateDirs(): string[] {
  const home = os.homedir();
  const dirs: (string | undefined)[] = [process.env.NIGHTSHIFT_STATE_DIR, process.env.METERLESS_STATE_DIR];
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ai.meterless.runtime'));
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'ai.meterless.runtime'));
  } else {
    dirs.push(path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'ai.meterless.runtime'));
    dirs.push(path.join(home, '.config', 'ai.meterless.runtime'));
  }
  return uniq(dirs).filter(exists);
}

function nightshiftToken(): { token: string | null; source: 'env' | 'file' | null } {
  const env = process.env.NIGHTSHIFT_TOKEN || process.env.METERLESS_TOKEN;
  if (env) return { token: env.trim(), source: 'env' };
  for (const dir of nightshiftStateDirs()) {
    const t = readText(path.join(dir, 'proxy-token'))?.trim();
    if (t) return { token: t, source: 'file' };
  }
  return { token: null, source: null };
}

// The runtime writes the port it serves on into its own config; reading it
// beats scanning (PRD v3 §20.6 asks for exactly this).
function nightshiftConfiguredOrigin(): string | null {
  for (const dir of nightshiftStateDirs()) {
    const toml = readText(path.join(dir, 'config.toml'));
    const m = toml?.match(/^\s*public_listen\s*=\s*"([^"]+)"/m);
    if (m) return toOrigin(m[1].replace(/^0\.0\.0\.0/, '127.0.0.1'));
  }
  return null;
}

function nightshiftLauncher(): string | null {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const root = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Nightshift');
    return [path.join(root, 'meterless-runtime.exe'), path.join(root, 'meterlessd.exe')].find(exists) || null;
  }
  if (process.platform === 'darwin') {
    return ['/Applications/Nightshift.app', path.join(home, 'Applications', 'Nightshift.app')].find(exists) || null;
  }
  return ['/usr/bin/meterless-runtime', '/usr/local/bin/meterless-runtime', '/usr/lib/meterless/meterless-runtime'].find(exists) || null;
}

let nsCache: { at: number; status: NightshiftStatus } | null = null;
let nsInflight: Promise<NightshiftStatus> | null = null;
let nsMisses = 0;

async function probeNightshift(force = false): Promise<NightshiftStatus> {
  if (!force && nsCache && Date.now() - nsCache.at < 3000) return nsCache.status;
  if (nsInflight) return nsInflight;
  nsInflight = (async () => {
    const { token, source } = nightshiftToken();
    const launcher = nightshiftLauncher();
    const installed = !!launcher || nightshiftStateDirs().length > 0;
    const candidates = uniq([
      toOrigin(process.env.NIGHTSHIFT_URL || process.env.METERLESS_URL),
      nightshiftConfiguredOrigin(),
      'http://127.0.0.1:8088', 'http://127.0.0.1:8090', 'http://localhost:8088', 'http://localhost:8090'
    ]);
    const auth = { Authorization: `Bearer ${token || 'rt-local'}`, 'meterless-app': APP_ID };

    let best: NightshiftStatus = {
      state: 'offline', origin: null, tokenSource: source, installed, canLaunch: !!launcher,
      modes: 0, classes: null,
      reason: installed ? 'Nightshift is installed but not running.' : 'Nightshift is not installed on this computer.'
    };

    for (const origin of candidates) {
      const health = await probe(`${origin}/healthz`, 2500);
      if (!health && origin !== nsCache?.status.origin) continue;   // nothing listening there
      const models = await probe(`${origin}/v1/models`, 6000, auth);
      if (models && (models.status === 401 || models.status === 403)) {
        best = { ...best, state: 'unauthorized', origin, reason: 'Nightshift is running but refused the access token.' };
        break;
      }
      if (models?.ok) {
        let count = 0;
        try {
          const body: any = await models.json();
          count = (body?.data || []).filter((m: any) => /^meterless([/-]|$)/.test(String(m?.id || ''))).length;
        } catch { /* not JSON */ }
        if (count > 0) {
          best = { ...best, state: 'online', origin, modes: count, reason: `Nightshift answered with ${count} routing modes.` };
          const classes = await probe(`${origin}/v1/meterless/classes`, 3000, auth);
          if (classes?.ok) {
            try { best.classes = normalizeClasses(await classes.json()); } catch { /* optional route */ }
          }
          break;
        }
      }
      if (health?.ok && best.state === 'offline') {
        best = { ...best, state: 'starting', origin, reason: 'Nightshift is starting up — models are still loading.' };
      }
    }
    // A runtime busy generating can miss one probe; don't flap the whole UI
    // to "off" mid-render. Two misses in a row and it really is down.
    const prev = nsCache?.status;
    if (prev?.state === 'online' && best.state !== 'online' && best.state !== 'unauthorized' && ++nsMisses < 3) {
      nsCache = { at: Date.now(), status: prev };
      return prev;
    }
    if (best.state === 'online') nsMisses = 0;
    nsCache = { at: Date.now(), status: best };
    return best;
  })();
  try { return await nsInflight; } finally { nsInflight = null; }
}

function normalizeClasses(data: any): NightshiftStatus['classes'] {
  const src = data?.classes || data?.data;
  if (!src || typeof src !== 'object') return null;
  const out: NonNullable<NightshiftStatus['classes']> = {};
  const put = (id: string, v: any) => {
    if (!id) return;
    if (typeof v === 'string') { out[id] = { availability: v, why: null }; return; }
    if (!v || typeof v !== 'object') return;
    out[id] = {
      availability: v.availability || v.state || null,
      why: v.why || null,
      ...(typeof v.chat_carrier === 'boolean' ? { chat_carrier: v.chat_carrier } : {})
    };
  };
  if (Array.isArray(src)) src.forEach((c: any) => put(c?.class || c?.id, c));
  else Object.keys(src).forEach(k => put(k, src[k]));
  return out;
}

// ---------------------------------------------------------------------
// ComfyUI discovery
// ---------------------------------------------------------------------

interface ComfyInstall { dir: string; python: string | null; desktopExe: string | null }

/** Where `npm run setup:comfy` last installed ComfyUI (any drive). */
function rememberedComfyDir(projectRoot: string): string | null {
  try { return JSON.parse(fs.readFileSync(path.join(projectRoot, 'engines', 'comfy-location.json'), 'utf8')).dir || null; }
  catch { return null; }
}

function comfyInstall(projectRoot: string): ComfyInstall | null {
  const home = os.homedir();
  const dirs = uniq([
    process.env.COMFYUI_DIR,
    rememberedComfyDir(projectRoot),
    path.join(projectRoot, 'engines', 'ComfyUI'),
    path.join(home, 'ComfyUI'),
    path.join(home, 'Documents', 'ComfyUI'),
    process.platform === 'win32' ? 'C:\\ComfyUI' : null,
    process.platform === 'win32' ? 'C:\\ComfyUI_windows_portable\\ComfyUI' : null,
    path.join(home, 'ComfyUI_windows_portable', 'ComfyUI'),
    path.join(home, 'Desktop', 'ComfyUI_windows_portable', 'ComfyUI')
  ]);
  for (const dir of dirs) {
    if (!exists(path.join(dir, 'main.py'))) continue;
    const win = process.platform === 'win32';
    const python = [
      path.join(dir, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python'),
      path.join(dir, 'venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python'),
      path.join(dir, '..', 'python_embeded', 'python.exe')
    ].find(exists) || null;
    return { dir, python, desktopExe: null };
  }
  const desktop = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', '@comfyorgcomfyui-electron', 'ComfyUI.exe')
    : process.platform === 'darwin' ? '/Applications/ComfyUI.app' : null;
  if (exists(desktop)) return { dir: path.dirname(desktop), python: null, desktopExe: desktop };
  return null;
}

let comfyCache: { at: number; status: ComfyStatus } | null = null;
let comfyInflight: Promise<ComfyStatus> | null = null;
let inventory: { stamp: number; origin: string; nodes: string[]; models: Record<string, string[]> } | null = null;

const MODEL_FOLDERS = ['checkpoints', 'diffusion_models', 'unet', 'text_encoders', 'clip', 'vae', 'loras', 'clip_vision', 'upscale_models'];

async function probeComfy(projectRoot: string, force = false): Promise<ComfyStatus> {
  if (!force && comfyCache && Date.now() - comfyCache.at < 3000) return comfyCache.status;
  if (comfyInflight) return comfyInflight;
  comfyInflight = (async () => {
    const install = comfyInstall(projectRoot);
    const candidates = uniq([
      toOrigin(process.env.COMFYUI_URL),
      'http://127.0.0.1:8188', 'http://127.0.0.1:8000', 'http://127.0.0.1:8189'
    ]);
    let status: ComfyStatus = {
      state: 'offline', origin: null, version: null, gpu: null,
      installed: !!install, canLaunch: !!install && (!!install.python || !!install.desktopExe),
      installDir: install?.dir || null, inventoryStamp: inventory?.stamp || 0,
      reason: install ? 'ComfyUI is installed but not running.' : 'ComfyUI is not installed yet.'
    };
    for (const origin of candidates) {
      const resp = await probe(`${origin}/system_stats`, 1500);
      if (!resp?.ok) continue;
      let stats: any = null;
      try { stats = await resp.json(); } catch { continue; }
      if (!stats?.system) continue;
      const dev = (stats.devices || [])[0];
      status = {
        ...status,
        state: 'online',
        origin,
        version: stats.system.comfyui_version || null,
        gpu: dev ? { name: String(dev.name || dev.type || 'GPU').replace(/^cuda:\d+\s*/, '').replace(/\s*:\s*cudaMallocAsync$/, ''), vramTotal: dev.vram_total || 0, vramFree: dev.vram_free || 0 } : null,
        reason: 'ComfyUI is running.'
      };
      if (!inventory || inventory.origin !== origin || force || Date.now() - inventory.stamp > 60_000) {
        await refreshInventory(origin);
      }
      status.inventoryStamp = inventory?.stamp || 0;
      break;
    }
    comfyCache = { at: Date.now(), status };
    return status;
  })();
  try { return await comfyInflight; } finally { comfyInflight = null; }
}

async function refreshInventory(origin: string) {
  const info = await probe(`${origin}/object_info`, 20_000);
  if (!info?.ok) return;
  let objectInfo: any = {};
  try { objectInfo = await info.json(); } catch { return; }
  const models: Record<string, string[]> = {};
  const folders = await probe(`${origin}/models`, 3000);
  let folderList: string[] = [];
  if (folders?.ok) { try { folderList = await folders.json(); } catch { /* older build */ } }
  for (const f of MODEL_FOLDERS.filter(x => !folderList.length || folderList.includes(x))) {
    const r = await probe(`${origin}/models/${f}`, 3000);
    if (r?.ok) { try { models[f] = await r.json(); } catch { /* skip */ } }
  }
  // Older builds without /models: the loader nodes list their own files.
  const fromNode = (node: string, input: string) => {
    const spec = objectInfo?.[node]?.input?.required?.[input];
    return Array.isArray(spec?.[0]) ? spec[0] as string[] : [];
  };
  models.checkpoints ||= fromNode('CheckpointLoaderSimple', 'ckpt_name');
  models.diffusion_models ||= fromNode('UNETLoader', 'unet_name');
  models.text_encoders ||= fromNode('CLIPLoader', 'clip_name');
  models.vae ||= fromNode('VAELoader', 'vae_name');
  models.loras ||= fromNode('LoraLoader', 'lora_name');
  inventory = { stamp: Date.now(), origin, nodes: Object.keys(objectInfo), models };
}

// ---------------------------------------------------------------------
// Launching
// ---------------------------------------------------------------------

function launchDetached(cmd: string, args: string[], opts: { cwd?: string; log?: string } = {}) {
  let stdio: any = 'ignore';
  if (opts.log) {
    fs.mkdirSync(path.dirname(opts.log), { recursive: true });
    const fd = fs.openSync(opts.log, 'a');
    stdio = ['ignore', fd, fd];
  }
  const child = spawn(cmd, args, { cwd: opts.cwd, detached: true, stdio, windowsHide: true });
  child.unref();
}

/**
 * Start a desktop app the way a double-click would, so it belongs to the
 * user's shell and keeps running when Standupify stops.
 */
function launchApp(exe: string) {
  if (process.platform === 'darwin') launchDetached('open', ['-a', exe]);
  else if (process.platform === 'win32') launchDetached('explorer.exe', [exe]);
  else launchDetached(exe, []);
}

function launchNightshift(): { ok: boolean; message: string } {
  const exe = nightshiftLauncher();
  if (!exe) return { ok: false, message: 'Nightshift is not installed. Download it from meterless.ai, then press Start again.' };
  launchApp(exe);
  nsCache = null;
  return { ok: true, message: 'Starting Nightshift…' };
}

function launchComfy(projectRoot: string): { ok: boolean; message: string } {
  const install = comfyInstall(projectRoot);
  if (!install) return { ok: false, message: 'ComfyUI is not installed. Run `npm run setup:comfy`, or install ComfyUI Desktop.' };
  if (install.desktopExe) {
    launchApp(install.desktopExe);
  } else if (install.python) {
    launchDetached(install.python, ['main.py', '--listen', '127.0.0.1', '--port', '8188', '--preview-method', 'auto'], {
      cwd: install.dir,
      log: path.join(projectRoot, 'engines', 'logs', 'comfyui.log')
    });
  } else {
    return { ok: false, message: `Found ComfyUI at ${install.dir} but no Python next to it.` };
  }
  comfyCache = null;
  return { ok: true, message: 'Starting ComfyUI… the first launch takes about a minute.' };
}

// ---------------------------------------------------------------------
// Proxy
// ---------------------------------------------------------------------

function proxyHttp(req: IncomingMessage, res: ServerResponse, origin: string, upstreamPath: string, extra: Record<string, string>) {
  const target = new URL(origin);
  const headers: Record<string, any> = { ...req.headers };
  for (const h of ['host', 'origin', 'referer', 'cookie', 'connection']) delete headers[h];
  headers.host = target.host;
  Object.assign(headers, extra);
  const upstream = http.request({
    hostname: target.hostname.replace(/^\[|\]$/g, ''),
    port: target.port || 80,
    method: req.method,
    path: upstreamPath,
    headers
  }, (up) => {
    const h = { ...up.headers };
    delete h['access-control-allow-origin'];
    res.writeHead(up.statusCode || 502, h);
    up.pipe(res);
  });
  upstream.setTimeout(30 * 60_000);
  upstream.on('error', (e) => {
    if (!res.headersSent) sendJson(res, 502, { error: { message: `Could not reach ${origin}: ${e.message}`, code: 'engine_unreachable' } });
    else res.destroy();
  });
  req.pipe(upstream);
}

function proxyUpgrade(req: IncomingMessage, socket: net.Socket, head: Buffer, origin: string, upstreamPath: string) {
  const target = new URL(origin);
  const up = net.connect(Number(target.port || 80), target.hostname.replace(/^\[|\]$/g, ''), () => {
    let raw = `GET ${upstreamPath} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === 'origin' || v == null) continue;
      for (const one of Array.isArray(v) ? v : [v]) raw += `${k}: ${one}\r\n`;
    }
    raw += `host: ${target.host}\r\n\r\n`;
    up.write(raw);
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

// ---------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------

export function standupifyBridge(): Plugin {
  let projectRoot = process.cwd();
  // The Station: the Circuit's engine, running in this process (see server/station.ts).
  let station: { handleStation(req: IncomingMessage, res: ServerResponse, p: string): Promise<boolean> } | null = null;
  const stationWanted = process.env.STANDUPIFY_STATION !== '0';
  let stationFailed = false;

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url || '';
    if (!url.startsWith('/api/')) return next();
    if (!hostIsLoopback(req)) return sendJson(res, 403, { error: { message: 'The Standupify bridge only answers this computer.' } });
    handle(req, res).catch((e) => {
      if (!res.headersSent) sendJson(res, 500, { error: { message: e?.message || String(e) } });
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', 'http://bridge');
    const p = url.pathname;
    const force = url.searchParams.has('refresh');

    if (p === '/api/status' && req.method === 'GET') {
      const [nightshift, comfy] = await Promise.all([probeNightshift(force), probeComfy(projectRoot, force)]);
      return sendJson(res, 200, { bridge: { version: BRIDGE_VERSION, app: APP_ID, platform: process.platform }, nightshift, comfy });
    }

    if (p === '/api/comfy-inventory' && req.method === 'GET') {
      const st = await probeComfy(projectRoot, force);
      if (st.state !== 'online' || !inventory) return sendJson(res, 200, { stamp: 0, nodes: [], models: {} });
      return sendJson(res, 200, inventory);
    }

    if (p === '/api/workflows' && req.method === 'GET') {
      const dir = path.join(projectRoot, 'workflows');
      const out: { file: string; graph: unknown }[] = [];
      try {
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
          try { out.push({ file: f, graph: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }); } catch { /* skip bad file */ }
        }
      } catch { /* no folder */ }
      return sendJson(res, 200, { data: out });
    }

    if (p.startsWith('/api/launch/') && req.method === 'POST') {
      // A custom header can't be set by a cross-site form: cheap CSRF guard.
      if (req.headers['x-standupify'] !== '1') return sendJson(res, 403, { error: { message: 'missing x-standupify header' } });
      const which = p.slice('/api/launch/'.length);
      if (which === 'nightshift') return sendJson(res, 200, launchNightshift());
      if (which === 'comfy') return sendJson(res, 200, launchComfy(projectRoot));
      return sendJson(res, 404, { error: { message: 'unknown engine' } });
    }

    if (p.startsWith('/api/station/')) {
      if (!station) return sendJson(res, stationWanted && !stationFailed ? 503 : 404, { error: { message: stationWanted && !stationFailed ? 'The Station is starting.' : 'No Station in this process.' }, starting: stationWanted && !stationFailed });
      await station.handleStation(req, res, p);
      return;
    }

    if (p.startsWith('/api/nightshift/')) {
      const st = await probeNightshift();
      if (!st.origin || st.state === 'offline') {
        return sendJson(res, 503, { error: { message: 'Nightshift is not running.', code: 'runtime_unreachable' }, meterless: { fix: ['Press Start next to Nightshift.'] } });
      }
      const { token } = nightshiftToken();
      const extra: Record<string, string> = { 'meterless-app': APP_ID };
      if (token) extra.authorization = `Bearer ${token}`;
      return proxyHttp(req, res, st.origin, p.slice('/api/nightshift'.length) + url.search, extra);
    }

    if (p.startsWith('/api/comfy/')) {
      const st = await probeComfy(projectRoot);
      if (!st.origin) return sendJson(res, 503, { error: { message: 'ComfyUI is not running.', code: 'comfy_unreachable' } });
      return proxyHttp(req, res, st.origin, p.slice('/api/comfy'.length) + url.search, {});
    }

    sendJson(res, 404, { error: { message: `No bridge route ${p}` } });
  }

  function attachUpgrade(server: Server | null | undefined) {
    server?.on('upgrade', (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
      if (!(req.url || '').startsWith('/api/comfy/ws')) return;   // Vite's HMR socket is not ours
      if (!hostIsLoopback(req)) return socket.destroy();
      probeComfy(projectRoot).then(st => {
        if (!st.origin) return socket.destroy();
        proxyUpgrade(req, socket, head, st.origin, (req.url || '').slice('/api/comfy'.length));
      }).catch(() => socket.destroy());
    });
  }

  return {
    name: 'standupify-bridge',
    configResolved(config) { projectRoot = config.root; },
    configureServer(server) {
      server.middlewares.use(middleware);
      attachUpgrade(server.httpServer as Server | null);
      if (!stationWanted) return;
      // Loaded through Vite's SSR loader so the Station runs the app's own engine code.
      server.httpServer?.once('listening', () => {
        server.ssrLoadModule('/server/station.ts').then(async (m: any) => {
          await m.startStation(projectRoot, {
            status: async () => ({ nightshift: await probeNightshift(), comfy: await probeComfy(projectRoot) }),
            token: () => nightshiftToken().token
          });
          station = m;
        }).catch((e: any) => { stationFailed = true; console.warn(`Station did not start: ${e?.stack || e?.message || e}`); });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
      attachUpgrade(server.httpServer as Server | null);
    }
  };
}
