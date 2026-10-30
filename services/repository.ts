
import {
  Comedian, Set, Clip, Promo, ScoutTarget,
  AutopilotJob, OutboxItem, AISettings, AutopilotConfig,
  PublishingSettings, ComedianProfile, Material, MaterialType
} from '../types';

// =====================================================================
// Repository interface — the v2 cloud bridge.
//
// All persistence in v1 goes through this interface. The IndexedDB
// implementation lives in this same file. A future Postgres/Supabase
// implementation can be swapped in without touching agent code.
// =====================================================================

export interface Repository {
  // Comedians
  getComedian(id: string): Promise<Comedian | undefined>;
  listComedians(): Promise<Comedian[]>;
  saveComedian(c: Comedian): Promise<void>;
  deleteComedian(id: string): Promise<void>;

  // Sets
  getSet(id: string): Promise<Set | undefined>;
  listSets(comedianId: string): Promise<Set[]>;
  saveSet(s: Set): Promise<void>;
  deleteSet(id: string): Promise<void>;

  // Clips
  getClip(id: string): Promise<Clip | undefined>;
  listClips(comedianId: string): Promise<Clip[]>;
  saveClip(c: Clip): Promise<void>;
  deleteClip(id: string): Promise<void>;

  // Promos
  listPromos(comedianId: string): Promise<Promo[]>;
  savePromo(p: Promo): Promise<void>;
  deletePromo(id: string): Promise<void>;

  // Scout outreach
  listScouts(comedianId: string): Promise<ScoutTarget[]>;
  saveScout(t: ScoutTarget): Promise<void>;
  deleteScout(id: string): Promise<void>;

  // Autopilot jobs
  listJobs(comedianId?: string): Promise<AutopilotJob[]>;
  saveJob(j: AutopilotJob): Promise<void>;
  deleteJob(id: string): Promise<void>;

  // Outbox
  listOutbox(comedianId?: string): Promise<OutboxItem[]>;
  saveOutboxItem(o: OutboxItem): Promise<void>;
  deleteOutboxItem(id: string): Promise<void>;

  // Settings
  getSettings(): Promise<AISettings>;
  saveSettings(s: AISettings): Promise<void>;
}

// =====================================================================
// IndexedDB implementation
// =====================================================================

const DB_NAME = 'Sitcomify_DB';
const DB_VERSION = 4;

const STORE_SETTINGS = 'settings';            // existing
const STORE_COMEDIANS = 'comedians';
const STORE_SETS = 'sets';
const STORE_CLIPS = 'clips';
const STORE_PROMOS = 'promos';
const STORE_SCOUTS = 'scouts';
const STORE_JOBS = 'autopilot_jobs';
const STORE_OUTBOX = 'network_outbox';

// Legacy (read-only, for one-time migration).
const LEGACY_PREMISES = 'sitcoms';
const LEGACY_SHOWS = 'shows';
const LEGACY_EPISODES = 'episodes';
const LEGACY_SHORTS = 'shorts';
const LEGACY_ADS = 'ads';
const LEGACY_INFLUENCERS = 'influencers';

