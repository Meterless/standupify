// The founding cohort and the four clubs of the Circuit. Founders are a
// starting population, not a cap: they mentor apprentices, retire and are
// joined by newcomers as the league runs. All names and people are invented.

import type { Club, SkillVector } from './types';
import type { MaterialType } from '../../types';

export interface FounderSeed {
  key: string;
  name: string;
  tagline: string;
  voice: string;
  style: string;
  audience: string;
  look: string;
  doctrine: string;
  venue: string;
  elo: number;
  skills: SkillVector;
  material: [string, MaterialType, string][];
}

export const FOUNDERS: FounderSeed[] = [
  {
    key: 'founder-pell', name: 'Marjorie Pell', tagline: 'Kindergarten teacher. Treats the audience accordingly.',
    voice: 'sing-song calm that curdles into menace', style: 'observational', audience: 'parents, teachers, recovering toddlers',
    look: 'a woman in her late 40s with a sensible grey bob, red cardigan over a floral dress, lanyard full of keys, reading glasses on a beaded chain',
    doctrine: 'The Classroom School — run the room like circle time; every crowd is a class that needs a firm hand', venue: 'cellar', elo: 1240,
    skills: { writing: 7, delivery: 8, crowdwork: 9, originality: 6, presence: 7 },
    material: [['Circle Time', 'BIT', 'Running the audience like a classroom'], ['Gerald', 'PERSONA', 'A five-year-old with the confidence of a hedge-fund manager'], ['Sticker Chart', 'PROP', 'Her system for rating husbands'], ['Parent emails', 'THEME', 'Passive aggression at scale'], ['Inside voices', 'CATCHPHRASE', 'Whispered before every punchline']]
  },
  {
    key: 'founder-okafor', name: 'Dez Okafor', tagline: 'Retired astronaut. Still terrible at small talk.',
    voice: 'precise mission-control deadpan', style: 'deadpan', audience: 'nerds, introverts, people who hate parties',
    look: 'a broad-shouldered man in his 50s with a shaved head and grey stubble, faded NASA-style bomber jacket over a black tee, aviator watch, very upright posture',
    doctrine: 'Mission Control Deadpan — say the absurd thing in the flattest voice in the room and never blink', venue: 'special', elo: 1310,
    skills: { writing: 8, delivery: 9, crowdwork: 5, originality: 8, presence: 8 },
    material: [['Re-entry', 'THEME', 'Returning to normal life after orbit'], ['Brunch', 'VENUE', 'The most hostile environment he has visited'], ['Mission Control', 'PERSONA', 'The voice in his head narrating every conversation'], ['Negative, Houston', 'CATCHPHRASE', 'His answer to every invitation'], ['Gravity', 'THEME', 'Overrated']]
  },
  {
    key: 'founder-vance', name: 'Tilly Vance', tagline: 'Wedding DJ in the middle of an existential crisis.',
    voice: 'manic hype-man energy that keeps collapsing into despair', style: 'absurdist', audience: 'millennials who have been to too many weddings',
    look: 'a wiry woman in her early 30s with a neon-green buzzcut, oversized sequined blazer, giant headphones around her neck, glitter on one cheek',
    doctrine: 'The Drop — build the energy until the bit collapses under its own weight, then build it again', venue: 'openmic', elo: 1180,
    skills: { writing: 7, delivery: 8, crowdwork: 7, originality: 9, presence: 9 },
    material: [['Uncle Rick', 'PERSONA', 'Requests the same song at every wedding she has ever played'], ['The Electric Slide', 'BIT', 'A dance she believes is a cult'], ['Open bar', 'THEME', 'A countdown clock to chaos'], ['Is this the drop?', 'CATCHPHRASE', 'Her plea to the universe'], ['Banquet hall B', 'VENUE', 'She has played it 400 times']]
  },
  {
    key: 'founder-castellanos', name: 'Rafi Castellanos', tagline: 'Third-generation diner owner. Fourth-generation disappointment.',
    voice: 'warm, rapid-fire family storyteller with a slow-burn punchline', style: 'storytelling', audience: 'big families, anyone who has worked a register',
    look: 'a stocky man in his late 30s with slicked-back black hair, short-sleeve diner shirt with a name tag reading RAFI, pen behind his ear, coffee stain on the cuff',
    doctrine: 'The Long Table — a story with seven relatives and one perfectly placed callback', venue: 'latenight', elo: 1265,
    skills: { writing: 9, delivery: 7, crowdwork: 6, originality: 7, presence: 7 },
    material: [['Abuela', 'PERSONA', 'Runs the diner register like a tribunal'], ['The Booth', 'VENUE', 'Booth six, where every family secret is told'], ['Free refills', 'THEME', 'A promise his father made in 1987 and regrets daily'], ['The pie case', 'PROP', 'Rotating, judging'], ['Table for one?', 'CATCHPHRASE', 'What he says to his own reflection']]
  },
  {
    key: 'founder-quill', name: 'Juniper Quill', tagline: 'Ex-corporate lawyer. Now litigates her own life.',
    voice: 'clipped, precise, closing-argument cadence', style: 'one-liners', audience: 'overworked professionals, burned-out overachievers',
    look: 'a tall woman in her early 40s with a sleek black bob, tailored navy suit with sneakers, a red legal pad tucked under one arm',
    doctrine: 'Exhibit A — every joke is an airtight case; set up the evidence, then the verdict', venue: 'special', elo: 1215,
    skills: { writing: 9, delivery: 7, crowdwork: 5, originality: 8, presence: 6 },
    material: [['Billable hours', 'THEME', 'She still bills her friends'], ['Opposing counsel', 'PERSONA', 'Her sister'], ['The fine print', 'BIT', 'Reading terms and conditions aloud'], ['Objection', 'CATCHPHRASE', 'Shouted at her own thoughts'], ['Exhibit A', 'PROP', 'A receipt from 2014']]
  },
  {
    key: 'founder-brennan', name: 'Sully Brennan', tagline: 'Retired firefighter. Puts out hecklers now.',
    voice: 'gravelly, unhurried, merciless crowd work', style: 'crowd-work', audience: 'blue-collar crowds, bachelorette parties he will ruin',
    look: 'a burly man in his 60s with a white walrus mustache, flannel shirt with rolled sleeves, suspenders, forearm tattoos',
    doctrine: 'The Front Row — the audience writes half the set; you just have to be brave enough to ask', venue: 'rooftop', elo: 1290,
    skills: { writing: 6, delivery: 8, crowdwork: 10, originality: 6, presence: 9 },
    material: [['The front row', 'VENUE', 'His favorite people to ruin'], ['Station 9', 'VENUE', 'Thirty years of firehouse chili'], ['The hose', 'PROP', 'A metaphor he refuses to explain'], ['Sit down, sweetheart', 'CATCHPHRASE', 'Said to grown men'], ['Retirement', 'THEME', 'Golf is just walking with anger']]
  },
  {
    key: 'founder-nakamura', name: 'Kenji Nakamura', tagline: 'Night-shift ER nurse. Has seen what you did.',
    voice: 'soft-spoken, dark, devastatingly matter-of-fact', style: 'dark', audience: 'medical workers, night owls, people with strong stomachs',
    look: 'a slim man in his early 30s with tired eyes, navy scrubs under a black hoodie, a stethoscope worn like a scarf, mismatched socks',
    doctrine: 'Night Shift Noir — the darker the truth, the quieter you say it', venue: 'cellar', elo: 1230,
    skills: { writing: 8, delivery: 8, crowdwork: 6, originality: 9, presence: 6 },
    material: [['3 a.m.', 'THEME', 'When the ER fills with the most creative injuries'], ['Triage', 'BIT', 'Ranking the audience by how fast they would die'], ['The vending machine', 'PROP', 'The only thing in the hospital that never lies'], ['Doctor Fitz', 'PERSONA', 'A surgeon who narrates his own heroism'], ["We've all seen it", 'CATCHPHRASE', 'His verdict on human dignity']]
  },
  {
    key: 'founder-okoro', name: 'Bree Okoro', tagline: 'Gen-Z HR rep with a dark side.',
    voice: 'chirpy corporate-speak that hides pure chaos', style: 'observational', audience: 'office workers, interns, anyone in a group chat with their boss',
    look: 'a woman in her mid 20s with box braids in a high bun, pastel blazer over a band tee, lanyard with a smiley badge, phone in hand at all times',
    doctrine: 'Per My Last Email — weaponized politeness, delivered with a smile and a deadline', venue: 'festival', elo: 1120,
    skills: { writing: 7, delivery: 7, crowdwork: 8, originality: 7, presence: 8 },
    material: [['Mandatory fun', 'THEME', 'Team-building exercises as psychological warfare'], ['Greg from accounting', 'PERSONA', 'Reply-all champion'], ['The breakroom fridge', 'VENUE', 'A crime scene with yogurt'], ['Per my last email', 'CATCHPHRASE', 'Said out loud, menacingly'], ['Slack status', 'PROP', 'Always "in a meeting"']]
  }
];

