// =====================================================================
// Nightshift routing — pure. No fetch, no storage (PRD v3 §7, §14.1).
//
// The app never names an upstream model. Every call declares a TASK; the
// task fixes the class, the user's single Quality pick fixes the
// disposition, and Nightshift picks the model.
// =====================================================================

export type NightshiftClass =
  | 'text' | 'code' | 'vision' | 'perception' | 'image' | 'video'
  | 'speech' | 'transcribe' | 'music' | 'embed' | 'judge';

export type Disposition = 'auto' | 'fast' | 'deep' | 'cheap' | 'local' | 'fusion' | 'cluster';

/** What the user picks. "auto" lets each task use its own sensible default. */
export type Quality = 'auto' | 'fast' | 'deep' | 'local';

export type Task =
  | 'cast'         // invent a comedian + debut set
  | 'writeBit'     // write the next bit
  | 'riff'         // a one-line steer for the riff loop
  | 'material'     // invent one piece of material
  | 'judge'        // the laugh meter
  | 'copy'         // captions, promo, outreach drafts
  | 'still'        // a stage still        (made through jobs)
  | 'voice'        // narrate a bit        (made through jobs)
  | 'walkon';      // walk-on music        (made through jobs)

interface TaskRoute { cls: NightshiftClass; disposition: Disposition; output: 'text' | 'image' | 'audio' }

export const TASK_ROUTES: Record<Task, TaskRoute> = {
  cast:     { cls: 'text',   disposition: 'deep', output: 'text' },
  writeBit: { cls: 'text',   disposition: 'deep', output: 'text' },
  riff:     { cls: 'text',   disposition: 'fast', output: 'text' },   // fires every few seconds: never wait on a load
  material: { cls: 'text',   disposition: 'fast', output: 'text' },
  judge:    { cls: 'judge',  disposition: 'fast', output: 'text' },
  copy:     { cls: 'text',   disposition: 'fast', output: 'text' },
  still:    { cls: 'image',  disposition: 'auto', output: 'image' },
  voice:    { cls: 'speech', disposition: 'auto', output: 'audio' },
  walkon:   { cls: 'music',  disposition: 'auto', output: 'audio' }
};

export const TASK_LABEL: Record<Task, string> = {
  cast: 'Casting', writeBit: 'Writing', riff: 'Riffing', material: 'Material',
  judge: 'Laugh meter', copy: 'Captions & promo', still: 'Stage stills', voice: 'Voice', walkon: 'Walk-on music'
};

// Classes that run one core at a time: fusion there is a guaranteed 400.
const SINGLE_CORE: NightshiftClass[] = ['video', 'music', 'speech', 'embed'];

export interface ResolvedMode {
  cls: NightshiftClass;
  disposition: Disposition;
  modelId: string;          // the `model` field
  header: string;           // the `meterless-mode` header
  accept?: string;          // `meterless-accept`, only for media classes (§7.3)
  downgrade?: string;
}

/** §7.2: an attachment redirects the class only when the task outputs text. */
export function resolveTaskMode(task: Task, quality: Quality = 'auto', opts: { hasImage?: boolean } = {}): ResolvedMode {
  const route = TASK_ROUTES[task];
  let cls = route.cls;
  if (opts.hasImage && route.output === 'text' && (cls === 'text' || cls === 'code')) cls = 'vision';

  let disposition: Disposition = quality === 'auto' ? route.disposition : quality;
  let downgrade: string | undefined;
  if (disposition === 'fusion' && SINGLE_CORE.includes(cls)) {
    downgrade = `fusion is not available for ${cls}; using auto`;
    disposition = 'auto';
  }

  const accept = route.output === 'image' ? 'image' : route.output === 'audio' ? 'audio' : undefined;
  return {
    cls,
    disposition,
    modelId: `meterless/${cls}.${disposition}`,
    header: `${cls}.${disposition}`,
    accept,
    downgrade
  };
}

/** Quick Connect link (Addendum A §5.1): http(s)://host/connect#k=<token>[&m=…]. */
export function parseConnectLink(text: string): { baseUrl: string; token: string; model: string } | null {
  let u: URL;
  try { u = new URL(String(text || '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!/^\/connect\/?$/.test(u.pathname)) return null;
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''));
  const token = frag.get('k');
  if (!token) return null;
  return { baseUrl: `${u.origin}/v1`, token, model: frag.get('m') || 'meterless/auto' };
}

/** `<host>`, `<host>/v1`, `<host>/v1/chat/completions`, `/healthz`… → `<host>/v1`. */
export function normalizeBaseUrl(input: string): string {
  let s = (input || '').trim();
  if (!s) return 'http://127.0.0.1:8088/v1';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '')
    .replace(/\/(chat\/completions|models|healthz|health|ready)$/i, '')
    .replace(/\/+$/, '');
  if (!/\/v1$/i.test(s)) s = `${s}/v1`;
  return s;
}
