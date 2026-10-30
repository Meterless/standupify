
import { Comedian, OutboxItem } from '../../types';
import { getRepository } from '../repository';

// =====================================================================
// Booker Agent — orders the local outbox for "what airs next" on the
// shared Standupify Network feed.
//
// v1 logic is intentionally simple: round-robin across comedians, oldest
// approved item per comedian first. A maintainer (or v2 server) picks
// from the head of the queue when publishing.
// =====================================================================

export async function runBooker(): Promise<OutboxItem[]> {
  const repo = getRepository();
  const all = await repo.listOutbox();
  const byComedian = new Map<string, OutboxItem[]>();
  for (const item of all) {
    if (item.reviewed) continue;
    const arr = byComedian.get(item.comedianId) || [];
    arr.push(item);
    byComedian.set(item.comedianId, arr);
  }
  // Sort each comedian's queue oldest-first.
  for (const arr of byComedian.values()) {
    arr.sort((a, b) => a.submittedAt - b.submittedAt);
  }

  // Round-robin pluck.
  const ordered: OutboxItem[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const arr of byComedian.values()) {
      const next = arr.shift();
      if (next) {
        ordered.push(next);
        added = true;
      }
    }
  }
  return ordered;
}

// Helper used by the UI to display the submission queue for one comedian.
export async function submissionQueue(comedian: Comedian): Promise<OutboxItem[]> {
  const repo = getRepository();
  const items = await repo.listOutbox(comedian.id);
  return items.filter(i => !i.reviewed).sort((a, b) => a.submittedAt - b.submittedAt);
}
