import type { Comedian, AISettings, AutopilotJob, AgentName, Set as ComedySet } from '../types';
import { getRepository } from './repository';
import { getScheduler } from './scheduler';
import { getEngines } from './engines';
import { runWriter } from './agents/writer';
import { runClipper } from './agents/clipper';
import { runPromoter } from './agents/promoter';
import { runScout } from './agents/scout';
import { runAnalytics } from './agents/analytics';
import { runBooker } from './agents/booker';
import { submitSetToOutbox } from './publisher';
import { animateBit } from './studio';

// One production queue owns Night Shift. In npm start it lives in the Station;
// a static build uses the same worker in the browser and remembers its intent.
export interface AutopilotStatus {
  running: boolean;
  owner?: 'station' | 'browser';
  stopping?: boolean;
  waiting?: string;
  error?: string;
  currentJob?: AutopilotJob;
  lastTick?: number;
  history: AutopilotJob[];
}
export type StatusListener = (status: AutopilotStatus) => void;
type Step = AgentName | 'video' | 'outbox';
interface CycleCheckpoint {
  startedAt: number;
  setId?: string;
  completed: Step[];
  retryAfter?: number;
}
export interface AutopilotState {
  enabled: boolean;
  tickIntervalMs: number;
  cycles: Record<string, CycleCheckpoint>;
}
export interface AutopilotPersistence {
  load(): Promise<Partial<AutopilotState> | null>;
  save(state: AutopilotState): Promise<void>;
}

const STORAGE_KEY = 'standupify_night_shift';
let persistence: AutopilotPersistence = {
  async load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } },
  async save(state) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private browsing still works for this visit */ } }
};
let state: AutopilotState = { enabled: false, tickIntervalMs: 30_000, cycles: {} };
let initialized: Promise<void> | null = null;
let settings: AISettings | null = null;
let owner: 'station' | 'browser' = 'browser';
let currentJob: AutopilotJob | undefined;
let lastTick: number | undefined;
let waiting: string | undefined;
let error: string | undefined;
let stopVersion = 0;
let stopRequested = false;
let lastStatus: AutopilotStatus = { running: false, owner, history: [] };
const listeners = new Set<StatusListener>();
const inFlight = new Map<string, Promise<void>>();
let queue: Promise<void> = Promise.resolve();
let station: ((name: string, ...args: unknown[]) => Promise<any>) | null = null;

export function configureAutopilotPersistence(p: AutopilotPersistence) {
  persistence = p;
  owner = 'station';
}

export function attachAutopilotStation(cmd: (name: string, ...args: unknown[]) => Promise<any>) {
  getScheduler().stop();
  station = cmd;
  owner = 'station';
}

export function applyAutopilotStatus(status: AutopilotStatus) {
  lastStatus = { ...status, owner: station ? 'station' : owner };
  for (const listener of listeners) {
    try { listener(lastStatus); } catch (e) { console.warn('Night Shift listener', e); }
  }
}

export function setSettings(s: AISettings) { settings = s; }
export function onStatus(listener: StatusListener) {
  listeners.add(listener);
  listener(lastStatus);
  return () => { listeners.delete(listener); };
}

export async function getAutopilotStatus(): Promise<AutopilotStatus> {
  if (station) return lastStatus;
  const history = (await getRepository().listJobs()).slice(0, 25);
  return { running: state.enabled && getScheduler().isRunning(), owner, stopping: stopRequested && !!currentJob, waiting, error, currentJob, lastTick, history };
}

async function emit() {
  try { applyAutopilotStatus(await getAutopilotStatus()); }
  catch (e) { console.warn('Night Shift status', e); }
}

