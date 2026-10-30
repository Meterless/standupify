// =====================================================================
// Live task store — every Nightshift / ComfyUI job the user can see.
// Feeds the render dock and the per-bit progress overlays.
// =====================================================================

import { useSyncExternalStore } from 'react';

export type TaskEngine = 'Nightshift' | 'ComfyUI';
export type TaskKind = 'text' | 'image' | 'video' | 'audio';

export interface StudioTask {
  id: string;
  label: string;
  engine: TaskEngine;
  kind: TaskKind;
  status: 'running' | 'done' | 'failed';
  progress: number;          // 0..1, or -1 while indeterminate
  stage?: string;
  preview?: string;          // object URL of a live latent preview
  error?: string;
  ref?: { comedianId?: string; bitId?: number };
  startedAt: number;
  endedAt?: number;
  cancel?: () => void;
}

let tasks: StudioTask[] = [];
const listeners = new Set<() => void>();
const emit = () => { tasks = [...tasks]; listeners.forEach(l => l()); };

export function subscribeTasks(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function getTasks() { return tasks; }

/** The Station's tasks, streamed in: shown in the dock next to this page's own. */
let remote: StudioTask[] = [];
let local = tasks;
export function setRemoteTasks(list: StudioTask[]) {
  remote = list;
  mergeRemote();
}
function mergeRemote() {
  local = tasks.filter(t => !(t as any).remote);
  tasks = [...local, ...remote].sort((a, b) => (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || b.startedAt - a.startedAt);
  listeners.forEach(l => l());
}
export function useTasks(): StudioTask[] { return useSyncExternalStore(subscribeTasks, getTasks, getTasks); }

export function clearFinished() {
  tasks = tasks.filter(t => t.status === 'running');
  emit();
}

export interface TaskHandle {
  update(p: Partial<Pick<StudioTask, 'progress' | 'stage' | 'preview'>>): void;
  signal: AbortSignal;
}

/** Run `work` as a visible task. Finished tasks fade from the dock on their own. */
export async function track<T>(
  meta: Pick<StudioTask, 'label' | 'engine' | 'kind'> & { ref?: StudioTask['ref'] },
  work: (h: TaskHandle) => Promise<T>
): Promise<T> {
  const ctl = new AbortController();
  const task: StudioTask = { id: crypto.randomUUID(), status: 'running', progress: -1, startedAt: Date.now(), cancel: () => ctl.abort(), ...meta };
  tasks = [task, ...tasks].slice(0, 40);
  emit();
  const patch = (p: Partial<StudioTask>) => {
    const i = tasks.findIndex(t => t.id === task.id);
    if (i !== -1) { tasks[i] = { ...tasks[i], ...p }; emit(); }
  };
  try {
    const out = await work({ update: patch, signal: ctl.signal });
    patch({ status: 'done', progress: 1, endedAt: Date.now(), preview: undefined, cancel: undefined });
    setTimeout(() => { tasks = tasks.filter(t => t.id !== task.id); emit(); }, 6000);
    return out;
  } catch (e: any) {
    patch({ status: 'failed', error: e?.message || String(e), endedAt: Date.now(), cancel: undefined });
    throw e;
  }
}

export function runningFor(ref: { bitId?: number; comedianId?: string }, list = tasks): StudioTask[] {
  return list.filter(t => t.status === 'running' && (
    (ref.bitId != null && t.ref?.bitId === ref.bitId) || (ref.comedianId && !ref.bitId && t.ref?.comedianId === ref.comedianId)
  ));
}
