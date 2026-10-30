
import { Comedian, ScoutTarget, Platform, AISettings } from '../../types';
import { runAIService } from '../aiService';
import { getRepository } from '../repository';

// =====================================================================
// Scout Agent — drafts booker / community / fan outreach.
//
// v1 does NOT scrape the internet. It generates plausible *seed* targets
// + outreach drafts the user can review and send manually (no auto-send).
// =====================================================================

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const PLATFORMS: Platform[] = ['x', 'youtube', 'instagram', 'tiktok', 'newsletter', 'podcast'];

const SEED_NICHES = [
  'local comedy club bookers',
  'stand-up clip accounts',
  'comedy podcast hosts',
  'open-mic community pages',
  'reaction / duet creators',
  'college campus event bookers',
  'comedy festival scouts',
  'late-night writer rooms'
];

export async function runScout(
  settings: AISettings,
  comedian: Comedian,
  draftCount: number
): Promise<ScoutTarget[]> {
  const repo = getRepository();
  const existing = await repo.listScouts(comedian.id);
  const knownNiches = new Set(existing.map(t => t.niche));

  // Pick niches we haven't drafted for yet.
  const candidateNiches = SEED_NICHES.filter(n => !knownNiches.has(n));
  const pickFrom = candidateNiches.length ? candidateNiches : SEED_NICHES;

  const out: ScoutTarget[] = [];
  for (let i = 0; i < draftCount; i++) {
    const niche = pickFrom[i % pickFrom.length];
    const platform = PLATFORMS[i % PLATFORMS.length];

    // Ask the LLM for a creative outreach angle. Cheap text call via riff.
    let angle = `Pitch them on "${comedian.name}" — ${comedian.tagline}.`;
    let draftMessage = `Hi! I manage an up-and-coming stand-up comedian, "${comedian.name}" ` +
      `(${comedian.tagline}). Thought they'd be a great fit given your focus on ${niche}. ` +
      `Latest clips: [link]. Open to a feature, booking, or quick share?`;
    try {
      const riff = await runAIService(settings, 'riff', {
        comedian: { name: comedian.name, voice: comedian.voice, style: comedian.style, profile: comedian.profile },
        set: { bits: [{ id: 1, title: 'Outreach angle', description: `Niche: ${niche}, Platform: ${platform}`, visualPrompt: '' }] }
      });
      if (riff?.instruction) {
        angle = riff.instruction.slice(0, 200);
      }
    } catch {
      // keep defaults
    }

    const target: ScoutTarget = {
      id: uid('scout'),
      comedianId: comedian.id,
      name: `${niche} #${existing.length + i + 1}`,
      platform,
      handleOrEmail: '',                       // user fills in
      niche,
      relevanceScore: Math.round(60 + Math.random() * 35),
      outreachStatus: 'drafted',
      suggestedAngle: angle,
      draftMessage,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await repo.saveScout(target);
    out.push(target);
  }

  return out;
}
