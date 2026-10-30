// =====================================================================
// The Masters' Playbook — what the Circuit's comics study.
//
// Real comedians appear here only as teachers of craft: how they used
// time, silence, the mic, the stage and the room. Circuit comics learn the
// technique, never the jokes — no lifted bits, no catchphrases, no
// impressions. The comics on the Circuit stay invented people.
//
//   CRAFT     the techniques (timing, callbacks, letting it breathe, …)
//   MASTERS   who is known for which techniques, and how they owned a stage
//   PERSONAS  stage archetypes: the relationship a comic has with a room
//
// Pure data + a diversity-weighted picker. No fetch, no storage.
// =====================================================================

import type { SkillVector } from './types';

export type CraftId =
  | 'the-pause' | 'let-it-breathe' | 'rule-of-three' | 'tag-stack' | 'callback' | 'long-callback'
  | 'misdirection' | 'act-out' | 'character-voice' | 'escalation' | 'preacher-cadence' | 'repetition'
  | 'crowd-work' | 'heckler-control' | 'confessional' | 'self-deprecation' | 'the-stare' | 'rant'
  | 'list-build' | 'wordplay' | 'deadpan' | 'one-liner-rhythm' | 'anti-joke' | 'shaggy-dog'
  | 'mock-indignation' | 'in-character' | 'truth-bomb' | 'raunch-with-class' | 'riff' | 'physical-space'
  | 'laugh-at-yourself' | 'the-turn';

export interface Craft {
  id: CraftId;
  name: string;
  /** What it is, in one line. */
  what: string;
  /** How a comic does it on stage — written as a coaching note, used in briefs. */
  drill: string;
  /** The stage cue a writer marks it with, if it has one. */
  cue?: string;
  skill: keyof SkillVector;
  /** 0–1: how much it rewards a room that is listening (vs. one that is loud). */
  needsQuiet: number;
}

