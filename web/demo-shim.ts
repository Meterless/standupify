// =====================================================================
// Web demo shim — `npm run build:web` only.
//
// A static host has no Node bridge, so this answers the bridge's routes
// from inside the page before the app makes its first request:
//
//   ./api/status, ./api/comfy-inventory, ./api/workflows, ./api/launch/*
//   /api/nightshift/*   → the demo Nightshift (web/demo-engines.ts)
//   /api/comfy/*        → the demo ComfyUI, plus its /ws progress socket
//   ./api/station/*     → 404: no Station, so the Circuit runs in the page
//
// Everything else (fonts, assets, a Nightshift or ComfyUI the visitor
// connects directly) goes to the real network untouched.
// =====================================================================

/// <reference types="vite/client" />

import * as demo from './demo-engines';
import { PREVIEW_SEGMENTS } from '../services/tv/preview';

const REPO = 'https://github.com/Meterless/standupify';

const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** The bridge route of a same-origin URL ("status", "nightshift/v1/models", …), or null. */
function bridgeRoute(url: URL): string | null {
  if (url.origin !== location.origin) return null;
  const m = /(?:^|\/)api\/(.+)$/.exec(url.pathname);
  return m ? m[1] : null;
}

async function readBody(req: Request): Promise<any> {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const type = req.headers.get('content-type') || '';
  if (type.includes('multipart/form-data')) return null;
  const text = await req.text().catch(() => '');
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

const STATUS = () => ({
  bridge: { version: 1, app: 'standupify', platform: 'web' },
  nightshift: {
    state: 'online', origin: 'demo engine (in your browser)', tokenSource: 'env', installed: true, canLaunch: false,
    modes: demo.NIGHTSHIFT_MODES, classes: demo.NIGHTSHIFT_CLASSES,
    reason: `Web demo: a sample Nightshift answers with ${demo.NIGHTSHIFT_MODES} routing modes, right here in your browser.`
  },
  comfy: {
    state: 'online', origin: '/api/comfy', version: demo.COMFY_STATS.system.comfyui_version,
    gpu: { name: demo.COMFY_STATS.devices[0].name, vramTotal: demo.COMFY_STATS.devices[0].vram_total, vramFree: demo.COMFY_STATS.devices[0].vram_free },
    installed: true, canLaunch: false, installDir: null, inventoryStamp: INVENTORY_STAMP,
    reason: 'Web demo: a sample ComfyUI draws procedural frames in your browser.'
  }
});

const INVENTORY_STAMP = Date.now();
const WORKFLOWS = Object.entries(import.meta.glob('../workflows/*.json', { eager: true, import: 'default' }))
  .map(([file, graph]) => ({ file: file.split('/').pop(), graph }));

async function answer(route: string, url: URL, req: Request): Promise<Response> {
  const base = { method: req.method.toUpperCase(), search: url.searchParams, headers: req.headers };
  if (route === 'status') return json(200, STATUS());
  if (route === 'comfy-inventory') return json(200, { stamp: INVENTORY_STAMP, origin: '/api/comfy', nodes: demo.COMFY_NODES, models: demo.COMFY_MODELS });
  if (route === 'workflows') return json(200, { data: WORKFLOWS });
  if (route.startsWith('launch/')) return json(200, { ok: true, message: 'The demo engines are already running in your browser.' });
  if (route.startsWith('station/')) return json(404, { error: { message: 'No Station in the web demo; the Circuit runs in this page.' }, starting: false });
  if (route.startsWith('nightshift/')) return demo.nightshift({ ...base, path: `/${route.slice('nightshift/'.length)}`, body: await readBody(req) });
  if (route.startsWith('comfy/')) return demo.comfy({ ...base, path: `/${route.slice('comfy/'.length)}`, body: await readBody(req) });
  return json(404, { error: { message: `No bridge route /api/${route}` } });
}

function installFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = input instanceof Request ? input.url : String(input);
    const url = new URL(href, location.href);
    const route = bridgeRoute(url);
    if (!route) return real(input, init);
    const req = new Request(input instanceof Request ? input : url, init);
    if (req.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    return answer(route, url, req);
  };
}

function installWebSocket() {
  const Real = window.WebSocket;
  const Shim = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url).replace(/^ws/, 'http'), location.href);
    if (bridgeRoute(u)?.startsWith('comfy/ws')) return new demo.DemoSocket(String(url), u.searchParams.get('clientId') || crypto.randomUUID());
    return new Real(url, protocols);
  } as unknown as typeof WebSocket;
  Object.assign(Shim, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  Shim.prototype = Real.prototype;
  window.WebSocket = Shim;
}

function showBadge() {
  const add = () => {
    if (document.getElementById('standupify-web-demo')) return;
    const a = document.createElement('a');
    a.id = 'standupify-web-demo';
    a.href = REPO;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Everything here runs in your browser on sample engines. Run Standupify on your own GPU with Nightshift and ComfyUI for real comedians and real footage.';
    a.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#ffb547;display:inline-block"></span>Web demo · sample engines · <u>run it for real</u>';
    Object.assign(a.style, {
      position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483000', display: 'inline-flex', alignItems: 'center', gap: '8px',
      padding: '6px 12px', borderRadius: '999px', background: 'rgba(11,11,12,.88)', color: '#e9e6df', border: '1px solid rgba(255,181,71,.35)',
      font: '500 12px/1.2 Manrope, system-ui, sans-serif', textDecoration: 'none', backdropFilter: 'blur(6px)', boxShadow: '0 4px 18px rgba(0,0,0,.35)'
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(a);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add, { once: true });
}

/** The home page's sample show plays the Station's real frames of the same comics. */
function dressPreview() {
  for (const seg of PREVIEW_SEGMENTS) {
    const c = demo.demoMedia().find(m => m.name === seg.name);
    if (!c) continue;
    seg.headshot = c.headshot;
    seg.image = c.stills[0] || c.headshot;
    seg.clips = c.clips.slice(0, 4);
    if (c.clips[0]) seg.video = c.clips[0];
  }
}

export async function installWebDemo() {
  installFetch();
  installWebSocket();
  await demo.loadDemoMedia();
  dressPreview();
  showBadge();
  console.info('[standupify] web demo: Nightshift and ComfyUI are simulated in this page.');
}
