
import { Comedian, Set, Promo, AISettings } from '../../types';
import { runAIService } from '../aiService';
import { getRepository } from '../repository';

// =====================================================================
// Promoter Agent — drafts one promo asset per set (poster / social post).
// Wraps aiService.generateMaterial to pull a hook, then renders an image.
// =====================================================================

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function runPromoter(
  settings: AISettings,
  comedian: Comedian,
  set: Set
): Promise<Promo | null> {
  const repo = getRepository();

  // Generate a promo hook styled like a tour poster headline.
  let headline = `${comedian.name} — Live`;
  let copy = `New set from ${comedian.name}: ${set.title}.`;
  try {
    const mat = await runAIService(settings, 'generateMaterial', {
      comedian: { name: comedian.name, tagline: comedian.tagline, voice: comedian.voice, style: comedian.style },
      existingMaterial: comedian.profile.material
    });
    if (mat?.name) headline = `${comedian.name}: "${mat.name}"`;
    if (mat?.description) copy = mat.description;
  } catch {
    // keep defaults
  }

  const visualPrompt = `Vintage stand-up comedy tour poster, bold retro typography, ` +
    `headshot-style hero image of comedian "${comedian.name}", 4:3 aspect ratio. ` +
    `Headline reads "${headline}". ${copy}. Warm spotlight, brick wall, microphone motif.`;

  let imageUrl: string | undefined;
  try {
    imageUrl = await runAIService(settings, 'generateImage', { prompt: visualPrompt });
  } catch (err) {
    console.warn('Promo image failed', err);
  }

  const promo: Promo = {
    id: uid('promo'),
    setId: set.id,
    comedianId: comedian.id,
    type: 'poster',
    title: headline,
    copy,
    visualPrompt,
    imageUrl,
    durationSec: 15,
    createdAt: Date.now()
  };
  await repo.savePromo(promo);

  const mergedIds = [...set.promoIds, promo.id];
  set.promoIds = mergedIds.filter((v, i) => mergedIds.indexOf(v) === i);
  await repo.saveSet(set);

  return promo;
}