export const CLUBS: Club[] = [
  { id: 'cellar', name: 'The Brick Cellar', venue: 'cellar', prestige: 3, crowd: 'die-hard comedy nerds who have heard every premise', loves: ['observational', 'dark', 'one-liners'], formats: ['open_mic', 'showcase', 'roast_battle'], champion: null, blurb: 'A basement under a laundromat. Every legend started here.' },
  { id: 'neon', name: 'Neon Laugh Factory', venue: 'openmic', prestige: 2, crowd: 'rowdy twenty-somethings two drinks deep', loves: ['absurdist', 'crowd-work', 'observational'], formats: ['roast_battle', 'open_mic', 'showcase'], champion: null, blurb: 'Neon beer signs, sticky floors, the loudest room in town.' },
  { id: 'velvet', name: 'The Velvet Room', venue: 'special', prestige: 5, crowd: 'a dressed-up theater crowd that came for a real show', loves: ['storytelling', 'deadpan', 'one-liners'], formats: ['headliner', 'showcase'], champion: null, blurb: 'Red curtains, 400 seats, the room that makes careers.' },
  { id: 'rooftop', name: 'Rooftop Riot', venue: 'rooftop', prestige: 3, crowd: 'a festival crowd at sunset, up for anything', loves: ['crowd-work', 'absurdist', 'storytelling'], formats: ['showcase', 'roast_battle', 'headliner'], champion: null, blurb: 'String lights, skyline, and a heckler on every rooftop.' }
];