const saveState = () => persistence.save(structuredClone(state));
const uid = () => `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const message = (e: unknown) => e instanceof Error ? e.message : String(e);

async function initialize() {
  if (!initialized) initialized = (async () => {
    const saved = await persistence.load();
    if (saved) state = {
      enabled: saved.enabled === true,
      tickIntervalMs: Math.max(1000, Number(saved.tickIntervalMs) || 30_000),
      cycles: saved.cycles && typeof saved.cycles === 'object' ? saved.cycles : {}
    };
    // A process restart cannot still be running yesterday's job. Completed
    // assets and the cycle checkpoint resume its remaining work below.
    for (const job of await getRepository().listJobs()) {
      if (job.status !== 'running') continue;
      await getRepository().saveJob({ ...job, status: 'failed', finishedAt: Date.now(), error: 'Interrupted by a restart. The saved production will resume when Night Shift is open.' });
    }
    await emit();
  })().catch(e => { initialized = null; throw e; });
  await initialized;
}

async function runJob<T>(comedianId: string, agent: AgentName, work: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const job: AutopilotJob = { id: uid(), comedianId, agent, status: 'running', scheduledFor: now, startedAt: now, createdAt: now };
  currentJob = job;
  try {
    await getRepository().saveJob(job);
    await emit();
    const result = await work();
    job.status = 'done';
    try { job.result = JSON.parse(JSON.stringify(result, (_k, v) => typeof v === 'string' && v.length > 500 ? `[${v.length} chars]` : v)); } catch { /* void result */ }
    return result;
  } catch (e) {
    job.status = 'failed';
    job.error = message(e);
    error = job.error;
    throw e;
  } finally {
    job.finishedAt = Date.now();
    currentJob = undefined;
    await getRepository().saveJob(job);
    await emit();
  }
}

// A paused scheduler finishes the current agent, then leaves the saved cycle
// ready to resume. Manual Run now can work for a comedian who is off shift.
class ShiftPaused extends Error { constructor() { super('Night Shift paused. Your progress is saved.'); } }
async function workCycle(id: string, scheduled: boolean, version: number) {
  const repo = getRepository();
  const freshComedian = async () => {
    const c = await repo.getComedian(id);
    if (!c) { delete state.cycles[id]; await saveState(); throw new ShiftPaused(); }
    if (version !== stopVersion || (scheduled && (!state.enabled || !c.autopilotConfig.enabled || c.status === 'paused' || c.status === 'archived'))) throw new ShiftPaused();
    return c;
  };
  let c = await freshComedian();
  if (!settings) throw new Error('Night Shift settings are not ready.');
  const cycleSettings = { ...settings };
  const checkpoint = state.cycles[id] ||= { startedAt: Date.now(), completed: [] };
  // Reserve ownership before the model runs. Circuit sets use generatedBy=
  // 'autopilot' too, so timestamps cannot identify this production on recovery.
  checkpoint.setId ||= `set_shift_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  await saveState();
  let set: ComedySet | undefined = await repo.getSet(checkpoint.setId);
  if (!set) {
    const out = await runJob(id, 'writer', () => runWriter(cycleSettings, c, 'autopilot', checkpoint.setId));
    set = out.set;
  }
  checkpoint.setId = set.id;
  if (!checkpoint.completed.includes('writer')) checkpoint.completed.push('writer');
  await saveState();

  const step = async (key: Step, agent: AgentName, work: () => Promise<unknown>, optional = true) => {
    c = await freshComedian();
    if (checkpoint.completed.includes(key)) return;
    try { await runJob(id, agent, work); }
    catch (e) { if (!optional) throw e; /* optional failures are recorded; the next agent can still deliver value */ }
    checkpoint.completed.push(key);
    await saveState();
    set = (await repo.getSet(set!.id)) || set;
  };
  await step('clipper', 'clipper', async () => {
    const existing = (await repo.listClips(id)).filter(x => x.setId === set!.id);
    const missing = Math.max(0, c.autopilotConfig.clipsPerSet - existing.length);
    return missing ? runClipper(cycleSettings, c, set!, missing) : existing;
  });
  await step('video', 'clipper', async () => {
    const bit = set!.bits[0];
    if (!c.autopilotConfig.generateVideo || !bit || bit.videoUrl) return;
    const videoUrl = await animateBit(c, bit, cycleSettings.cameraMove, cycleSettings);
    const fresh = await repo.getSet(set!.id);
    if (!fresh) return;
    fresh.bits = fresh.bits.map(b => b.id === bit.id ? { ...b, videoUrl, videoStatus: 'completed' as const, cameraMove: cycleSettings.cameraMove } : b);
    await repo.saveSet(fresh);
    for (const clip of (await repo.listClips(id)).filter(x => x.setId === fresh.id && x.sourceBitId === bit.id)) {
      await repo.saveClip({ ...clip, videoUrl });
    }
  });
  await step('promoter', 'promoter', async () => {
    const existing = (await repo.listPromos(id)).find(p => p.setId === set!.id);
    return existing || runPromoter(cycleSettings, c, set!);
  });
  await step('scout', 'scout', async () => {
    const count = (await repo.listScouts(id)).filter(s => s.createdAt >= checkpoint.startedAt).length;
    return count < 2 ? runScout(cycleSettings, c, 2 - count) : undefined;
  });
  await step('analytics', 'analytics', () => runAnalytics(c));
  await step('booker', 'booker', () => runBooker());
  c = await freshComedian();
  if (!c.autopilotConfig.requireApproval) {
    await step('outbox', 'booker', async () => {
      const fresh = await repo.getSet(set!.id);
      if (!fresh) return;
      // A previous attempt may have saved only the set or some clips.
      await submitSetToOutbox(fresh);
      const latest = await repo.getSet(fresh.id);
      if (latest && latest.status !== 'published') {
        latest.status = 'submitted';
        await repo.saveSet(latest);
      }
    }, false);
  }
  // Reread after long-running generation; do not undo a user's off-shift
  // toggle, profile edits, or changes made by another worker.
  const latest = await repo.getComedian(id);
  if (latest) {
    latest.autopilotConfig = { ...latest.autopilotConfig, lastSetAt: Date.now() };
    await repo.saveComedian(latest);
  }
  delete state.cycles[id];
  await saveState();
}