export const CRAFT: Record<CraftId, Craft> = {
  'the-pause': { id: 'the-pause', name: 'The Pause', what: 'A held silence right before the punchline word.', drill: 'Stop one beat before the last word. Let them lean in. Then say it, plainly.', cue: 'beat', skill: 'delivery', needsQuiet: 0.7 },
  'let-it-breathe': { id: 'let-it-breathe', name: 'Let It Breathe', what: 'Never step on a laugh; ride it, let it peak and start to fall before the next line.', drill: 'When the laugh comes, shut up. Wait for it to crest and dip. The next line goes in on the way down.', cue: 'hold', skill: 'delivery', needsQuiet: 0.4 },
  'rule-of-three': { id: 'rule-of-three', name: 'Rule of Three', what: 'Two items set a pattern; the third breaks it.', drill: 'Two normal things, same rhythm. The third sounds like it belongs and does not.', skill: 'writing', needsQuiet: 0.4 },
  'tag-stack': { id: 'tag-stack', name: 'Tag Stack', what: 'After the punchline, more punchlines on the same premise — each a little harder.', drill: 'Do not move on after the laugh. Add a tag, then another. Every tag is shorter than the one before.', cue: 'tag', skill: 'writing', needsQuiet: 0.3 },
  'callback': { id: 'callback', name: 'Callback', what: 'Bring back an earlier line, image or word in a new context for a bigger laugh.', drill: 'Plant something early that gets a small laugh. Bring it back where they least expect it — the payoff is the recognition.', cue: 'callback', skill: 'writing', needsQuiet: 0.5 },
  'long-callback': { id: 'long-callback', name: 'The Long Callback', what: 'A callback that pays off something from much earlier — another comic tonight, or a bit the regulars know.', drill: 'Reach back further than they think you can. The longer the distance, the bigger the payoff — if they remember.', cue: 'callback', skill: 'crowdwork', needsQuiet: 0.5 },
  'misdirection': { id: 'misdirection', name: 'Misdirection', what: 'Lead them to one picture, then reveal they were looking at the wrong one.', drill: 'Build the obvious assumption on purpose. The punch is one word that flips it.', skill: 'writing', needsQuiet: 0.6 },
  'act-out': { id: 'act-out', name: 'The Act-Out', what: 'Stop telling, start showing: become the person, the object, the moment.', drill: 'Do not describe what they did — do it. Body, face, voice. Hold the act-out a beat longer than is comfortable.', cue: 'act-out', skill: 'presence', needsQuiet: 0.2 },
  'character-voice': { id: 'character-voice', name: 'Character Voices', what: 'A cast of recurring people, each with a voice the room learns.', drill: 'Give every person in the story a voice and a posture. Once the room knows them, you only need the voice.', cue: 'voice', skill: 'presence', needsQuiet: 0.3 },
  'escalation': { id: 'escalation', name: 'Escalation', what: 'Each line raises the stakes until the bit is absurd — and still logical.', drill: 'Every sentence goes one step further than the last. Never skip a step; the logic is the joke.', skill: 'originality', needsQuiet: 0.3 },
  'preacher-cadence': { id: 'preacher-cadence', name: 'Preacher Cadence', what: 'Call-and-response rhythm: build, repeat, build, release — church tempo.', drill: 'Say the premise, say it again louder, give the room room to answer, then bring it home.', cue: 'build', skill: 'delivery', needsQuiet: 0.1 },
  'repetition': { id: 'repetition', name: 'Repetition', what: 'A phrase repeated until it turns from a line into a laugh into a chant.', drill: 'Find the phrase. Say it again. And again. The third time it is a joke, the sixth time it is theirs.', skill: 'delivery', needsQuiet: 0.2 },
  'crowd-work': { id: 'crowd-work', name: 'Crowd Work', what: 'Talk to real people in the room and find the joke in their answers.', drill: 'Ask a simple question. Listen to the actual answer. The joke is in the detail they did not mean to give you.', cue: 'to the crowd', skill: 'crowdwork', needsQuiet: 0.1 },
  'heckler-control': { id: 'heckler-control', name: 'Heckler Control', what: 'Shut a heckler down without losing the room — the room has to stay on your side.', drill: 'Let them finish. Repeat their line back so the room hears it. One shot, then back to the set — never chase.', cue: 'to the heckler', skill: 'crowdwork', needsQuiet: 0.1 },
  'confessional': { id: 'confessional', name: 'Confessional', what: 'The truth about yourself nobody would say out loud.', drill: 'Tell the thing you should be ashamed of with total commitment. The room laughs because they recognize it.', skill: 'originality', needsQuiet: 0.7 },
  'self-deprecation': { id: 'self-deprecation', name: 'Self-Deprecation', what: 'You are the punchline — which earns the right to make anyone else one.', drill: 'Hit yourself first and hardest. Once they know you will go there on you, they will follow you anywhere.', skill: 'presence', needsQuiet: 0.4 },
  'the-stare': { id: 'the-stare', name: 'The Stare', what: 'A long look at the audience after the line, daring them not to laugh.', drill: 'Say it. Then look at them. Do not smile, do not move. The silence is the second punchline.', cue: 'stare', skill: 'presence', needsQuiet: 0.6 },
  'rant': { id: 'rant', name: 'The Rant', what: 'Righteous anger at full speed with jokes buried inside it.', drill: 'Pick a target you genuinely hate. Speed up. Bury the punchlines inside the fury so they hit before the room sees them coming.', cue: 'build', skill: 'delivery', needsQuiet: 0.2 },
  'list-build': { id: 'list-build', name: 'The List', what: 'A rhythmic list that gets more specific and more absurd with every item.', drill: 'Name things. Each item narrower and stranger. The rhythm carries them; the last item drops them.', skill: 'writing', needsQuiet: 0.4 },
  'wordplay': { id: 'wordplay', name: 'Wordplay', what: 'Take the language apart — the words we use, and what they really say.', drill: 'Pick a phrase everyone uses. Read it literally. The gap between what it says and what it means is the joke.', skill: 'writing', needsQuiet: 0.8 },
  'deadpan': { id: 'deadpan', name: 'Deadpan', what: 'No visible reaction to your own absurdity.', drill: 'Flat face, flat voice. The less you sell it, the harder it lands.', skill: 'delivery', needsQuiet: 0.8 },
  'one-liner-rhythm': { id: 'one-liner-rhythm', name: 'One-Liner Rhythm', what: 'Joke, laugh, joke, laugh — a metronome of punchlines.', drill: 'Setup and punch in one breath. No transitions. Keep the meter so steady they laugh on the beat.', skill: 'writing', needsQuiet: 0.5 },
  'anti-joke': { id: 'anti-joke', name: 'The Anti-Joke', what: 'Refuse the punchline they expect; the refusal is the punchline.', drill: 'Build like a classic joke. Land on something so literal or so wrong that the room laughs at the gap.', skill: 'originality', needsQuiet: 0.7 },
  'shaggy-dog': { id: 'shaggy-dog', name: 'Shaggy Dog', what: 'A long, winding story whose payoff is the journey — or a deliberately small ending.', drill: 'Take your time. Add detail they do not need. Commit fully, and make them trust you that it is going somewhere.', skill: 'writing', needsQuiet: 0.9 },
  'mock-indignation': { id: 'mock-indignation', name: 'Mock Indignation', what: 'Disbelief played big: you cannot believe the thing that is actually happening.', drill: 'React to the news like it is a personal insult. Stop. Look at them. Ask the obvious question nobody asks.', cue: 'look', skill: 'presence', needsQuiet: 0.4 },
  'in-character': { id: 'in-character', name: 'In Character', what: 'Perform the whole set as a persona whose blind spots are the joke.', drill: 'Never wink. The character believes every word; the room sees what the character cannot.', skill: 'originality', needsQuiet: 0.5 },
  'truth-bomb': { id: 'truth-bomb', name: 'The Truth Bomb', what: 'Say the uncomfortable true thing, then let the room sit in it.', drill: 'Say it plainly. Do not soften it. Wait out the gasp — the laugh comes after the gasp.', cue: 'beat', skill: 'originality', needsQuiet: 0.6 },
  'raunch-with-class': { id: 'raunch-with-class', name: 'Raunch with Class', what: 'Blue material delivered with total poise — the elegance is the contrast.', drill: 'Stand like royalty. Say the filthiest true thing in the most composed voice in the building.', skill: 'presence', needsQuiet: 0.3 },
  'riff': { id: 'riff', name: 'The Riff', what: 'Improvise off what just happened in the room as if it were planned.', drill: 'Something happens — a glass breaks, a phone rings. Stop the set and make it the best joke of the night.', cue: 'riff', skill: 'crowdwork', needsQuiet: 0.1 },
  'physical-space': { id: 'physical-space', name: 'Owning the Stage', what: 'Use the whole stage: walk it, plant, return to the stand for the punch.', drill: 'Move on the setup, freeze on the punch. Where you stand tells them when the laugh is coming.', skill: 'presence', needsQuiet: 0.2 },
  'laugh-at-yourself': { id: 'laugh-at-yourself', name: 'Breaking (on purpose)', what: 'Laughing at your own joke so the room laughs with you.', drill: 'If it delights you, let it show — once. Your laugh tells them it is safe to go further.', skill: 'presence', needsQuiet: 0.3 },
  'the-turn': { id: 'the-turn', name: 'The Turn', what: 'Halfway through, flip the bit on its head — or on yourself.', drill: 'Get them agreeing with you. Then turn it, so the target was them, or you, all along.', skill: 'originality', needsQuiet: 0.5 }
};

