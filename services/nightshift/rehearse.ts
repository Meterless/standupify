// =====================================================================
// Rehearsal — Nightshift's night engine writing a set.
//
// A best_of_n job asks the runtime for several independent drafts of the
// same set; the runtime keeps them all as attempts and names a winner. The
// comedian walks on stage with the draft Nightshift picked. If the jobs
// plane is missing or slow, the caller falls back to one chat draft.
// =====================================================================

import { request } from './media';
import { getMediaPrivacy } from './media';
import { APP_ID } from './runtime';
import type { Quality } from './modes';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const TERMINAL = new Set(['completed', 'cancelled', 'canceled', 'errored', 'failed']);
const usable = (a: any) => !!a && typeof a.text === 'string' && a.text.trim().length > 0 && !a.error;

export interface RehearsalResult { text: string; drafts: number; jobId: string; winnerSeq: number | null }

export async function rehearse(o: {
  system: string;
  prompt: string;
  drafts: number;
  quality?: Quality;
  timeoutMs?: number;
  onProgress?: (p: { drafts: number; of: number; status: string }) => void;
  onJob?: (jobId: string) => void;     // persist this before polling — a reload reconnects
  jobId?: string;                      // reconnect to a rehearsal already running
  signal?: AbortSignal;
}): Promise<RehearsalResult> {
  if (o.jobId) {
    try {
      await request('GET', `/v1/jobs/${encodeURIComponent(o.jobId)}`, null, { stage: 'rehearse', timeoutMs: 45_000 });
      return await poll(o.jobId, o);
    } catch (e: any) {
      if (e?.status !== 404) throw e;      // gone: write it fresh below
    }
  }
  const disposition = !o.quality || o.quality === 'auto' ? 'deep' : o.quality;
  const created = await request('POST', '/v1/jobs', {
    kind: 'best_of_n',
    app: APP_ID,
    mode: `meterless/text.${disposition}`,
    n: Math.max(1, Math.min(6, o.drafts)),
    window: 'now',
    privacy: getMediaPrivacy(),
    media_autopilot: { mode: 'off' },
    messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.prompt }]
  }, { stage: 'rehearse' });
  const jobId: string = created.data?.id;
  if (!jobId) throw new Error('Nightshift accepted the rehearsal but returned no job id.');
  o.onJob?.(jobId);
  return poll(jobId, o);
}

async function poll(jobId: string, o: { drafts: number; timeoutMs?: number; onProgress?: (p: { drafts: number; of: number; status: string }) => void; signal?: AbortSignal }): Promise<RehearsalResult> {
  const deadline = Date.now() + (o.timeoutMs ?? 20 * 60_000);
  let wait = 2500;
  let transient = 0;
  for (;;) {
    if (o.signal?.aborted) throw new Error('Rehearsal cancelled.');
    let job: any;
    try {
      job = (await request('GET', `/v1/jobs/${encodeURIComponent(jobId)}`, null, { stage: 'rehearse', timeoutMs: 45_000 })).data;
      transient = 0;
    } catch (e: any) {
      // A runtime busy writing drafts can be slow to answer a poll; the job
      // is still there. Only give up after several misses in a row.
      if ((e?.retriable || e?.code === 'network') && ++transient <= 8 && Date.now() < deadline) { await sleep(Math.min(15_000, wait * 2)); continue; }
      throw e;
    }
    const generated = Number(job?.generated || 0);
    o.onProgress?.({ drafts: generated, of: Number(job?.n || o.drafts), status: String(job?.status || '') });
    if (TERMINAL.has(job?.status) || Date.now() > deadline) {
      // Winner first, then any usable draft — never assume seq 1.
      const seqs: number[] = [];
      if (job?.winner_seq != null) seqs.push(Number(job.winner_seq));
      for (let i = 1; i <= Math.max(generated, 1) + 1 && i <= 12; i++) if (!seqs.includes(i)) seqs.push(i);
      for (const s of seqs) {
        try {
          const a = (await request('GET', `/v1/jobs/${encodeURIComponent(jobId)}/attempts/${s}`, null, { stage: 'rehearse', timeoutMs: 45_000 })).data;
          if (usable(a)) return { text: a.text, drafts: Math.max(generated, 1), jobId, winnerSeq: job?.winner_seq ?? null };
        } catch { /* try the next draft */ }
      }
      throw new Error(Date.now() > deadline ? 'Rehearsal ran out of time.' : `Rehearsal ${job?.status} without a usable draft.`);
    }
    await sleep(wait);
    wait = Math.min(8000, Math.round(wait * 1.25));
  }
}
