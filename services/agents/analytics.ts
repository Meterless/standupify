
import { Comedian, SetAnalytics, Clip } from '../../types';
import { getRepository } from '../repository';

// =====================================================================
// Analytics Agent — v1 has no live metrics API. Its job is to:
//   1. Snapshot the comedian's current state (counts, top items).
//   2. Append "audience signals" to the profile based on what was
//      submitted vs. approved vs. rejected.
//   3. Recommend creative changes for the next Writer run.
//
// In v2 this is where real YouTube/X metrics ingestion lives.
// =====================================================================

export interface AnalyticsSnapshot {
  setCount: number;
  clipsCount: number;
  outboxCount: number;
  approvedRate: number;
  topClip?: Clip;
  creativeSuggestions: string[];
}

export async function runAnalytics(comedian: Comedian): Promise<AnalyticsSnapshot> {
  const repo = getRepository();
  const sets = await repo.listSets(comedian.id);
  const clips = await repo.listClips(comedian.id);
  const outbox = await repo.listOutbox(comedian.id);

  const approved = sets.filter(s =>
    s.status === 'approved' || s.status === 'submitted' || s.status === 'published'
  ).length;
  const total = Math.max(sets.length, 1);
  const approvedRate = approved / total;

  // "Top" clip = most recent published one (no metrics in v1).
  const topClip = clips.find(c => c.status === 'published') || clips[0];

  const suggestions: string[] = [];
  if (approvedRate < 0.5 && sets.length >= 2) {
    suggestions.push(
      'Approval rate is under 50%. Try softening the Writer or tightening ' +
      'brand-safety rules in the Comedian Profile.'
    );
  }
  if (clips.length > 0 && clips.every(c => c.status === 'draft')) {
    suggestions.push(
      'Clips are piling up unreviewed. Approve a batch or lower ' +
      'clips-per-set in Autopilot settings.'
    );
  }
  if (comedian.profile.runningBits.length === 0 && sets.length >= 3) {
    suggestions.push(
      'No running bits recorded after 3 sets. Add a recurring callback ' +
      'to the Comedian Profile to give the act continuity.'
    );
  }
  if (outbox.length === 0 && sets.length >= 2) {
    suggestions.push(
      'Nothing submitted to the Standupify Network outbox yet. ' +
      'Approve a set to push it.'
    );
  }

  // Feed back into the profile as audience signals (capped).
  if (suggestions.length > 0) {
    const fresh = await repo.getComedian(comedian.id);
    if (fresh) {
      fresh.profile.audienceSignals = [...new Set([
        ...fresh.profile.audienceSignals,
        ...suggestions
      ])].slice(-20);
      await repo.saveComedian(fresh);
    }
  }

  // Mark a per-set analytics stamp so the dashboard can show "last
  // analyzed at" for free.
  const stamp: SetAnalytics = { recordedAt: Date.now() };
  for (const s of sets.slice(0, 3)) {
    const fresh = await repo.getSet(s.id);
    if (!fresh) continue;
    fresh.analytics = { ...(fresh.analytics || {}), ...stamp };
    await repo.saveSet(fresh);
  }

  return {
    setCount: sets.length,
    clipsCount: clips.length,
    outboxCount: outbox.length,
    approvedRate,
    topClip,
    creativeSuggestions: suggestions
  };
}