// One shared connection for the whole session — opening a fresh IndexedDB
// connection per transaction is a major latency tax.
let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Settings store (carried over from earlier versions).
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS);
      }

      // v4 — OpenMic roster stores.
      if (!db.objectStoreNames.contains(STORE_COMEDIANS)) {
        db.createObjectStore(STORE_COMEDIANS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETS)) {
        const s = db.createObjectStore(STORE_SETS, { keyPath: 'id' });
        s.createIndex('comedianId', 'comedianId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CLIPS)) {
        const s = db.createObjectStore(STORE_CLIPS, { keyPath: 'id' });
        s.createIndex('comedianId', 'comedianId', { unique: false });
        s.createIndex('setId', 'setId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PROMOS)) {
        const s = db.createObjectStore(STORE_PROMOS, { keyPath: 'id' });
        s.createIndex('comedianId', 'comedianId', { unique: false });
        s.createIndex('setId', 'setId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SCOUTS)) {
        const s = db.createObjectStore(STORE_SCOUTS, { keyPath: 'id' });
        s.createIndex('comedianId', 'comedianId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        const s = db.createObjectStore(STORE_JOBS, { keyPath: 'id' });
        s.createIndex('comedianId', 'comedianId', { unique: false });
        s.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const s = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
        s.createIndex('comedianId', 'comedianId', { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the schema, drop our cached handle so the
      // next call reopens cleanly instead of erroring forever.
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      db.onclose = () => { _dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { _dbPromise = null; reject(request.error); };
  });
  return _dbPromise;
}

function tx<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
  return openDB().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result: any;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    Promise.resolve(work(t)).then(v => { result = v; }).catch(reject);
  }));
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const DEFAULT_AUTOPILOT_CONFIG: AutopilotConfig = {
  enabled: false,
  setsPerWeek: 1,
  clipsPerSet: 5,
  generateVideo: false,
  requireApproval: true,
  tickIntervalMs: 60_000,
  setIntervalMs: Math.round((7 * 24 * 60 * 60 * 1000) / 1) // weekly
};

export const DEFAULT_PUBLISHING_SETTINGS: PublishingSettings = {
  visibility: 'outbox',
  clipPlatforms: ['youtube_shorts', 'instagram_reel', 'x_video'],
  publishTargetName: 'Standupify Network'
};

export const DEFAULT_SETTINGS: AISettings = {
  quality: 'auto',
  imageEngine: 'auto',
  imageRecipe: null,
  videoRecipe: null,
  venue: 'cellar',
  cameraMove: 'dolly-in',
  clipSeconds: 4,
  autoVoice: true,
  autoJudge: true,
  autoOriginals: true
};

export function emptyProfile(): ComedianProfile {
  return {
    material: [],
    runningBits: [],
    viralClipIds: [],
    audienceSignals: [],
    brandSafetyRules: []
  };
}

// Fill any missing structure on a comedian record so partial imports and
// legacy rows can never crash the UI (e.g. `c.autopilotConfig.enabled`).
export function normalizeComedian(c: any): Comedian {
  const now = Date.now();
  return {
    id: c.id || `comedian_${now}_${Math.random().toString(36).slice(2, 9)}`,
    name: c.name || 'Unnamed Comic',
    tagline: c.tagline || '',
    voice: c.voice || 'Observational',
    style: c.style || 'observational',
    audience: c.audience || 'General',
    status: c.status || 'active',
    publishVisibility: c.publishVisibility || 'outbox',
    profile: { ...emptyProfile(), ...(c.profile || {}) },
    publishingSettings: { ...DEFAULT_PUBLISHING_SETTINGS, ...(c.publishingSettings || {}) },
    autopilotConfig: { ...DEFAULT_AUTOPILOT_CONFIG, ...(c.autopilotConfig || {}) },
    avatarImage: c.avatarImage,
    look: c.look,
    headshotUrl: c.headshotUrl,
    venue: c.venue,
    walkOnUrl: c.walkOnUrl,
    createdAt: c.createdAt || now,
    updatedAt: c.updatedAt || now
  };
}

// Map the old sitcom EntityType onto the new stand-up MaterialType.
function mapMaterialType(t: string): MaterialType {
  switch (t) {
    case 'CHARACTER': return 'PERSONA';
    case 'OBJECT': return 'PROP';
    case 'LOCATION': return 'VENUE';
    case 'PLOT_POINT': return 'BIT';
    case 'PUNCHLINE': return 'CATCHPHRASE';
    case 'THEME': return 'THEME';
    // already-migrated material types pass through
    case 'PERSONA': case 'PROP': case 'VENUE': case 'BIT': case 'CATCHPHRASE':
      return t;
    default: return 'BIT';
  }
}

function migrateMaterial(entities: any[]): Material[] {
  return (entities || []).map((e, i) => ({
    id: String(e.id || `mat_${i}`),
    name: e.name || 'Material',
    type: mapMaterialType(e.type),
    description: e.description || ''
  }));
}

async function safeGetAll<T>(t: IDBTransaction, store: string): Promise<T[]> {
  if (!t.db.objectStoreNames.contains(store)) return [];
  return reqAsPromise<T[]>(t.objectStore(store).getAll());
}

// One-time migration: lift legacy sitcom data into the comedian roster.
// Runs only when the comedian store is empty and legacy data exists.
async function migrateLegacy(db: IDBDatabase): Promise<void> {
  const legacyStores = [
    LEGACY_PREMISES, LEGACY_SHOWS, LEGACY_EPISODES, LEGACY_SHORTS, LEGACY_ADS, LEGACY_INFLUENCERS
  ].filter(s => db.objectStoreNames.contains(s));

  // Nothing to migrate from.
  if (legacyStores.length === 0) return;

  const readStores = [STORE_COMEDIANS, ...legacyStores];
  const t = db.transaction(readStores, 'readonly');
  const existingComedians = await reqAsPromise<Comedian[]>(t.objectStore(STORE_COMEDIANS).getAll());
  if (existingComedians.length > 0) return; // already migrated

  const premises = await safeGetAll<any>(t, LEGACY_PREMISES);
  const shows = await safeGetAll<any>(t, LEGACY_SHOWS);
  const episodes = await safeGetAll<any>(t, LEGACY_EPISODES);
  const shorts = await safeGetAll<any>(t, LEGACY_SHORTS);
  const ads = await safeGetAll<any>(t, LEGACY_ADS);
  const influencers = await safeGetAll<any>(t, LEGACY_INFLUENCERS);

  if (premises.length === 0 && shows.length === 0) return;

  const now = Date.now();
  const comedians: Comedian[] = [];
  const sets: Set[] = [];
  const clips: Clip[] = [];
  const promos: Promo[] = [];
  const scouts: ScoutTarget[] = [];

  // --- Legacy single-photo premises -> comedian + debut set ---
  for (const p of premises) {
    const c: Comedian = {
      id: p.id,
      name: p.showTitle || 'Unnamed Comic',
      tagline: p.tagline || 'Newly discovered.',
      voice: 'Observational, brought to you from a former sitcom universe.',
      style: 'observational',
      audience: 'General',
      status: 'archived',
      publishVisibility: 'private',
      profile: { ...emptyProfile(), material: migrateMaterial(p.entities) },
      publishingSettings: { ...DEFAULT_PUBLISHING_SETTINGS, visibility: 'private' },
      autopilotConfig: { ...DEFAULT_AUTOPILOT_CONFIG },
      avatarImage: p.originalImage,
      createdAt: p.timestamp || now,
      updatedAt: now
    };
    comedians.push(c);
    sets.push({
      id: `${p.id}_debut`,
      comedianId: c.id,
      title: 'Debut Set',
      logline: p.tagline || '',
      status: 'ready',
      bits: p.scenes || [],
      clipIds: [],
      promoIds: [],
      publishedUrls: [],
      analytics: {},
      generatedBy: 'debut',
      createdAt: p.timestamp || now,
      updatedAt: now
    });
  }

  // --- Legacy Network shows -> comedian (preserve id for episode/short links) ---
  for (const sh of shows) {
    comedians.push({
      id: sh.id,
      name: sh.title || 'Unnamed Comic',
      tagline: sh.tagline || '',
      voice: 'Observational',
      style: (sh.genre || 'observational').toLowerCase(),
      audience: sh.audience || 'General',
      status: sh.status === 'archived' ? 'archived' : 'active',
      publishVisibility: sh.publishVisibility === 'sitcomify_network' ? 'openmic_network' : (sh.publishVisibility || 'private'),
      profile: {
        ...emptyProfile(),
        material: migrateMaterial(sh.worldModel?.entities),
        runningBits: sh.worldModel?.runningJokes || [],
        viralClipIds: sh.worldModel?.viralClipIds || [],
        audienceSignals: sh.worldModel?.audienceSignals || [],
        brandSafetyRules: sh.worldModel?.brandSafetyRules || [],
        promoVoice: sh.worldModel?.promoVoice
      },
      publishingSettings: {
        visibility: sh.publishingSettings?.visibility === 'sitcomify_network' ? 'openmic_network' : (sh.publishingSettings?.visibility || 'outbox'),
        clipPlatforms: sh.publishingSettings?.shortsPlatforms || DEFAULT_PUBLISHING_SETTINGS.clipPlatforms,
        publishTargetName: 'OpenMic Network'
      },
      autopilotConfig: {
        enabled: !!sh.nightShiftConfig?.enabled,
        setsPerWeek: sh.nightShiftConfig?.episodesPerWeek ?? 1,
        clipsPerSet: sh.nightShiftConfig?.shortsPerEpisode ?? 5,
        generateVideo: !!sh.nightShiftConfig?.generateVeo,
        requireApproval: sh.nightShiftConfig?.requireApproval ?? true,
        tickIntervalMs: sh.nightShiftConfig?.tickIntervalMs ?? 60_000,
        setIntervalMs: sh.nightShiftConfig?.episodeIntervalMs ?? DEFAULT_AUTOPILOT_CONFIG.setIntervalMs,
        lastSetAt: sh.nightShiftConfig?.lastEpisodeAt
      },
      avatarImage: sh.originalImage,
      createdAt: sh.createdAt || now,
      updatedAt: now
    });
  }

  for (const ep of episodes) {
    sets.push({
      id: ep.id,
      comedianId: ep.showId,
      title: ep.title,
      logline: ep.logline,
      status: ep.status || 'ready',
      bits: ep.scenes || [],
      clipIds: ep.shortIds || [],
      promoIds: ep.adIds || [],
      publishedUrls: ep.publishedUrls || [],
      analytics: ep.analytics || {},
      generatedBy: ep.generatedBy === 'pilot' ? 'debut' : (ep.generatedBy === 'night_shift' ? 'autopilot' : 'manual'),
      createdAt: ep.createdAt || now,
      updatedAt: now
    });
  }

  for (const s of shorts) {
    clips.push({
      id: s.id,
      setId: s.episodeId,
      comedianId: s.showId,
      title: s.title,
      hook: s.hook,
      caption: s.caption,
      platformFormat: s.platformFormat,
      sourceBitId: s.sourceSceneId,
      imageUrl: s.imageUrl,
      videoUrl: s.videoUrl,
      thumbnailUrl: s.thumbnailUrl,
      status: s.status || 'draft',
      analytics: s.analytics,
      createdAt: s.createdAt || now
    });
  }

  for (const a of ads) {
    promos.push({
      id: a.id,
      setId: a.episodeId,
      comedianId: a.showId,
      type: 'social_post',
      title: a.title,
      copy: a.copy,
      visualPrompt: a.visualPrompt,
      imageUrl: a.imageUrl,
      videoUrl: a.videoUrl,
      durationSec: a.durationSec || 15,
      createdAt: a.createdAt || now
    });
  }

  for (const inf of influencers) {
    scouts.push({
      id: inf.id,
      comedianId: inf.showId,
      name: inf.name,
      platform: inf.platform,
      handleOrEmail: inf.handleOrEmail || '',
      niche: inf.niche,
      relevanceScore: inf.relevanceScore || 50,
      outreachStatus: inf.outreachStatus || 'drafted',
      suggestedAngle: inf.suggestedAngle || '',
      draftMessage: inf.draftMessage,
      createdAt: inf.createdAt || now,
      updatedAt: inf.updatedAt || now
    });
  }

  // Write everything in one transaction.
  const wt = db.transaction([STORE_COMEDIANS, STORE_SETS, STORE_CLIPS, STORE_PROMOS, STORE_SCOUTS], 'readwrite');
  comedians.forEach(c => wt.objectStore(STORE_COMEDIANS).put(c));
  sets.forEach(s => wt.objectStore(STORE_SETS).put(s));
  clips.forEach(c => wt.objectStore(STORE_CLIPS).put(c));
  promos.forEach(p => wt.objectStore(STORE_PROMOS).put(p));
  scouts.forEach(s => wt.objectStore(STORE_SCOUTS).put(s));
  await new Promise<void>((resolve, reject) => {
    wt.oncomplete = () => resolve();
    wt.onerror = () => reject(wt.error);
    wt.onabort = () => reject(wt.error);
  });
}

// Run the migration once after openDB. Idempotent.
let migrationPromise: Promise<void> | null = null;
export function ensureMigrations(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = openDB().then(db => migrateLegacy(db)).catch(err => {
      console.error('Legacy -> comedian migration failed', err);
    });
  }
  return migrationPromise;
}

// ----- Implementation -----

export class IndexedDBRepository implements Repository {
  // Comedians -----------------------------------------------------------
  getComedian(id: string) {
    return tx(STORE_COMEDIANS, 'readonly', async t => {
      const c = await reqAsPromise<Comedian | undefined>(t.objectStore(STORE_COMEDIANS).get(id));
      return c ? normalizeComedian(c) : undefined;
    });
  }
  listComedians() {
    return tx(STORE_COMEDIANS, 'readonly', async t => {
      const all = await reqAsPromise<Comedian[]>(t.objectStore(STORE_COMEDIANS).getAll());
      return all.map(normalizeComedian).sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }
  saveComedian(c: Comedian) {
    c.updatedAt = Date.now();
    return tx(STORE_COMEDIANS, 'readwrite', t => { t.objectStore(STORE_COMEDIANS).put(c); });
  }
  deleteComedian(id: string) {
    return tx(
      [STORE_COMEDIANS, STORE_SETS, STORE_CLIPS, STORE_PROMOS, STORE_SCOUTS, STORE_JOBS, STORE_OUTBOX],
      'readwrite',
      async t => {
        t.objectStore(STORE_COMEDIANS).delete(id);
        await deleteByIndex(t, STORE_SETS, 'comedianId', id);
        await deleteByIndex(t, STORE_CLIPS, 'comedianId', id);
        await deleteByIndex(t, STORE_PROMOS, 'comedianId', id);
        await deleteByIndex(t, STORE_SCOUTS, 'comedianId', id);
        await deleteByIndex(t, STORE_JOBS, 'comedianId', id);
        await deleteByIndex(t, STORE_OUTBOX, 'comedianId', id);
      }
    );
  }

  // Sets ----------------------------------------------------------------
  getSet(id: string) {
    return tx(STORE_SETS, 'readonly', t =>
      reqAsPromise<Set | undefined>(t.objectStore(STORE_SETS).get(id))
    );
  }
  listSets(comedianId: string) {
    return tx(STORE_SETS, 'readonly', async t => {
      const all = await reqAsPromise<Set[]>(
        t.objectStore(STORE_SETS).index('comedianId').getAll(comedianId)
      );
      return all.sort((a, b) => b.createdAt - a.createdAt);
    });
  }
  saveSet(s: Set) {
    s.updatedAt = Date.now();
    return tx(STORE_SETS, 'readwrite', t => { t.objectStore(STORE_SETS).put(s); });
  }
  deleteSet(id: string) {
    return tx(STORE_SETS, 'readwrite', t => { t.objectStore(STORE_SETS).delete(id); });
  }

  // Clips ---------------------------------------------------------------
  getClip(id: string) {
    return tx(STORE_CLIPS, 'readonly', t =>
      reqAsPromise<Clip | undefined>(t.objectStore(STORE_CLIPS).get(id))
    );
  }
  listClips(comedianId: string) {
    return tx(STORE_CLIPS, 'readonly', async t => {
      const all = await reqAsPromise<Clip[]>(
        t.objectStore(STORE_CLIPS).index('comedianId').getAll(comedianId)
      );
      return all.sort((a, b) => b.createdAt - a.createdAt);
    });
  }
  saveClip(c: Clip) {
    return tx(STORE_CLIPS, 'readwrite', t => { t.objectStore(STORE_CLIPS).put(c); });
  }
  deleteClip(id: string) {
    return tx(STORE_CLIPS, 'readwrite', t => { t.objectStore(STORE_CLIPS).delete(id); });
  }

  // Promos --------------------------------------------------------------
  listPromos(comedianId: string) {
    return tx(STORE_PROMOS, 'readonly', async t => {
      const all = await reqAsPromise<Promo[]>(
        t.objectStore(STORE_PROMOS).index('comedianId').getAll(comedianId)
      );
      return all.sort((a, b) => b.createdAt - a.createdAt);
    });
  }
  savePromo(p: Promo) {
    return tx(STORE_PROMOS, 'readwrite', t => { t.objectStore(STORE_PROMOS).put(p); });
  }
  deletePromo(id: string) {
    return tx(STORE_PROMOS, 'readwrite', t => { t.objectStore(STORE_PROMOS).delete(id); });
  }

  // Scouts --------------------------------------------------------------
  listScouts(comedianId: string) {
    return tx(STORE_SCOUTS, 'readonly', async t => {
      const all = await reqAsPromise<ScoutTarget[]>(
        t.objectStore(STORE_SCOUTS).index('comedianId').getAll(comedianId)
      );
      return all.sort((a, b) => b.relevanceScore - a.relevanceScore);
    });
  }
  saveScout(t: ScoutTarget) {
    t.updatedAt = Date.now();
    return tx(STORE_SCOUTS, 'readwrite', txn => { txn.objectStore(STORE_SCOUTS).put(t); });
  }
  deleteScout(id: string) {
    return tx(STORE_SCOUTS, 'readwrite', t => { t.objectStore(STORE_SCOUTS).delete(id); });
  }

  // Jobs ----------------------------------------------------------------
  listJobs(comedianId?: string) {
    return tx(STORE_JOBS, 'readonly', async t => {
      const store = t.objectStore(STORE_JOBS);
      const all = await reqAsPromise<AutopilotJob[]>(
        comedianId ? store.index('comedianId').getAll(comedianId) : store.getAll()
      );
      return all.sort((a, b) => b.createdAt - a.createdAt);
    });
  }
  saveJob(j: AutopilotJob) {
    return tx(STORE_JOBS, 'readwrite', async t => {
      const store = t.objectStore(STORE_JOBS);
      store.put(j);
      // Cap the job log so a long-running autopilot doesn't bloat the DB
      // (every status emit re-reads this store).
      const all = await reqAsPromise<AutopilotJob[]>(store.getAll());
      if (all.length > 200) {
        all.sort((a, b) => b.createdAt - a.createdAt);
        for (const old of all.slice(200)) store.delete(old.id);
      }
    });
  }
  deleteJob(id: string) {
    return tx(STORE_JOBS, 'readwrite', t => { t.objectStore(STORE_JOBS).delete(id); });
  }

  // Outbox --------------------------------------------------------------
  listOutbox(comedianId?: string) {
    return tx(STORE_OUTBOX, 'readonly', async t => {
      const store = t.objectStore(STORE_OUTBOX);
      const all = await reqAsPromise<OutboxItem[]>(
        comedianId ? store.index('comedianId').getAll(comedianId) : store.getAll()
      );
      return all.sort((a, b) => b.submittedAt - a.submittedAt);
    });
  }
  saveOutboxItem(o: OutboxItem) {
    return tx(STORE_OUTBOX, 'readwrite', t => { t.objectStore(STORE_OUTBOX).put(o); });
  }
  deleteOutboxItem(id: string) {
    return tx(STORE_OUTBOX, 'readwrite', t => { t.objectStore(STORE_OUTBOX).delete(id); });
  }

  // Settings ------------------------------------------------------------
  getSettings() {
    return tx(STORE_SETTINGS, 'readonly', async t => {
      const result = await reqAsPromise<any>(t.objectStore(STORE_SETTINGS).get('current'));
      // Older builds stored provider keys here; only known fields survive.
      const merged: any = { ...DEFAULT_SETTINGS, ...(result || {}) };
      const clean = {} as AISettings;
      for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AISettings)[]) (clean as any)[k] = merged[k];
      return clean;
    });
  }
  saveSettings(s: AISettings) {
    return tx(STORE_SETTINGS, 'readwrite', t => { t.objectStore(STORE_SETTINGS).put(s, 'current'); });
  }
}

async function deleteByIndex(
  t: IDBTransaction,
  storeName: string,
  indexName: string,
  key: string
): Promise<void> {
  const store = t.objectStore(storeName);
  const idx = store.index(indexName);
  const keys = await reqAsPromise<IDBValidKey[]>(idx.getAllKeys(key));
  for (const k of keys) store.delete(k as IDBValidKey);
}

// Singleton accessor.
let _repo: Repository | null = null;
/** The Station swaps in a file-backed repository; the browser keeps IndexedDB. */
export function setRepository(repo: Repository) { _repo = repo; }
export function getRepository(): Repository {
  if (!_repo) _repo = new IndexedDBRepository();
  return _repo;
}

// Convenience: the most recent set for a comedian (or undefined).
export async function getLatestSet(comedianId: string): Promise<Set | undefined> {
  const sets = await getRepository().listSets(comedianId);
  return sets[0];
}