function enqueueCycle(id: string, scheduled: boolean): Promise<void> {
  const existing = inFlight.get(id);
  if (existing) return existing;
  const version = stopVersion;
  const run = queue.catch(() => {}).then(async () => {
    if (version !== stopVersion) throw new ShiftPaused();
    stopRequested = false;
    error = undefined;
    waiting = undefined;
    try { await workCycle(id, scheduled, version); }
    catch (e) {
      if (e instanceof ShiftPaused) { waiting = e.message; if (!scheduled) throw e; }
      else {
        error = message(e);
        if (state.cycles[id]) { state.cycles[id].retryAfter = Date.now() + 60_000; await saveState(); }
        throw e;
      }
    } finally { await emit(); }
  });
  const result = run.finally(() => { inFlight.delete(id); });
  inFlight.set(id, result);
  queue = result.catch(() => {});
  return result;
}

async function tick() {
  lastTick = Date.now();
  if (!state.enabled) return;
  if (getEngines().nightshift.state !== 'online') {
    waiting = 'Waiting for Nightshift. Production resumes automatically when it is ready.';
    await emit();
    return;
  }
  waiting = undefined;
  settings = await getRepository().getSettings();
  const comedians = await getRepository().listComedians();
  const due = comedians.filter(c => {
    const cfg = c.autopilotConfig;
    if (!cfg.enabled || c.status === 'paused' || c.status === 'archived') return false;
    const pending = state.cycles[c.id];
    if (pending?.retryAfter && pending.retryAfter > Date.now()) return false;
    return !!pending || Date.now() - (cfg.lastSetAt || 0) >= Math.max(1000, cfg.setIntervalMs);
  });
  if (!comedians.some(c => c.autopilotConfig.enabled && c.status !== 'paused' && c.status !== 'archived')) waiting = 'Put a comedian on shift to begin.';
  await emit();
  for (const comedian of due) {
    if (!state.enabled) break;
    try { await enqueueCycle(comedian.id, true); } catch { /* recorded; retry after a minute */ }
  }
}

export async function resumeAutopilot(s: AISettings) {
  settings = s;
  if (station) return;
  await initialize();
  if (state.enabled && !getScheduler().isRunning()) getScheduler().start(state.tickIntervalMs, tick);
  await emit();
}

export async function startAutopilot(s: AISettings, tickIntervalMs = 30_000) {
  settings = s;
  if (station) { applyAutopilotStatus(await station('autopilotStart', tickIntervalMs)); return; }
  await initialize();
  state.enabled = true;
  stopRequested = false;
  state.tickIntervalMs = Math.max(1000, Number(tickIntervalMs) || 30_000);
  await saveState();
  if (state.enabled && !getScheduler().isRunning()) getScheduler().start(state.tickIntervalMs, tick);
  await emit();
}

export async function stopAutopilot() {
  if (station) { applyAutopilotStatus(await station('autopilotStop')); return; }
  await initialize();
  stopVersion++;
  stopRequested = true;
  state.enabled = false;
  waiting = undefined;
  getScheduler().stop();
  await saveState();
  await emit();
}

export function isAutopilotRunning() { return station ? lastStatus.running : state.enabled && getScheduler().isRunning(); }

export async function runCycleForComedian(comedian: Comedian): Promise<void> {
  if (!settings) throw new Error('Night Shift settings are not ready.');
  return triggerCycleNow(comedian, settings);
}

export async function triggerCycleNow(comedian: Comedian, s: AISettings): Promise<void> {
  if (station) { await station('autopilotRunNow', comedian.id); return; }
  settings = s;
  await initialize();
  if (getEngines().nightshift.state !== 'online') throw new Error('Nightshift is not ready. Start it in Engines, or open the club to wait automatically.');
  return enqueueCycle(comedian.id, false);
}
