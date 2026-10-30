// =====================================================================
// Engine status — the one health funnel every screen listens to.
//
// With the local bridge (npm start) everything is discovered for the user.
// Without it (a static build on some host) we fall back to direct mode:
// a base URL + token the user pasted, or a Quick Connect link.
// =====================================================================

import { useSyncExternalStore } from 'react';
import { emit } from './bus';
import { normalizeBaseUrl, parseConnectLink } from './nightshift/modes';

export type NightshiftState = 'online' | 'unauthorized' | 'starting' | 'offline' | 'unknown';
export type ComfyState = 'online' | 'offline' | 'unknown';

export interface NightshiftStatus {
  state: NightshiftState;
  origin: string | null;
  tokenSource: 'env' | 'file' | 'pasted' | null;
  installed: boolean;
  canLaunch: boolean;
  modes: number;
  classes: Record<string, { availability: string | null; why: string | null; chat_carrier?: boolean }> | null;
  reason: string;
}

export interface ComfyStatus {
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

export interface EngineSnapshot {
  bridge: boolean;
  platform: string | null;
  nightshift: NightshiftStatus;
  comfy: ComfyStatus;
  checkedAt: number;
  launching: { nightshift?: number; comfy?: number };
}

const DIRECT_BASE_KEY = 'meterless_meterless_base_url';   // shared across Meterless apps (PRD v3 §3)
const DIRECT_TOKEN_KEY = 'meterless_runtime_token';
const DIRECT_COMFY_KEY = 'standupify_comfy_url';

function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sandboxed */ }
}

const unknownNs: NightshiftStatus = { state: 'unknown', origin: null, tokenSource: null, installed: false, canLaunch: false, modes: 0, classes: null, reason: 'Checking…' };
const unknownComfy: ComfyStatus = { state: 'unknown', origin: null, version: null, gpu: null, installed: false, canLaunch: false, installDir: null, inventoryStamp: 0, reason: 'Checking…' };

let snapshot: EngineSnapshot = { bridge: true, platform: null, nightshift: unknownNs, comfy: unknownComfy, checkedAt: 0, launching: {} };
const listeners = new Set<() => void>();

function publish(next: Partial<EngineSnapshot>) {
  const prev = snapshot;
  snapshot = { ...snapshot, ...next };
  listeners.forEach(l => l());
  if (prev.nightshift.state !== snapshot.nightshift.state) {
    emit('meterless:health', { state: snapshot.nightshift.state, checkedAt: Date.now() });
  }
  if (prev.comfy.inventoryStamp !== snapshot.comfy.inventoryStamp || prev.comfy.state !== snapshot.comfy.state) {
    emit('standupify:comfy-changed');
  }
}

export function getEngines(): EngineSnapshot { return snapshot; }

export function subscribeEngines(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useEngines(): EngineSnapshot {
  return useSyncExternalStore(subscribeEngines, getEngines, getEngines);
}

/** A failed request is the freshest health signal there is (§11.4). */
export function markNightshiftOffline(reason: string) {
  if (snapshot.nightshift.state === 'online') {
    publish({ nightshift: { ...snapshot.nightshift, state: 'offline', reason } });
    void refreshEngines(true);
  }
}

// ---------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------

// The Station (headless, inside npm start) talks to the engines directly.
let headless: { nightshiftBase: string; token: string | null; comfyBase: string } | null = null;

export function configureHeadless(h: { nightshiftBase: string; token: string | null; comfyBase: string }) {
  headless = h;
  snapshot = { ...snapshot, bridge: false };
}

/** The Station feeds engine status from the bridge probes instead of polling. */
export function setEngineStatus(nightshift: NightshiftStatus, comfy: ComfyStatus) {
  publish({ nightshift, comfy, checkedAt: Date.now() });
}

export function nightshiftBase(): string {
  if (headless) return headless.nightshiftBase;
  return snapshot.bridge ? '/api/nightshift/v1' : normalizeBaseUrl(lsGet(DIRECT_BASE_KEY) || '');
}

/** Bridge mode adds the token server-side; direct mode sends the pasted one. */
export function nightshiftAuthHeaders(): Record<string, string> {
  if (headless) return { 'meterless-app': 'standupify', ...(headless.token ? { Authorization: `Bearer ${headless.token}` } : {}) };
  if (snapshot.bridge) return {};
  return { Authorization: `Bearer ${lsGet(DIRECT_TOKEN_KEY) || 'rt-local'}` };
}

export function comfyBase(): string {
  if (headless) return headless.comfyBase;
  return snapshot.bridge ? '/api/comfy' : (lsGet(DIRECT_COMFY_KEY) || 'http://127.0.0.1:8188').replace(/\/+$/, '');
}

export function comfyWsUrl(clientId: string): string {
  if (headless) return `${headless.comfyBase.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
  if (snapshot.bridge) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/api/comfy/ws?clientId=${encodeURIComponent(clientId)}`;
  }
  return `${comfyBase().replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
}

/** Direct mode only. Accepts a base URL or a Quick Connect link. */
export function connectNightshiftDirect(input: string, token?: string) {
  const link = parseConnectLink(input);
  if (link) {
    lsSet(DIRECT_BASE_KEY, link.baseUrl);
    lsSet(DIRECT_TOKEN_KEY, link.token);
  } else {
    lsSet(DIRECT_BASE_KEY, normalizeBaseUrl(input));
    if (token != null) lsSet(DIRECT_TOKEN_KEY, token.trim() || null);
  }
  return refreshEngines(true);
}

export function connectComfyDirect(url: string) {
  lsSet(DIRECT_COMFY_KEY, url.trim() || null);
  return refreshEngines(true);
}

// ---------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------

let inflight: Promise<void> | null = null;

export function refreshEngines(force = false): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const resp = await fetch(`./api/status${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const isJson = (resp.headers.get('content-type') || '').includes('application/json');
      if (resp.ok && isJson) {
        const body = await resp.json();
        publish({ bridge: true, platform: body.bridge?.platform || null, nightshift: body.nightshift, comfy: body.comfy, checkedAt: Date.now() });
        settleLaunches();
        return;
      }
    } catch { /* no bridge */ }
    await probeDirect();
  })();
  return inflight.finally(() => { inflight = null; });
}

