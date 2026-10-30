// =====================================================================
// The world model — every person, place and thing the cameras ever see,
// kept the same from one generation to the next.
//
// After World Dreamer's Actor Essence Protocol, with the parts it never
// finished:
//
//   characters  a visual essence (face · hair · skin · build · wardrobe ·
//               signature detail). It starts from their written look; once
//               a headshot exists, Nightshift's vision lane reads the
//               essence off the actual picture, and then it is LOCKED, so
//               later renders follow the face that exists, not a re-roll.
//               Plus a per-comic seed and an anchor image (the headshot).
//   places      every club and every Original's theater: motifs, palette,
//               lighting, materials, plus an anchor still. A second Original
//               at the same theater inherits its canon.
//   things      signature props (their PROP material, the detail in their
//               look) with an owner, so the mic, the jacket and the
//               notebook come back.
//
// canonBlock() assembles what a render needs, mentioned actors first,
// within a hard character budget (image text encoders cut long prompts).
// Locations are wired in: World Dreamer's were extracted but never injected.
// =====================================================================

import type { Club } from '../league/types';
import { venueById } from '../comfy/presets';

export interface Canon {
  essence: string;               // 2–3 sentences that must match every time
  face?: string; hair?: string; skin?: string; build?: string; wardrobe?: string; signature?: string;
  source: 'look' | 'vision' | 'operator';
  locked: boolean;               // a vision-read or operator canon never changes on its own
  version: number;
  at: number;
  history?: { essence: string; at: number; source: Canon['source'] }[];
}

export interface CharacterEntity { id: string; name: string; canon: Canon; seed: number; anchor?: string; things: string[]; appearances: number; essenceTries?: number }
export interface PlaceEntity { id: string; name: string; kind: 'club' | 'theater'; canon: string; motifs: string[]; palette?: string; lighting?: string; anchor?: string; appearances: number }
export interface ThingEntity { id: string; name: string; ownerId?: string; canon: string; anchor?: string }

export interface WorldState { version: 1; characters: Record<string, CharacterEntity>; places: Record<string, PlaceEntity>; things: Record<string, ThingEntity> }

export interface ComicLike {
  id: string; name: string; look?: string; venue?: string; headshotUrl?: string; avatarImage?: string;
  profile: { material: { name: string; type: string; description: string }[] };
}

