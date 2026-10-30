import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AISettings, Bit, Comedian, Material, MaterialType, Set as ComedySet } from './types';
import {
  ensureMigrations, getRepository, normalizeComedian, getLatestSet,
  DEFAULT_AUTOPILOT_CONFIG, DEFAULT_PUBLISHING_SETTINGS, DEFAULT_SETTINGS, emptyProfile
} from './services/repository';
import { startAutopilot, stopAutopilot, resumeAutopilot, isAutopilotRunning, onStatus, setSettings as setAutopilotSettings } from './services/autopilot';
import { startEnginePolling, getEngines, launchEngine } from './services/engines';
import {
  castComedian, writeBit, riff, judgeBit, voiceBit, walkOnMusic, animateBit, renderStill,
  stillPrompt, headshotPrompt, comedianSeed, describeError
} from './services/studio';
import { runWriter } from './services/agents/writer';
import { exportSpecialHtml, exportSpecialJson, exportRosterBackup } from './utils/exportUtils';
import TopBar, { View } from './components/TopBar';
import Studio from './components/Studio';
import Home from './components/Home';
import CastingView, { CastPhase } from './components/CastingView';
import SpecialPlayer, { PlayerActions } from './components/SpecialPlayer';
import Roster from './components/Roster';
import NightShiftView from './components/NightShiftView';
import CircuitView from './components/CircuitView';
import TuneIn from './components/TuneIn';
import OriginalsView from './components/OriginalsView';
import { startOriginals } from './services/premium/production';
import { resumeIfLive, enterCircuit, ensureCircuit, setLive } from './services/league/engine';
import { useCircuit } from './services/league/store';
import EnginesSheet from './components/EnginesSheet';
import RenderDock from './components/RenderDock';
import { Toasts, notify, notifyError } from './components/ui';
import { useCapabilities } from './components/useCapabilities';

const uid = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
const MATERIAL_TYPES: MaterialType[] = ['PERSONA', 'PROP', 'VENUE', 'THEME', 'BIT', 'CATCHPHRASE'];

function sanitizeBits(bits: Bit[]): Bit[] {
  const seen = new Set<number>();
  return (bits || []).map((b, i) => {
    let id = Number(b.id);
    if (!Number.isFinite(id) || seen.has(id)) id = Date.now() + i + Math.floor(Math.random() * 1000);
    seen.add(id);
    return { ...b, id };
  });
}