export type EraTag = 'party-records' | 'chitlin-circuit' | 'def-jam' | 'comic-view' | 'kings-of-comedy' | 'boom' | 'late-night' | 'alt' | 'special-era';

export interface Master {
  key: string;
  name: string;
  era: EraTag;
  /** How they owned a stage — the thing a student watches for. */
  presence: string;
  craft: CraftId[];
  styles: string[];        // Circuit styles they teach best
}

export const ERA_LABEL: Record<EraTag, string> = {
  'party-records': 'the party-record days', 'chitlin-circuit': 'the Chitlin’ Circuit', 'def-jam': 'the Def Comedy Jam era', 'comic-view': 'the Comic View era',
  'kings-of-comedy': 'the Kings & Queens of Comedy tours', boom: 'the comedy-club boom', 'late-night': 'late-night satire', alt: 'the alt-comedy rooms', 'special-era': 'the streaming-special era'
};

export const MASTERS: Master[] = [
  // The names the Circuit's students ask about first.
  { key: 'redd-foxx', name: 'Redd Foxx', era: 'party-records', presence: 'a sly, grinning storyteller who made the room feel like a back-room party you were lucky to get into', craft: ['raunch-with-class', 'shaggy-dog', 'the-stare', 'tag-stack'], styles: ['storytelling', 'dark'] },
  { key: 'katt-williams', name: 'Katt Williams', era: 'special-era', presence: 'pure kinetic energy — pacing the whole stage, rapid word-flurries that build to a shouted peak, then a sudden drop to a whisper', craft: ['preacher-cadence', 'escalation', 'physical-space', 'repetition', 'rant'], styles: ['observational', 'crowd-work', 'absurdist'] },
  { key: 'dave-chappelle', name: 'Dave Chappelle', era: 'special-era', presence: 'unhurried and conversational, long setups that wander on purpose, callbacks planted an hour early, laughing at his own turn', craft: ['long-callback', 'shaggy-dog', 'misdirection', 'laugh-at-yourself', 'the-turn', 'let-it-breathe'], styles: ['storytelling', 'observational', 'dark'] },
  { key: 'george-carlin', name: 'George Carlin', era: 'boom', presence: 'the furious professor — precise language, lists delivered like a drumroll, anger that never lost its rhythm', craft: ['wordplay', 'list-build', 'rant', 'truth-bomb', 'one-liner-rhythm'], styles: ['observational', 'one-liners', 'dark'] },
  { key: 'martin-lawrence', name: 'Martin Lawrence', era: 'def-jam', presence: 'electric physical commitment — every story becomes a full act-out with characters, faces and voices', craft: ['act-out', 'character-voice', 'escalation', 'physical-space'], styles: ['storytelling', 'absurdist', 'crowd-work'] },
  { key: 'corey-holcomb', name: 'Corey Holcomb', era: 'comic-view', presence: 'slow, low, unbothered — contrarian relationship logic delivered so calmly the room argues with him and laughs anyway', craft: ['deadpan', 'truth-bomb', 'the-turn', 'the-stare'], styles: ['deadpan', 'dark', 'observational'] },
  { key: 'rodney-dangerfield', name: 'Rodney Dangerfield', era: 'boom', presence: 'a sweating, tie-tugging bundle of nerves firing one self-inflicted wound after another', craft: ['one-liner-rhythm', 'self-deprecation', 'tag-stack', 'rule-of-three'], styles: ['one-liners'] },
  { key: 'sommore', name: 'Sommore', era: 'kings-of-comedy', presence: 'total command — glamorous, unhurried, blue material delivered like a queen holding court', craft: ['raunch-with-class', 'the-stare', 'truth-bomb', 'crowd-work'], styles: ['observational', 'crowd-work', 'storytelling'] },
  { key: 'ali-wong', name: 'Ali Wong', era: 'special-era', presence: 'fearless candor and full-body act-outs — the more taboo the detail, the more specific and committed she gets', craft: ['confessional', 'act-out', 'truth-bomb', 'escalation'], styles: ['observational', 'storytelling', 'dark'] },
  { key: 'patrice-oneal', name: "Patrice O'Neal", era: 'boom', presence: 'a conversation, not a set — confrontational, honest, happy to let a room sit in silence until it agrees with him', craft: ['crowd-work', 'truth-bomb', 'let-it-breathe', 'riff', 'laugh-at-yourself'], styles: ['crowd-work', 'dark', 'observational'] },
  { key: 'jon-stewart', name: 'Jon Stewart', era: 'late-night', presence: 'incredulous everyman — the pause, the look to camera, the head in his hands at the absurdity of the news', craft: ['mock-indignation', 'the-pause', 'the-turn', 'misdirection'], styles: ['observational', 'one-liners'] },
  { key: 'stephen-colbert', name: 'Stephen Colbert', era: 'late-night', presence: 'a fully committed character whose pompous certainty reveals exactly what he is mocking', craft: ['in-character', 'deadpan', 'escalation', 'wordplay'], styles: ['absurdist', 'deadpan'] },
  { key: 'donald-glover', name: 'Donald Glover', era: 'alt', presence: 'playful and nerdy, absurd specificity in personal stories, voices that pop out mid-sentence', craft: ['escalation', 'character-voice', 'confessional', 'misdirection'], styles: ['absurdist', 'storytelling'] },
  { key: 'bernie-mac', name: 'Bernie Mac', era: 'kings-of-comedy', presence: 'commanding and fearless — the long stare, direct address to the whole room, a slow wind-up into tough-love honesty', craft: ['the-stare', 'preacher-cadence', 'truth-bomb', 'let-it-breathe', 'physical-space'], styles: ['storytelling', 'crowd-work', 'observational'] },
  { key: 'scruncho', name: 'Scruncho', era: 'comic-view', presence: 'cool and laid-back — a smooth, unbothered delivery that makes quick wit look effortless', craft: ['deadpan', 'riff', 'crowd-work', 'one-liner-rhythm'], styles: ['crowd-work', 'one-liners', 'deadpan'] },
  // Comic View, Def Jam and the Kings & Queens tours.
  { key: 'steve-harvey', name: 'Steve Harvey', era: 'kings-of-comedy', presence: 'church-tempo storyteller with huge faces — every reaction shot is its own laugh', craft: ['preacher-cadence', 'act-out', 'mock-indignation'], styles: ['storytelling', 'observational'] },
  { key: 'cedric', name: 'Cedric the Entertainer', era: 'kings-of-comedy', presence: 'smooth and suave, a showman who glides between his own voice and the characters he becomes', craft: ['character-voice', 'physical-space', 'let-it-breathe'], styles: ['storytelling', 'observational'] },
  { key: 'dl-hughley', name: 'D.L. Hughley', era: 'comic-view', presence: 'quick, sharp social commentary — the hard point made fast and grinning', craft: ['truth-bomb', 'the-turn', 'one-liner-rhythm'], styles: ['observational', 'one-liners'] },
  { key: 'mike-epps', name: 'Mike Epps', era: 'def-jam', presence: 'loose and loopy, ad-libs and characters that feel invented on the spot', craft: ['riff', 'character-voice', 'act-out'], styles: ['absurdist', 'storytelling', 'crowd-work'] },
  { key: 'chris-tucker', name: 'Chris Tucker', era: 'def-jam', presence: 'high-pitched, high-speed, all limbs — energy as a punchline', craft: ['physical-space', 'act-out', 'escalation'], styles: ['absurdist', 'observational'] },
  { key: 'bill-bellamy', name: 'Bill Bellamy', era: 'def-jam', presence: 'cool, charming and observational — naming the thing everyone does but never named', craft: ['wordplay', 'misdirection', 'crowd-work'], styles: ['observational'] },
  { key: 'monique', name: "Mo'Nique", era: 'kings-of-comedy', presence: 'big, warm, unstoppable — she takes the room hostage and it thanks her', craft: ['crowd-work', 'raunch-with-class', 'preacher-cadence'], styles: ['crowd-work', 'observational'] },
  { key: 'adele-givens', name: 'Adele Givens', era: 'kings-of-comedy', presence: 'ladylike poise wrapped around the filthiest material in the room', craft: ['raunch-with-class', 'deadpan', 'the-stare'], styles: ['deadpan', 'observational'] },
  { key: 'bruce-bruce', name: 'Bruce Bruce', era: 'comic-view', presence: 'big-hearted Southern storyteller who works clean and still tears the roof off', craft: ['shaggy-dog', 'act-out', 'crowd-work'], styles: ['storytelling', 'crowd-work'] },
  { key: 'earthquake', name: 'Earthquake', era: 'def-jam', presence: 'a booming storyteller who turns everyday arguments into epic sagas', craft: ['escalation', 'preacher-cadence', 'act-out'], styles: ['storytelling'] },
  { key: 'paul-mooney', name: 'Paul Mooney', era: 'boom', presence: 'calm, fearless, laughing at his own truth — he never flinched first', craft: ['truth-bomb', 'laugh-at-yourself', 'the-stare'], styles: ['dark', 'observational'] },
  { key: 'richard-pryor', name: 'Richard Pryor', era: 'boom', presence: 'raw confession turned into theater — he played every person in his own disasters', craft: ['confessional', 'act-out', 'character-voice', 'truth-bomb'], styles: ['storytelling', 'dark'] },
  { key: 'eddie-murphy', name: 'Eddie Murphy', era: 'boom', presence: 'swagger in a leather suit — impressions, characters and total confidence', craft: ['character-voice', 'act-out', 'physical-space'], styles: ['storytelling', 'absurdist'] },
  { key: 'chris-rock', name: 'Chris Rock', era: 'boom', presence: 'pacing like a preacher, repeating the premise until it becomes a sermon', craft: ['preacher-cadence', 'repetition', 'truth-bomb', 'physical-space'], styles: ['observational', 'dark'] },
  { key: 'moms-mabley', name: 'Moms Mabley', era: 'chitlin-circuit', presence: 'a disarming persona that smuggled sharp truths past any audience', craft: ['in-character', 'truth-bomb', 'raunch-with-class'], styles: ['storytelling', 'observational'] },
  { key: 'dick-gregory', name: 'Dick Gregory', era: 'chitlin-circuit', presence: 'cool, cigarette-calm topical wit that made the room laugh at itself', craft: ['the-turn', 'deadpan', 'truth-bomb'], styles: ['observational', 'one-liners'] },
  // The boom, alt rooms and specials.
  { key: 'joan-rivers', name: 'Joan Rivers', era: 'boom', presence: 'rapid-fire confidante leaning in to tell you the thing nobody else would', craft: ['one-liner-rhythm', 'confessional', 'tag-stack'], styles: ['one-liners', 'dark'] },
  { key: 'jerry-seinfeld', name: 'Jerry Seinfeld', era: 'boom', presence: 'surgical observation — every word cut until only the funny ones are left', craft: ['wordplay', 'rule-of-three', 'the-pause'], styles: ['observational'] },
  { key: 'robin-williams', name: 'Robin Williams', era: 'boom', presence: 'a hurricane of voices and associations that never stopped moving', craft: ['riff', 'character-voice', 'escalation'], styles: ['absurdist'] },
  { key: 'mitch-hedberg', name: 'Mitch Hedberg', era: 'alt', presence: 'shy, eyes down, odd little pauses and a sideways brain', craft: ['one-liner-rhythm', 'anti-joke', 'deadpan'], styles: ['one-liners', 'absurdist'] },
  { key: 'steven-wright', name: 'Steven Wright', era: 'boom', presence: 'the flattest voice in comedy, surreal one-liners dropped like facts', craft: ['deadpan', 'one-liner-rhythm', 'anti-joke'], styles: ['deadpan', 'one-liners', 'absurdist'] },
  { key: 'norm-macdonald', name: 'Norm Macdonald', era: 'late-night', presence: 'a folksy anti-comedian who made the room wait for a payoff that was the waiting itself', craft: ['shaggy-dog', 'anti-joke', 'deadpan', 'let-it-breathe'], styles: ['deadpan', 'storytelling'] },
  { key: 'tig-notaro', name: 'Tig Notaro', era: 'alt', presence: 'quiet, still and patient — she will let a silence go on until it becomes the joke', craft: ['let-it-breathe', 'deadpan', 'repetition', 'confessional'], styles: ['deadpan', 'storytelling'] },
  { key: 'bill-burr', name: 'Bill Burr', era: 'special-era', presence: 'red-faced rant that turns on himself just when you think he has gone too far', craft: ['rant', 'the-turn', 'self-deprecation', 'crowd-work'], styles: ['dark', 'observational'] },
  { key: 'wanda-sykes', name: 'Wanda Sykes', era: 'special-era', presence: 'dry, side-eyeing commentary with a perfectly timed raised eyebrow', craft: ['mock-indignation', 'deadpan', 'the-stare'], styles: ['observational', 'deadpan'] },
  { key: 'kevin-hart', name: 'Kevin Hart', era: 'special-era', presence: 'high-energy self-roasting storyteller who acts out every humiliation at full volume', craft: ['self-deprecation', 'act-out', 'escalation', 'physical-space'], styles: ['storytelling'] },
  { key: 'tiffany-haddish', name: 'Tiffany Haddish', era: 'special-era', presence: 'unfiltered joy — her delight in the story is contagious', craft: ['confessional', 'act-out', 'laugh-at-yourself'], styles: ['storytelling'] },
  { key: 'hannibal-buress', name: 'Hannibal Buress', era: 'alt', presence: 'low-key, almost bored, repeating the line until the room cracks', craft: ['repetition', 'deadpan', 'riff'], styles: ['deadpan', 'observational'] },
  { key: 'john-mulaney', name: 'John Mulaney', era: 'special-era', presence: 'polished storyteller who structures an hour like a play and pays every setup off', craft: ['callback', 'long-callback', 'rule-of-three', 'character-voice'], styles: ['storytelling'] },
  { key: 'dave-attell', name: 'Dave Attell', era: 'boom', presence: 'a late-night barfly firing filthy one-liners and roasting the front row between them', craft: ['one-liner-rhythm', 'crowd-work', 'heckler-control'], styles: ['one-liners', 'crowd-work', 'dark'] },
  { key: 'maria-bamford', name: 'Maria Bamford', era: 'alt', presence: 'a gentle chorus of uncanny voices — her whole family lives in her throat', craft: ['character-voice', 'confessional', 'escalation'], styles: ['absurdist', 'dark'] },
  { key: 'jo-koy', name: 'Jo Koy', era: 'special-era', presence: 'big family act-outs with the accents and the love intact', craft: ['act-out', 'character-voice', 'crowd-work'], styles: ['storytelling', 'crowd-work'] },
  { key: 'gabriel-iglesias', name: 'Gabriel Iglesias', era: 'special-era', presence: 'warm, clean storyteller with sound effects and voices for everyone', craft: ['character-voice', 'act-out', 'shaggy-dog'], styles: ['storytelling'] }
];

