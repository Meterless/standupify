// Persistence + live state for the Circuit. Its own IndexedDB, so the roster
// database (and its migrations) are untouched.

import { useSyncExternalStore } from 'react';
import type { CircuitState, RoomState, Show } from './types';

const DB = 'Standupify_Circuit';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('shows')) {
        const s = db.createObjectStore('shows', { keyPath: 'id' });
        s.createIndex('night', 'night');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ||= open());

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => reject(t.error);
  }));
}

// The Station (Node) stores the Circuit on disk instead of IndexedDB.
export interface CircuitPersistence {
  loadState(): Promise<CircuitState | undefined>;
  writeState(st: CircuitState): Promise<void>;
  writeShow(show: Show): Promise<void>;
  getShow(id: string): Promise<Show | undefined>;
  recentShows(limit: number): Promise<Show[]>;
  reset(): Promise<void>;
}
let persistence: CircuitPersistence | null = null;
export function setCircuitPersistence(p: CircuitPersistence) { persistence = p; }

export const loadState = () => persistence ? persistence.loadState() : tx<CircuitState | undefined>('state', 'readonly', s => s.get('current'));
export const writeState = (st: CircuitState) => persistence ? persistence.writeState(st) : tx('state', 'readwrite', s => { s.put(st, 'current'); });
export const writeShow = (show: Show) => persistence ? persistence.writeShow(show) : tx('shows', 'readwrite', s => { s.put(show); });
export const getShow = (id: string) => persistence ? persistence.getShow(id) : tx<Show | undefined>('shows', 'readonly', s => s.get(id));

export async function recentShows(limit = 40): Promise<Show[]> {
  if (persistence) return persistence.recentShows(limit);
  const all = await tx<Show[]>('shows', 'readonly', s => s.getAll());
  return all.sort((a, b) => b.night - a.night || b.startedAt - a.startedAt).slice(0, limit);
}

export async function resetCircuitDb() {
  if (persistence) return persistence.reset();
  await tx('state', 'readwrite', s => { s.clear(); });
  await tx('shows', 'readwrite', s => { s.clear(); });
}

// ---------------------------------------------------------------------
// Live view state
// ---------------------------------------------------------------------

export type LivePhase = 'booking' | 'rehearsing' | 'judging' | 'crowd' | 'results' | 'idle' | 'waiting';

export interface LiveShow {
  show: Show | null;
  phase: LivePhase;
  current: number;          // index into show.lineup being written
  streaming: string;        // the set as it is written
  note: string;             // one line about what is happening
  drafts: { done: number; of: number } | null;
  room?: RoomState;         // the room the next comic walks into
}

interface Snapshot { state: CircuitState | null; live: LiveShow; shows: Show[]; version: number }

let snap: Snapshot = { state: null, live: { show: null, phase: 'idle', current: -1, streaming: '', note: '', drafts: null }, shows: [], version: 0 };
const listeners = new Set<() => void>();

export function publishCircuit(patch: Partial<Omit<Snapshot, 'version'>>) {
  snap = { ...snap, ...patch, version: snap.version + 1 };
  listeners.forEach(l => l());
}

export function patchLive(patch: Partial<LiveShow>) {
  publishCircuit({ live: { ...snap.live, ...patch } });
}

export function getCircuitSnapshot() { return snap; }

/** Non-React subscription (the Station streams every change to browsers). */
export function subscribeCircuit(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function useCircuit(): Snapshot {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => snap, () => snap
  );
}
