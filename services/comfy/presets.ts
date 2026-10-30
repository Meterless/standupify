// =====================================================================
// Looks — the Higgsfield-style one-click presets.
//
// A camera move is a motion prompt for the video model plus a CSS move the
// UI plays on your own still, so you see the shot before you spend a render.
// A venue is the stage dressing every still is lit and framed in.
// =====================================================================

export interface CameraMove {
  id: string;
  name: string;
  blurb: string;
  motion: string;        // appended to the video prompt
  css: string;           // keyframe name in index.css (cam-*)
}

export const CAMERA_MOVES: CameraMove[] = [
  { id: 'dolly-in',    name: 'Dolly In',     blurb: 'Slow push to the punchline',       css: 'cam-dolly-in',    motion: 'the camera slowly dollies in toward the comedian, ending on a tight close-up as the punchline lands' },
  { id: 'crash-zoom',  name: 'Crash Zoom',   blurb: 'Snap in on the reaction',          css: 'cam-crash-zoom',  motion: 'a sudden fast crash zoom into the comedian\'s face at the punchline, then holds' },
  { id: 'orbit',       name: 'Orbit',        blurb: 'Circle the mic',                   css: 'cam-orbit',       motion: 'the camera smoothly orbits around the comedian in a slow 90-degree arc while they perform' },
  { id: 'handheld',    name: 'Handheld',     blurb: 'Front-row documentary',            css: 'cam-handheld',    motion: 'handheld documentary camera with subtle natural shake, intimate and candid' },
  { id: 'crane-up',    name: 'Crane Reveal', blurb: 'Rise over the crowd',              css: 'cam-crane-up',    motion: 'a crane shot rising from behind the audience\'s heads up to reveal the comedian on stage' },
  { id: 'dolly-zoom',  name: 'Dolly Zoom',   blurb: 'Vertigo on the bomb',              css: 'cam-dolly-zoom',  motion: 'a vertigo dolly zoom: the comedian stays the same size while the room stretches behind them' },
  { id: 'whip-pan',    name: 'Whip Pan',     blurb: 'Crowd to comic in a blink',        css: 'cam-whip-pan',    motion: 'a fast whip pan from the laughing audience across to the comedian' },
  { id: 'locked-off',  name: 'Locked Off',   blurb: 'Classic special, tripod still',    css: 'cam-locked-off',  motion: 'static locked-off tripod shot, the comedian gestures naturally and the spotlight flickers' }
];

export const DEFAULT_MOVE = CAMERA_MOVES[0];

export function moveById(id?: string | null): CameraMove {
  return CAMERA_MOVES.find(m => m.id === id) || DEFAULT_MOVE;
}

export interface Venue {
  id: string;
  name: string;
  style: string;         // appended to every still prompt
  swatch: [string, string];
}

export const VENUES: Venue[] = [
  { id: 'cellar',   name: 'Brick Cellar',  swatch: ['#7a2e1c', '#1a0d0a'], style: 'intimate basement comedy club, exposed red brick wall, single warm spotlight, mic on a stand, wooden stool with a water glass, candid live photo, 35mm film grain' },
  { id: 'special',  name: 'Arena Special', swatch: ['#3b2a7a', '#07061a'], style: 'big-budget stand-up special in a theater, dramatic haze, rim lighting, huge LED backdrop with the comedian\'s name, cinematic wide lens, crisp 4k still' },
  { id: 'latenight',name: 'Late Night',    swatch: ['#0f4c75', '#05121f'], style: 'late-night talk show stage, glossy blue city skyline backdrop, studio key light, broadcast camera look' },
  { id: 'openmic',  name: 'Open Mic Dive', swatch: ['#6b5b2a', '#141008'], style: 'tiny dive bar open mic, neon beer signs, cramped corner stage, harsh on-camera flash, gritty phone-camera vibe' },
  { id: 'rooftop',  name: 'Rooftop',       swatch: ['#c2603d', '#1d0f1f'], style: 'outdoor rooftop comedy show at golden hour, string lights, city skyline, warm sunset backlight' },
  { id: 'festival', name: 'Fest Tent',     swatch: ['#2d6a4f', '#08140f'], style: 'comedy festival tent, colorful stage lights, packed crowd silhouettes, energetic festival atmosphere' }
];

export const DEFAULT_VENUE = VENUES[0];

export function venueById(id?: string | null): Venue {
  return VENUES.find(v => v.id === id) || DEFAULT_VENUE;
}

export const NEGATIVE_PROMPT = 'blurry, deformed hands, extra fingers, distorted face, text artifacts, watermark, logo, low quality, jpeg artifacts, duplicate person';

export const VIDEO_NEGATIVE = 'worst quality, inconsistent motion, blurry, jittery, distorted face, morphing, extra limbs, watermark, text';
