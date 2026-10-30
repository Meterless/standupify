// One event bus for the app's internal signals. In the browser it is the
// window (so existing listeners keep working); in the Station (Node) it is a
// plain EventTarget, so the same services run headless.

const G = globalThis as any;
export const bus: EventTarget = typeof window !== 'undefined' ? window : (G.__standupifyBus ||= new EventTarget());

export function emit(name: string, detail?: unknown) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/** The Station serves media as files; in Node it reads them straight from disk. */
export const media: { resolve: ((url: string) => Promise<Blob | null>) | null } = { resolve: null };

export async function mediaBlob(url: string): Promise<Blob> {
  const local = media.resolve ? await media.resolve(url) : null;
  return local || (await fetch(url)).blob();
}
