// =====================================================================
// Station client — when `npm start` runs the Circuit (server/station.ts),
// this page becomes a window onto it: the roster lives on disk, commands go
// to the Station, and the live show streams in. Closing the tab changes
// nothing; the clubs stay open.
// =====================================================================

import { getRepository, setRepository, type Repository } from '../repository';
import * as store from '../league/store';
import { attachStation, applyStationSnapshot } from '../league/engine';
import { setRemoteTasks, type StudioTask } from '../tasks';
import { attachOriginalsStation } from '../premium/production';
import { attachAutopilotStation, applyAutopilotStatus } from '../autopilot';

const HEADERS = { 'content-type': 'application/json', 'x-standupify': '1' };

async function post(route: string, body: unknown) {
  const r = await fetch(`./api/station/${route}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || `The Station could not ${route}.`);
  return j;
}

/** Every Repository method, answered by the Station. */
function remoteRepository(): Repository {
  return new Proxy({} as Repository, {
    get: (_t, method) => {
      if (typeof method !== 'string' || method === 'then') return undefined;   // not a thenable
      return async (...args: unknown[]) => (await post('repo', { method, args })).result ?? undefined;
    }
  });
}

let connected = false;
export const stationConnected = () => connected;

/** Hand this browser's roster + Circuit to a brand-new Station, once. */
async function handOver() {
  const local = getRepository();   // still IndexedDB at this point
  const comedians = await local.listComedians();
  const each = async <T>(fn: (id: string) => Promise<T[]>) => (await Promise.all(comedians.map(c => fn(c.id)))).flat();
  const body = {
    comedians,
    sets: await each(id => local.listSets(id)),
    clips: await each(id => local.listClips(id)),
    promos: await each(id => local.listPromos(id)),
    scouts: await each(id => local.listScouts(id)),
    jobs: await local.listJobs(),
    outbox: await local.listOutbox(),
    settings: await local.getSettings(),
    circuit: { state: await store.loadState().catch(() => undefined), shows: await store.recentShows(100_000).catch(() => []) }
  };
  const out = await post('import', body);
  if (out.comedians || out.circuit) console.info(`[station] moved ${out.comedians} comedians, ${out.sets} sets and ${out.shows} shows to the Station.`);
}

function listen() {
  let chain = Promise.resolve();
  const es = new EventSource('./api/station/stream');
  es.addEventListener('snapshot', (e) => {
    const snap = JSON.parse((e as MessageEvent).data);
    chain = chain.then(() => applyStationSnapshot(snap)).catch(() => { /* next one */ });
  });
  es.addEventListener('live', (e) => {
    const live = JSON.parse((e as MessageEvent).data);
    chain = chain.then(() => store.publishCircuit({ live }));
  });
  es.addEventListener('tasks', (e) => setRemoteTasks(JSON.parse((e as MessageEvent).data) as StudioTask[]));
  es.addEventListener('autopilot', (e) => applyAutopilotStatus(JSON.parse((e as MessageEvent).data)));
}

/** Called once at boot, before the app reads anything. False = no Station; run in the page. */
export async function connectStation(): Promise<boolean> {
  let hello: { ok?: boolean; empty?: boolean; starting?: boolean } | null = null;
  // Right after `npm start` the Station may still be booting: wait for it rather than run a second Circuit here.
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('./api/station/hello', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!(r.headers.get('content-type') || '').includes('application/json')) break;
      hello = await r.json();
      if (r.ok || !hello?.starting) break;
    } catch { break; /* static host, or the Station is off */ }
    await new Promise(res => setTimeout(res, 500));
  }
  if (!hello?.ok) return false;
  try {
    if (hello.empty) await handOver();
  } catch (e) {
    console.warn('[station] hand-over failed; this page runs the Circuit itself.', e);
    return false;
  }
  setRepository(remoteRepository());
  attachStation({
    cmd: async (name, ...args) => (await post('cmd', { name, args })).result,
    snapshot: async () => (await fetch('./api/station/snapshot', { cache: 'no-store' })).json()
  });
  attachOriginalsStation(async (name, ...args) => (await post('cmd', { name, args })).result);
  attachAutopilotStation(async (name, ...args) => (await post('cmd', { name, args })).result);
  listen();
  connected = true;
  // The stream carries the same initial state and reconnects automatically.
  // A transient status request failure must not leave half-attached proxies.
  try { applyAutopilotStatus((await post('cmd', { name: 'autopilotStatus', args: [] })).result); }
  catch (e) { console.warn('[station] Night Shift status will reconnect through the stream.', e); }
  return true;
}
