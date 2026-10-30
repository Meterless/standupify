import { Comedian, Set, AISettings, Bit, SetAnalytics } from '../../types';
import { writeBit, renderStill, stillPrompt, comedianSeed, judgeBit, voiceBit } from '../studio';
import { getRepository } from '../repository';

// =====================================================================
// Writer Agent — writes the comedian's next Set: Nightshift writes the
// opener, ComfyUI (or Nightshift) shoots it, the laugh meter grades it.
// =====================================================================

export interface WriterOutput {
  set: Set;
}

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function runWriter(
  settings: AISettings,
  comedian: Comedian,
  reason: 'debut' | 'manual' | 'autopilot',
  reservedSetId?: string
): Promise<WriterOutput> {
  const repo = getRepository();
  const priorSets = await repo.listSets(comedian.id);
  const lastSet = priorSets[0];

  const recentSignals = comedian.profile.audienceSignals.slice(-5).join(' | ');
  const runningBits = comedian.profile.runningBits.slice(0, 5).join(' | ');
  const brandSafety = comedian.profile.brandSafetyRules.join(' | ');
  const instruction = [
    `Open a fresh set for "${comedian.name}".`,
    runningBits ? `Lean on signature callbacks: ${runningBits}.` : '',
    recentSignals ? `Audience signals to work in: ${recentSignals}.` : '',
    brandSafety ? `BRAND SAFETY: ${brandSafety}.` : '',
    'A killer opener that hooks the room.'
  ].filter(Boolean).join(' ');

  const shim: Set = lastSet || {
    id: 'shim', comedianId: comedian.id, title: '', logline: '', status: 'draft', bits: [],
    clipIds: [], promoIds: [], publishedUrls: [], analytics: {}, generatedBy: reason, createdAt: 0, updatedAt: 0
  };
  const opener = await writeBit(comedian, shim, instruction, settings);

  const bit: Bit = {
    id: Date.now(),
    title: opener.title,
    description: opener.description,
    visualPrompt: opener.action
  };
  try {
    bit.imageUrl = await renderStill(stillPrompt(comedian, opener.action, comedian.venue || settings.venue), settings, {
      label: `Shooting · ${bit.title}`, itemKey: `bit:${bit.id}`, seed: comedianSeed(comedian), ref: { comedianId: comedian.id, bitId: bit.id }
    });
  } catch (err) {
    console.warn('Writer still failed', err);
  }
  if (settings.autoJudge) {
    try { const j = await judgeBit(comedian, bit, settings); bit.laughScore = j.score; bit.laughNote = j.note; } catch { /* optional */ }
  }
  if (settings.autoVoice) {
    try { bit.audioUrl = await voiceBit(comedian, bit); } catch { /* optional */ }
  }

  const set: Set = {
    id: reservedSetId || uid('set'),
    comedianId: comedian.id,
    title: opener.title,
    logline: opener.description,
    status: 'ready',
    bits: [bit],
    clipIds: [],
    promoIds: [],
    publishedUrls: [],
    analytics: {} as SetAnalytics,
    generatedBy: reason,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.saveSet(set);
  return { set };
}