async function timedFetch(url: string, init: RequestInit = {}, ms = 3000): Promise<Response | null> {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) }); } catch { return null; }
}

async function probeDirect() {
  snapshot = { ...snapshot, bridge: false };
  const base = nightshiftBase();
  const hasToken = !!lsGet(DIRECT_TOKEN_KEY);
  let ns: NightshiftStatus = { ...unknownNs, state: 'offline', origin: base.replace(/\/v1$/, ''), tokenSource: hasToken ? 'pasted' : null, reason: `Nothing answered at ${base}.` };
  const models = await timedFetch(`${base}/models`, { headers: nightshiftAuthHeaders() });
  if (models && (models.status === 401 || models.status === 403)) {
    ns = { ...ns, state: 'unauthorized', reason: 'Nightshift is running but refused the access token.' };
  } else if (models?.ok) {
    const body = await models.json().catch(() => null);
    const count = (body?.data || []).filter((m: any) => /^meterless([/-]|$)/.test(String(m?.id || ''))).length;
    if (count) ns = { ...ns, state: 'online', modes: count, reason: `Nightshift answered with ${count} routing modes.` };
  }

  const comfyUrl = comfyBase();
  let comfy: ComfyStatus = { ...unknownComfy, state: 'offline', reason: `Nothing answered at ${comfyUrl}.` };
  const stats = await timedFetch(`${comfyUrl}/system_stats`);
  if (stats?.ok) {
    const s = await stats.json().catch(() => null);
    const dev = s?.devices?.[0];
    comfy = {
      ...comfy, state: 'online', origin: comfyUrl, version: s?.system?.comfyui_version || null,
      gpu: dev ? { name: String(dev.name || 'GPU'), vramTotal: dev.vram_total || 0, vramFree: dev.vram_free || 0 } : null,
      inventoryStamp: snapshot.comfy.inventoryStamp || Date.now(), reason: 'ComfyUI is running.'
    };
  }
  publish({ nightshift: ns, comfy, checkedAt: Date.now() });
}

// ---------------------------------------------------------------------
// Launching (bridge only)
// ---------------------------------------------------------------------

export async function launchEngine(engine: 'nightshift' | 'comfy'): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await fetch(`./api/launch/${engine}`, { method: 'POST', headers: { 'x-standupify': '1' } });
    const body = await resp.json();
    if (body.ok) publish({ launching: { ...snapshot.launching, [engine]: Date.now() } });
    return body;
  } catch {
    return { ok: false, message: 'Start Standupify with `npm start` so it can launch engines for you.' };
  }
}

function settleLaunches() {
  const l = { ...snapshot.launching };
  let changed = false;
  for (const k of ['nightshift', 'comfy'] as const) {
    const started = l[k];
    if (!started) continue;
    const up = k === 'nightshift' ? snapshot.nightshift.state === 'online' || snapshot.nightshift.state === 'unauthorized' : snapshot.comfy.state === 'online';
    if (up || Date.now() - started > 4 * 60_000) { delete l[k]; changed = true; }
  }
  if (changed) publish({ launching: l });
}

// Poll quickly while something is starting, gently otherwise, never while hidden.
let timer: ReturnType<typeof setTimeout> | undefined;
let polling = false;
export function startEnginePolling() {
  if (polling) return;
  polling = true;
  const loop = async () => {
    if (document.visibilityState === 'visible') await refreshEngines().catch(() => undefined);
    const busy = snapshot.launching.nightshift || snapshot.launching.comfy
      || snapshot.nightshift.state === 'starting' || snapshot.nightshift.state === 'unknown';
    timer = setTimeout(loop, busy ? 2000 : 6000);
  };
  void loop();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshEngines(); });
}