// ---------------------------------------------------------------------
// Personas — the relationship a comic has with a room
// ---------------------------------------------------------------------

export interface Persona {
  key: string;
  name: string;
  /** How they relate to the room, in one line. */
  stance: string;
  craft: CraftId[];
  styles: string[];
}

export const PERSONAS: Persona[] = [
  { key: 'preacher', name: 'The Preacher', stance: 'delivers a sermon; the room is the congregation and answers back', craft: ['preacher-cadence', 'repetition', 'truth-bomb'], styles: ['observational', 'storytelling', 'dark'] },
  { key: 'confessor', name: 'The Confessor', stance: 'tells the room secrets; the laugh is recognition', craft: ['confessional', 'self-deprecation', 'let-it-breathe'], styles: ['storytelling', 'dark', 'observational'] },
  { key: 'host', name: 'The Host', stance: 'throws the party; everyone in the room is a guest and part of the show', craft: ['crowd-work', 'riff', 'long-callback'], styles: ['crowd-work', 'observational'] },
  { key: 'professor', name: 'The Professor', stance: 'explains the world with total precision; the logic is airtight and insane', craft: ['wordplay', 'list-build', 'escalation'], styles: ['observational', 'one-liners', 'absurdist'] },
  { key: 'bully', name: 'The Bully (with love)', stance: 'roasts the room so the room can feel roasted together', craft: ['heckler-control', 'crowd-work', 'the-stare'], styles: ['crowd-work', 'dark'] },
  { key: 'mess', name: 'The Beautiful Mess', stance: 'a disaster on stage the room cannot stop rooting for', craft: ['self-deprecation', 'act-out', 'laugh-at-yourself'], styles: ['storytelling', 'absurdist'] },
  { key: 'stone', name: 'The Stone Face', stance: 'never cracks; the room does all the reacting', craft: ['deadpan', 'the-pause', 'anti-joke'], styles: ['deadpan', 'one-liners'] },
  { key: 'royal', name: 'Royalty', stance: 'holds court; the room is lucky to be let in', craft: ['raunch-with-class', 'the-stare', 'let-it-breathe'], styles: ['observational', 'crowd-work', 'storytelling'] },
  { key: 'griot', name: 'The Griot', stance: 'a storyteller carrying the whole family, the block and the history in one long tale', craft: ['shaggy-dog', 'character-voice', 'callback'], styles: ['storytelling'] },
  { key: 'livewire', name: 'The Livewire', stance: 'all energy, all stage, all at once', craft: ['physical-space', 'escalation', 'act-out'], styles: ['absurdist', 'crowd-work', 'observational'] },
  { key: 'everyman', name: 'The Everyman', stance: 'just as baffled as you are, and saying so', craft: ['mock-indignation', 'rule-of-three', 'misdirection'], styles: ['observational', 'one-liners'] },
  { key: 'character', name: 'The Character', stance: 'is not themselves up there at all; the persona is the joke', craft: ['in-character', 'character-voice', 'deadpan'], styles: ['absurdist', 'deadpan'] }
];

export const masterByKey = (k: string) => MASTERS.find(m => m.key === k);
export const personaByKey = (k: string) => PERSONAS.find(p => p.key === k);

/**
 * Pick from a pool, weighted by fit, and pushed away from what the Circuit
 * already has — every new comic should add a voice the scene is missing.
 */
export function pickDiverse<T extends { key: string; styles: string[] }>(
  pool: T[], style: string, r: () => number, used: Record<string, number>, n: number, prefer: string[] = []
): T[] {
  const out: T[] = [];
  const left = [...pool];
  while (out.length < n && left.length) {
    const w = left.map(x => (x.styles.includes(style) ? 3 : 0.6) * (prefer.includes(x.key) ? 2.5 : 1) / (1 + (used[x.key] || 0) * 1.5));
    const total = w.reduce((a, b) => a + b, 0);
    let roll = r() * total, i = 0;
    for (; i < left.length - 1; i++) if ((roll -= w[i]) <= 0) break;
    out.push(left[i]);
    left.splice(i, 1);
  }
  return out;
}