export const emptyWorld = (): WorldState => ({ version: 1, characters: {}, places: {}, things: {} });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The signature detail a look description already names ("…, one signature detail"). */
function signatureOf(look: string): string | null {
  const parts = look.split(/,\s*/).map(x => x.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}

/** Bring the world up to date with the roster and the clubs. Never touches a locked canon. */
export function syncWorld(world: WorldState | undefined, comics: ComicLike[], clubs: Club[], seedOf: (id: string) => number): WorldState {
  const w = world || emptyWorld();
  for (const c of comics) {
    const look = (c.look || `${c.name}, a stand-up comedian`).trim();
    const ch = w.characters[c.id];
    if (!ch) {
      w.characters[c.id] = {
        id: c.id, name: c.name, seed: seedOf(c.id), anchor: c.headshotUrl || c.avatarImage, things: [], appearances: 0,
        canon: { essence: look, signature: signatureOf(look) || undefined, source: 'look', locked: false, version: 1, at: Date.now() }
      };
    } else {
      ch.name = c.name;
      ch.anchor ||= c.headshotUrl || c.avatarImage;
      if (!ch.canon.locked && ch.canon.source === 'look' && ch.canon.essence !== look) ch.canon = { ...ch.canon, essence: look, version: ch.canon.version + 1, at: Date.now() };
    }
    // Signature props.
    const props = c.profile.material.filter(m => m.type === 'PROP').slice(0, 3);
    const sig = signatureOf(look);
    for (const m of props) {
      const id = `${c.id}:${slug(m.name)}`;
      w.things[id] ||= { id, name: m.name, ownerId: c.id, canon: m.description.slice(0, 160) };
    }
    if (sig) { const id = `${c.id}:signature`; w.things[id] ||= { id, name: 'signature detail', ownerId: c.id, canon: sig.slice(0, 160) }; }
    w.characters[c.id].things = Object.values(w.things).filter(t => t.ownerId === c.id).map(t => t.id);
  }
  for (const club of clubs) {
    const v = venueById(club.venue);
    const p = w.places[club.id];
    const canon = `${club.name}: ${v.style}`;
    if (!p) w.places[club.id] = { id: club.id, name: club.name, kind: 'club', canon, motifs: v.style.split(/,\s*/).slice(0, 4), lighting: v.style.match(/[^,]*light[^,]*/i)?.[0], appearances: 0 };
    else if (p.kind === 'club') p.name = club.name;
  }
  return w;
}

/** A theater an Original was taped in becomes a place; the next Original there inherits it. */
export function registerTheater(w: WorldState, b: { theater: string; city: string; stage: string; lighting: string; grade: string }, anchor?: string): PlaceEntity {
  const id = `theater:${slug(`${b.theater} ${b.city}`)}`;
  const p = w.places[id] ||= {
    id, name: `${b.theater}, ${b.city}`, kind: 'theater', canon: `${b.theater} in ${b.city}: ${b.stage}`,
    motifs: b.stage.split(/,\s*/).slice(0, 4), lighting: b.lighting, palette: b.grade, appearances: 0
  };
  if (anchor && !p.anchor) p.anchor = anchor;
  p.appearances++;
  return p;
}

export function findTheater(w: WorldState | undefined, theater: string, city: string): PlaceEntity | null {
  return w?.places[`theater:${slug(`${theater} ${city}`)}`] || null;
}

export function setAnchor(w: WorldState | undefined, kind: 'character' | 'place' | 'thing', id: string, url: string) {
  if (!w || !url) return;
  const e = kind === 'character' ? w.characters[id] : kind === 'place' ? w.places[id] : w.things[id];
  if (e && !e.anchor) e.anchor = url;
}

export function noteAppearance(w: WorldState | undefined, characterId: string, placeId?: string) {
  if (!w) return;
  if (w.characters[characterId]) w.characters[characterId].appearances++;
  if (placeId && w.places[placeId]) w.places[placeId].appearances++;
}

/** Characters whose essence has not yet been read off a real picture. */
export function needsEssence(w: WorldState | undefined): CharacterEntity[] {
  return Object.values(w?.characters || {}).filter(c => !c.canon.locked && c.canon.source === 'look' && !!c.anchor && (c.essenceTries || 0) < 3);
}

/** Store a vision-read essence and lock it (the operator can still unlock). */
export function lockEssence(w: WorldState, id: string, read: Partial<Canon> & { essence: string }) {
  const ch = w.characters[id];
  if (!ch || ch.canon.locked) return;
  const prev = ch.canon;
  ch.canon = {
    ...read, source: 'vision', locked: true, version: prev.version + 1, at: Date.now(),
    history: [{ essence: prev.essence, at: prev.at, source: prev.source }, ...(prev.history || [])].slice(0, 6)
  };
}

export const ESSENCE_PROMPT = `Describe the person in this photo so an image model can draw the exact same person again.
Only what is visible. Be concrete: age range, face shape, eyes, nose, facial hair, hair colour and cut, skin tone, build, exactly what they are wearing, and one signature detail.
Return ONLY JSON: { "face": "...", "hair": "...", "skin": "...", "build": "...", "wardrobe": "...", "signature": "...", "essence": "2–3 sentences combining all of it, in the present tense" }`;

/**
 * What a render needs to know, in priority order: the actors in the shot,
 * then the place, then their props. Capped (T5 and CLIP drop the tail).
 */
export function canonBlock(w: WorldState | undefined, o: { characters?: string[]; placeId?: string; place?: PlaceEntity | null; budget?: number }): string {
  if (!w) return '';
  const budget = o.budget ?? 900;
  const parts: string[] = [];
  for (const id of o.characters || []) {
    const ch = w.characters[id];
    if (!ch) continue;
    const things = ch.things.map(t => w.things[t]).filter(Boolean).map(t => t!.canon).slice(0, 2);
    parts.push(`${ch.name}: ${ch.canon.essence}${things.length ? ` Always with: ${things.join('; ')}.` : ''}`.slice(0, 420));
  }
  const place = o.place || (o.placeId ? w.places[o.placeId] : null);
  if (place) parts.push(`Setting, ${place.name}: ${[place.canon, place.lighting].filter(Boolean).join('. ')}`.slice(0, 300));
  let out = '';
  for (const p of parts) { if ((out + p).length > budget) break; out += (out ? ' ' : '') + p; }
  return out ? `Visual canon, keep exactly: ${out}` : '';
}

/**
 * Nightshift can list a vision class whose seated model cannot take images
 * (a llama lane started without its mmproj). One such answer is enough:
 * stop sending pictures until the app restarts.
 */
export const vision = { broken: false as boolean, why: '' };
export function noteVisionError(e: unknown): boolean {
  const msg = String((e as any)?.message || e || '');
  if (/image input is not supported|mmproj/i.test(msg)) { vision.broken = true; vision.why = "Nightshift's vision lane is running without its image projector (mmproj)"; }
  return vision.broken;
}

/** Stable per-entity seed for anything without one. */
export const entitySeed = (id: string) => hash(id) % 2 ** 31;