const repo = () => getRepository();
const PLACE_KEY = 'standupify_place';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [settings, setSettingsState] = useState<AISettings>(DEFAULT_SETTINGS);
  const [roster, setRoster] = useState<Comedian[]>([]);
  const [comedian, setComedian] = useState<Comedian | null>(null);
  const [set, setSet] = useState<ComedySet | null>(null);
  const [enginesOpen, setEnginesOpen] = useState(false);
  const [tvOpen, setTvOpen] = useState(false);
  const [tvPreview, setTvPreview] = useState(false);
  const [tvInitialKey, setTvInitialKey] = useState<string | undefined>();
  const [clubBusy, setClubBusy] = useState(false);
  const clubLock = useRef(false);
  const [bootReady, setBootReady] = useState(false);
  const [savedPlace] = useState<{ view?: View; comedianId?: string }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PLACE_KEY) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch { return {}; }
  });
  const navigationUsed = useRef(false);
  const [castPhase, setCastPhase] = useState<CastPhase>('writing');
  const [writing, setWriting] = useState('');
  const [castError, setCastError] = useState<string | null>(null);
  const [riffing, setRiffing] = useState(false);
  const [autopilotOn, setAutopilotOn] = useState(isAutopilotRunning());
  const caps = useCapabilities(settings);
  const circuit = useCircuit();

  // Async work outlives renders: always read the latest through refs.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeSetId = useRef<string | null>(null);
  const activeComedianId = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastCast = useRef<{ vibe: string; photo?: string }>({ vibe: '' });

  const refreshRoster = useCallback(async () => setRoster(await repo().listComedians()), []);

  // ------------------------------------------------------------------
  // boot
  // ------------------------------------------------------------------
  useEffect(() => {
    startEnginePolling();
    let alive = true;
    const saved = savedPlace;
    (async () => {
      await ensureMigrations();
      const [s] = await Promise.all([repo().getSettings(), refreshRoster()]);
      if (!alive) return;
      setSettingsState(s);
      setAutopilotSettings(s);
      settingsRef.current = s;
      await ensureCircuit();
      await refreshRoster();
      await resumeAutopilot(s);
      // A Circuit that was live before the refresh carries on.
      resumeIfLive(() => settingsRef.current);
      // Originals in production carry on (in the Station when there is one).
      startOriginals(() => settingsRef.current);
      // A refresh puts you back where you were.
      if (!alive || navigationUsed.current) return;
      if ((saved.view === 'special' || saved.view === 'casting') && saved.comedianId) {
        const c = await repo().getComedian(saved.comedianId);
        if (c && alive && !navigationUsed.current) await openComedian(c, () => alive && !navigationUsed.current);
      } else if (saved.view === 'home' || saved.view === 'studio' || saved.view === 'roster' || saved.view === 'nightshift' || saved.view === 'circuit' || saved.view === 'originals') setView(saved.view);
    })().catch(e => { if (alive) notifyError(e); }).finally(() => { if (alive) setBootReady(true); });
    const unsub = onStatus(st => setAutopilotOn(st.running));
    const rosterTimer = setInterval(() => { if (document.visibilityState === 'visible') void refreshRoster().catch(() => undefined); }, 30_000);
    return () => { alive = false; unsub(); clearInterval(rosterTimer); };
  }, [refreshRoster]);

  useEffect(() => {
    if (!bootReady) return;
    try { sessionStorage.setItem(PLACE_KEY, JSON.stringify({ view, comedianId: comedian?.id })); } catch { /* ignore */ }
  }, [view, comedian?.id, bootReady]);

  const updateSettings = useCallback((s: AISettings) => {
    settingsRef.current = s;
    setSettingsState(s);
    setAutopilotSettings(s);
    void repo().saveSettings(s).catch(e => notifyError(e));
  }, []);

  // ------------------------------------------------------------------
  // serialized writes — parallel renders never clobber each other
  // ------------------------------------------------------------------
  const queues = useRef(new Map<string, Promise<unknown>>());
  const serial = <T,>(key: string, work: () => Promise<T>): Promise<T> => {
    const prev = queues.current.get(key) || Promise.resolve();
    const next = prev.catch(() => undefined).then(work);
    queues.current.set(key, next);
    return next;
  };

  const mutateSet = useCallback((setId: string, fn: (s: ComedySet) => void) => serial(`set:${setId}`, async () => {
    const s = await repo().getSet(setId);
    if (!s) return;
    fn(s);
    s.updatedAt = Date.now();
    await repo().saveSet(s);
    if (activeSetId.current === setId) setSet({ ...s, bits: [...s.bits] });
    return s;
  }), []);

  const mutateComedian = useCallback((id: string, fn: (c: Comedian) => void) => serial(`comedian:${id}`, async () => {
    const c = await repo().getComedian(id);
    if (!c) return;
    fn(c);
    c.updatedAt = Date.now();
    await repo().saveComedian(c);
    if (activeComedianId.current === id) setComedian({ ...c });
    setRoster(r => r.map(x => x.id === id ? c : x));
    return c;
  }), []);

  const patchBit = (setId: string, bitId: number, patch: Partial<Bit>) =>
    mutateSet(setId, s => { s.bits = s.bits.map(b => b.id === bitId ? { ...b, ...patch } : b); });

  // ------------------------------------------------------------------
  // the production steps
  // ------------------------------------------------------------------
  const shootBit = async (c: Comedian, setId: string, bit: Bit, force = false) => {
    const url = await renderStill(stillPrompt(c, bit.visualPrompt, c.venue), settingsRef.current, {
      label: `Shooting · ${bit.title}`, itemKey: `bit:${bit.id}`, seed: comedianSeed(c) + (force ? Math.floor(Math.random() * 1e6) : 0),
      ref: { comedianId: c.id, bitId: bit.id }, force
    });
    await patchBit(setId, bit.id, { imageUrl: url, videoUrl: undefined, videoStatus: 'idle' });
  };

  const shootHeadshot = async (c: Comedian) => {
    const url = await renderStill(headshotPrompt(c, c.venue), settingsRef.current, {
      label: `Headshot · ${c.name}`, itemKey: `headshot:${c.id}`, seed: comedianSeed(c), portrait: true, ref: { comedianId: c.id }
    });
    await mutateComedian(c.id, x => { x.headshotUrl = url; });
  };

  const gradeBit = async (c: Comedian, setId: string, bit: Bit) => {
    const j = await judgeBit(c, bit, settingsRef.current);
    await patchBit(setId, bit.id, { laughScore: j.score, laughNote: j.note });
  };

  const recordBit = async (c: Comedian, setId: string, bit: Bit, force = false) => {
    const url = await voiceBit(c, bit, force);
    await patchBit(setId, bit.id, { audioUrl: url });
  };

  const animate = async (c: Comedian, setId: string, bit: Bit, moveId: string) => {
    await patchBit(setId, bit.id, { videoStatus: 'processing', videoError: undefined });
    try {
      const url = await animateBit(c, bit, moveId, settingsRef.current);
      await patchBit(setId, bit.id, { videoUrl: url, videoStatus: 'completed', cameraMove: moveId });
    } catch (e) {
      await patchBit(setId, bit.id, { videoStatus: 'failed', videoError: describeError(e) });
      throw e;
    }
  };

  /** Grade + voice in the background; never blocks the show. */
  const finishBit = (c: Comedian, setId: string, bit: Bit) => {
    const s = settingsRef.current;
    if (s.autoJudge) gradeBit(c, setId, bit).catch(() => { /* optional */ });
    if (s.autoVoice && caps.voice) recordBit(c, setId, bit).catch(() => { /* optional */ });
  };

  // ------------------------------------------------------------------
  // casting
  // ------------------------------------------------------------------
  const handleCast = async (input: { vibe: string; photo?: string }) => {
    lastCast.current = input;
    setRiffing(false);
    setView('casting');
    setCastPhase('writing');
    setWriting('');
    setCastError(null);
    setComedian(null);
    setSet(null);
    activeSetId.current = null;
    activeComedianId.current = null;

    const s = settingsRef.current;
    let c: Comedian;
    let debut: ComedySet;
    try {
      const draft = await castComedian(input, s, setWriting);
      const now = Date.now();
      const material: Material[] = (draft.material || []).map((m, i) => ({
        id: `mat_${now}_${i}`,
        name: m.name || `Material ${i + 1}`,
        type: (MATERIAL_TYPES.includes(m.type as MaterialType) ? m.type : 'BIT') as MaterialType,
        description: m.description || ''
      }));
      c = {
        id: uid('comedian'),
        name: draft.name,
        tagline: draft.tagline || '',
        voice: draft.voice || 'observational',
        style: draft.style || 'observational',
        audience: draft.audience || 'everyone',
        look: draft.look,
        venue: s.venue,
        status: 'active',
        publishVisibility: 'outbox',
        profile: { ...emptyProfile(), material },
        publishingSettings: { ...DEFAULT_PUBLISHING_SETTINGS },
        autopilotConfig: { ...DEFAULT_AUTOPILOT_CONFIG },
        avatarImage: input.photo,
        headshotUrl: input.photo,
        createdAt: now,
        updatedAt: now
      };
      debut = {
        id: uid('set'),
        comedianId: c.id,
        title: draft.setTitle || 'Debut Special',
        logline: draft.setLogline || c.tagline,
        status: 'rendering',
        bits: draft.bits.map((b, i) => ({ id: now + i, title: b.title, description: b.description, visualPrompt: b.action })),
        clipIds: [], promoIds: [], publishedUrls: [], analytics: {},
        generatedBy: 'debut',
        createdAt: now, updatedAt: now
      };
      await repo().saveComedian(c);
      await repo().saveSet(debut);
      activeComedianId.current = c.id;
      activeSetId.current = debut.id;
      setComedian(c);
      setSet(debut);
      void refreshRoster();
    } catch (e) {
      setCastError(describeError(e));
      setCastPhase('failed');
      return;
    }

    setCastPhase('shooting');
    // Stills first (the special is waiting on them), then voices and grades.
    const shots: Promise<unknown>[] = [];
    if (caps.stills) {
      if (!input.photo) shots.push(shootHeadshot(c).catch(e => console.warn('headshot', e)));
      for (const b of debut.bits) shots.push(shootBit(c, debut.id, b).catch(e => { console.warn('still', e); return e; }));
    } else {
      notify('Nothing can shoot stills yet. The special plays on the stage illustration for now.', { tone: 'info', action: { label: 'Engines', run: () => setEnginesOpen(true) } });
    }
    debut.bits.forEach(b => finishBit(c, debut.id, b));
    const failed = (await Promise.all(shots)).find(r => r instanceof Error);
    if (failed) notifyError(failed);
    await mutateSet(debut.id, x => { x.status = 'ready'; });
    setCastPhase('done');
    setTimeout(() => { if (viewRef.current === 'casting' && activeSetId.current === debut.id) setView('special'); }, 1400);
  };

  // ------------------------------------------------------------------
  // opening an existing comedian
  // ------------------------------------------------------------------
  const openComedian = async (c: Comedian, shouldOpen: () => boolean = () => true) => {
    setRiffing(false);
    try {
      let s = await getLatestSet(c.id);
      if (!shouldOpen()) return;
      if (!s) {
        notify(`Writing a fresh set for ${c.name}…`);
        s = (await runWriter(settingsRef.current, c, 'manual')).set;
      }
      if (!shouldOpen()) return;
      activeComedianId.current = c.id;
      activeSetId.current = s.id;
      setComedian(c);
      setSet({ ...s, bits: sanitizeBits(s.bits) });
      setView('special');
    } catch (e) { notifyError(e); }
  };

  /** Open a comedian at a specific set (their Circuit set, from the league). */
  const openComedianSet = async (comedianId: string, setId?: string | null) => {
    const c = await repo().getComedian(comedianId);
    if (!c) return;
    const s = setId ? await repo().getSet(setId) : undefined;
    if (!s) return openComedian(c);
    setRiffing(false);
    activeComedianId.current = c.id;
    activeSetId.current = s.id;
    setComedian(c);
    setSet({ ...s, bits: sanitizeBits(s.bits) });
    setView('special');
    window.scrollTo({ top: 0 });
  };

  // ------------------------------------------------------------------
  // player actions
  // ------------------------------------------------------------------
  const withBit = (bitId: number, fn: (c: Comedian, s: ComedySet, b: Bit) => Promise<unknown>) => {
    if (!comedian || !set) return;
    const b = set.bits.find(x => x.id === bitId);
    if (b) fn(comedian, set, b).catch(e => notifyError(e, { label: 'Engines', run: () => setEnginesOpen(true) }));
  };

  const addBit = async (instruction: string) => {
    if (!comedian || !set) return;
    const c = comedian, setId = set.id;
    try {
      const out = await writeBit(c, set, instruction, settingsRef.current);
      const bit: Bit = { id: Date.now(), title: out.title, description: out.description, visualPrompt: out.action };
      await mutateSet(setId, s => { s.bits = [...s.bits, bit]; });
      finishBit(c, setId, bit);
      if (caps.stills) shootBit(c, setId, bit).catch(e => notifyError(e));
    } catch (e) { notifyError(e); throw e; }
  };

  const actions: PlayerActions = {
    animate: (bitId, moveId) => withBit(bitId, (c, s, b) => animate(c, s.id, b, moveId)),
    voice: (bitId, force) => withBit(bitId, (c, s, b) => recordBit(c, s.id, b, force)),
    reshoot: (bitId) => withBit(bitId, (c, s, b) => shootBit(c, s.id, b, !!b.imageUrl)),
    judge: (bitId) => withBit(bitId, (c, s, b) => gradeBit(c, s.id, b)),
    cut: (bitId) => {
      if (!set || !window.confirm('Cut this bit from the set?')) return;
      void mutateSet(set.id, s => { s.bits = s.bits.filter(b => b.id !== bitId); });
    },
    move: (bitId, dir) => {
      if (!set) return;
      void mutateSet(set.id, s => {
        const i = s.bits.findIndex(b => b.id === bitId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.bits.length) return;
        [s.bits[i], s.bits[j]] = [s.bits[j], s.bits[i]];
      });
    },
    addBit,
    riff: async () => {
      if (!comedian || !set) return '';
      try { return await riff(comedian, set, settingsRef.current); } catch (e) { notifyError(e); return ''; }
    },
    walkOn: () => {
      if (!comedian) return;
      const c = comedian;
      walkOnMusic(c).then(url => mutateComedian(c.id, x => { x.walkOnUrl = url; })).then(() => notify('Walk-on music is in. Press Play special.', { tone: 'ok' })).catch(e => notifyError(e));
    },
    animateAll: () => {
      if (!comedian || !set) return;
      const todo = set.bits.filter(b => !b.videoUrl && b.imageUrl && b.videoStatus !== 'processing');
      if (!todo.length) { notify('Every bit with a still already has a clip.'); return; }
      notify(`Queued ${todo.length} clip${todo.length === 1 ? '' : 's'} in ComfyUI.`);
      for (const b of todo) animate(comedian, set.id, b, b.cameraMove || settingsRef.current.cameraMove).catch(e => notifyError(e));
    },
    exportSpecial: (kind) => {
      if (!comedian || !set) return;
      if (kind === 'html') exportSpecialHtml(comedian, set); else exportSpecialJson(comedian, set);
    }
  };

  // Riff loop: keep writing bits until switched off.
  useEffect(() => {
    if (!riffing || view !== 'special' || !comedian || !set) return;
    let alive = true;
    (async () => {
      while (alive) {
        try {
          const cur = await repo().getSet(set.id);
          if (!cur || !alive) break;
          const idea = await riff(comedian, cur, settingsRef.current);
          if (!alive) break;
          await addBit(idea);
          await new Promise(r => setTimeout(r, 3000));
        } catch {
          setRiffing(false);
          break;
        }
      }
    })();
    return () => { alive = false; };
  }, [riffing, view, comedian?.id, set?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // roster + night shift
  // ------------------------------------------------------------------
  const toggleShift = async (c: Comedian, on: boolean) => {
    try { await mutateComedian(c.id, x => { x.autopilotConfig = { ...x.autopilotConfig, enabled: on }; x.status = 'active'; }); }
    catch (e) { notifyError(e); }
  };

  const toggleAutopilot = async () => {
    try {
      if (isAutopilotRunning()) await stopAutopilot();
      else { setAutopilotSettings(settingsRef.current); await startAutopilot(settingsRef.current, 30_000); }
    } catch (e) { notifyError(e); }
  };

  const watch = (key?: string) => { setTvPreview(false); setTvInitialKey(key); setTvOpen(true); };
  const preview = (key?: string) => { setTvPreview(true); setTvInitialKey(key); setTvOpen(true); };
  const toggleClub = async (on: boolean) => {
    if (clubLock.current) return;
    clubLock.current = true;
    setClubBusy(true);
    try {
      await setLive(on, () => settingsRef.current);
      if (on) {
        const eng = getEngines();
        for (const id of ['nightshift', 'comfy'] as const) {
          if (eng[id].state === 'offline' && eng[id].canLaunch && !eng.launching[id]) {
            const result = await launchEngine(id);
            if (!result.ok) notify(result.message, { tone: 'error', action: { label: 'Engines', run: () => setEnginesOpen(true) } });
          }
        }
        if (eng.nightshift.state !== 'online' && !eng.nightshift.canLaunch && eng.nightshift.state !== 'starting') {
          notify('Your club will start as soon as a local writer connects. The sample show is ready now.', { action: { label: 'Connect writer', run: () => setEnginesOpen(true) } });
        }
      }
    } catch (e) { notifyError(e); }
    finally { clubLock.current = false; setClubBusy(false); }
  };

  const deleteComedian = async (c: Comedian) => {
    if (!window.confirm(`Delete ${c.name} and everything they've made?`)) return;
    await repo().deleteComedian(c.id);
    await refreshRoster();
  };

  const importBackup = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      let comedians: Comedian[] = [];
      const sets: ComedySet[] = [...(json.sets || [])];
      if (Array.isArray(json)) comedians = json;
      else if (Array.isArray(json.comedians)) comedians = json.comedians;
      else if (json.comedian?.id) { comedians = [json.comedian]; if (json.set?.id) sets.push(json.set); }
      else if (json.id && json.name) comedians = [json];
      if (!comedians.length) throw new Error('No comedians found in that file.');
      for (const c of comedians) await repo().saveComedian(normalizeComedian(c));
      for (const s of sets) await repo().saveSet({ ...s, bits: sanitizeBits(s.bits || []) });
      for (const c of (json.clips || [])) await repo().saveClip(c);
      for (const p of (json.promos || [])) await repo().savePromo(p);
      await refreshRoster();
      notify(`Imported ${comedians.length} comedian${comedians.length === 1 ? '' : 's'}.`, { tone: 'ok' });
    } catch (e) { notifyError(e); }
  };

  const navigate = (v: View) => {
    navigationUsed.current = true;
    setRiffing(false);
    if (v === 'studio' && (view === 'special' || view === 'casting')) setView('studio');
    else setView(v);
    if (v === 'home' || v === 'roster' || v === 'studio' || v === 'originals') void refreshRoster().catch(e => notifyError(e));
    window.scrollTo({ top: 0 });
  };

  const sampleImage = roster.find(c => c.headshotUrl)?.headshotUrl;

  return (
    <div className="room">
      <TopBar view={view} onNavigate={navigate} onOpenEngines={() => setEnginesOpen(true)} nightShiftOn={autopilotOn} circuitLive={!!circuit.state?.live} onTuneIn={() => watch()} />

      <main key={view} className="animate-in fade-in duration-500">
        {view === 'home' && <Home roster={roster} onWatch={watch} onPreview={preview} onCreate={() => navigate('studio')} onCircuit={() => navigate('circuit')} onEngines={() => setEnginesOpen(true)} onToggleClub={toggleClub} clubBusy={clubBusy} />}
        {view === 'studio' && (
          <Studio settings={settings} onSettings={updateSettings} caps={caps} roster={roster}
            onCast={handleCast} onOpen={openComedian} onOpenEngines={() => setEnginesOpen(true)} onOpenCircuit={() => navigate('circuit')} onTuneIn={() => watch()} sampleImage={sampleImage} />
        )}
        {view === 'casting' && (
          <CastingView phase={castPhase} writing={writing} comedian={comedian} set={set} error={castError}
            onWatch={() => setView('special')} onRetry={() => handleCast(lastCast.current)} onBack={() => setView('studio')} />
        )}
        {view === 'special' && comedian && set && (
          <SpecialPlayer comedian={comedian} set={set} settings={settings} onSettings={updateSettings} caps={caps}
            actions={actions} onBack={() => setView('studio')} riffing={riffing} onToggleRiff={setRiffing} />
        )}
        {view === 'roster' && (
          <Roster comedians={roster} onOpen={openComedian} onDelete={deleteComedian} onToggleShift={toggleShift}
            onImport={importBackup} onExport={() => exportRosterBackup()} onNew={() => setView('studio')}
            onEnterCircuit={(c) => enterCircuit(c).then(() => notify(`${c.name} is on the Circuit. First stop: open mic.`, { tone: 'ok', action: { label: 'Watch', run: () => setView('circuit') } }))} />
        )}
        {view === 'circuit' && (
          <CircuitView getSettings={() => settingsRef.current} settings={settings} caps={caps} onOpen={openComedianSet} onTuneIn={() => watch()} />
        )}
        {view === 'originals' && (
          <OriginalsView roster={roster} settings={settings} onSettings={updateSettings} />
        )}
        {view === 'nightshift' && (
          <NightShiftView comedians={roster} running={autopilotOn} onToggle={toggleAutopilot} settings={settings}
            onToggleComedian={toggleShift}
            onUpdateComedian={(c) => { void mutateComedian(c.id, x => { x.autopilotConfig = { ...x.autopilotConfig, generateVideo: c.autopilotConfig.generateVideo }; }).catch(e => notifyError(e)); }} />
        )}
      </main>

      <EnginesSheet open={enginesOpen} onClose={() => setEnginesOpen(false)} settings={settings} onSettings={updateSettings} caps={caps} />
      <TuneIn open={tvOpen} onClose={() => setTvOpen(false)} getSettings={() => settingsRef.current} preview={tvPreview} initialKey={tvInitialKey} onOpenEngines={() => setEnginesOpen(true)} />
      <RenderDock />
      <Toasts />
    </div>
  );
}