export const THEMES = [
  'airports', 'first dates', 'family group chats', 'self-checkout machines', 'the gym', 'moving apartments', 'wedding toasts',
  'customer service hold music', 'parenting advice from strangers', 'smart fridges', 'job interviews', 'jury duty', 'the dentist',
  'online reviews', 'hotel breakfasts', 'neighbors', 'road trips', 'returning a gift', 'getting older', 'the weather app',
  'birthday parties for adults', 'subscription services', 'the DMV', 'houseplants', 'self-help books', 'tipping screens'
];

// Fallback names for debuts when Nightshift cannot cast a newcomer.
export const NEWCOMER_FIRST = ['Ari', 'Bo', 'Cass', 'Dante', 'Esme', 'Finn', 'Gigi', 'Hal', 'Imani', 'Jules', 'Kit', 'Lou', 'Mo', 'Nell', 'Otto', 'Pia', 'Quinn', 'Rory', 'Sage', 'Teo'];
export const NEWCOMER_LAST = ['Abara', 'Bellweather', 'Cho', 'Delacroix', 'Ekwueme', 'Fairley', 'Gomez', 'Haverford', 'Ivanova', 'Jansen', 'Kowalski', 'Lindqvist', 'Moreau', 'Nwosu', 'Oyelaran', 'Petrakis', 'Quintero', 'Rasmussen', 'Sato', 'Thibodeaux'];
export const STYLES = ['observational', 'absurdist', 'crowd-work', 'storytelling', 'one-liners', 'dark', 'deadpan'];
