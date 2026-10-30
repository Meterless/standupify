
import { Comedian, Set, Clip, AISettings, ShortPlatform } from '../../types';
import { runAIService } from '../aiService';
import { getRepository } from '../repository';

// =====================================================================
// Clipper Agent — cuts short clips from a Set and writes captions.
// Each bit becomes a clip; captions are generated via the `riff` task as
// a creative text endpoint.
// =====================================================================

function uid(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const HOOK_TEMPLATES = [
  'Wait for the punchline 😭',
  'This bit lives in my head rent-free —',
  'POV: front row at',
  'Tell me this isn’t you:',
  'New clip just dropped:'
];

export async function runClipper(
  settings: AISettings,
  comedian: Comedian,
  set: Set,
  clipsTarget: number
): Promise<Clip[]> {
  const repo = getRepository();
  const platforms: ShortPlatform[] = comedian.publishingSettings.clipPlatforms.length
    ? comedian.publishingSettings.clipPlatforms
    : ['youtube_shorts', 'instagram_reel', 'x_video'];

  // We make `clipsTarget` clips. If the set has fewer bits than that, we
  // cycle bits and vary platform + hook.
  const out: Clip[] = [];
  for (let i = 0; i < clipsTarget; i++) {
    const bit = set.bits[i % Math.max(set.bits.length, 1)];
    if (!bit) continue;
    const platform = platforms[i % platforms.length];
    const hook = `${HOOK_TEMPLATES[i % HOOK_TEMPLATES.length]} "${comedian.name}"`;

    // Caption generation via the riff task — cheap and reuses keys.
    let caption = `${hook} ${bit.title}. ${bit.description.slice(0, 140)}`;
    try {
      const riff = await runAIService(settings, 'riff', {
        comedian: { name: comedian.name, voice: comedian.voice, style: comedian.style, profile: comedian.profile },
        set: { bits: [bit] }
      });
      if (riff?.instruction) {
        caption = `${hook} — ${riff.instruction}`.slice(0, 280);
      }
    } catch {
      // fall back to template caption
    }

    const clip: Clip = {
      id: uid('clip'),
      setId: set.id,
      comedianId: comedian.id,
      title: `${set.title} — Clip ${i + 1}`,
      hook,
      caption,
      platformFormat: platform,
      sourceBitId: bit.id,
      imageUrl: bit.imageUrl,
      videoUrl: bit.videoUrl,
      thumbnailUrl: bit.imageUrl,
      status: 'draft',
      createdAt: Date.now()
    };
    await repo.saveClip(clip);
    out.push(clip);
  }

  // Mirror clip ids on the set (deduped).
  const mergedIds = [...set.clipIds, ...out.map(c => c.id)];
  set.clipIds = mergedIds.filter((v, i) => mergedIds.indexOf(v) === i);
  await repo.saveSet(set);

  return out;
}
