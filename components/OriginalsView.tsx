import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AISettings, Comedian, Set as ComedySet } from '../types';
import { getRepository } from '../services/repository';
import { useTasks } from '../services/tasks';
import { useEngines } from '../services/engines';
import { describeRig, greenlightOriginal, listOriginals, pauseOriginal } from '../services/premium/production';
import { STAGE_LABEL, STAGE_ORDER, type Budget, type OriginalCard } from '../services/premium/types';
import { Button, Icon, Progress, Segmented, StageArt, Toggle, notify, notifyError } from './ui';
import PremiumTheater from './PremiumTheater';

// =====================================================================
// Originals — the premium tier. A streaming-service front page for the
// specials the studio produces like a network would: a hero, what's
// streaming, and the production board for what is being made right now.
// =====================================================================

type Rig = Awaited<ReturnType<typeof describeRig>>;

function ago(t: number) {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

function Poster({ card, onPlay, big }: { card: OriginalCard; onPlay: () => void; big?: boolean }) {
  const p = card.palette || ['#ffb547', '#123844', '#07141a'];
  return (
    <button onClick={onPlay} className={`group relative text-left rounded-[18px] overflow-hidden border border-line bg-raised ${big ? 'aspect-[16/9]' : 'aspect-[16/10]'}`}>
      {card.keyArt ? <img src={card.keyArt} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700" /> : <StageArt className="absolute inset-0 w-full h-full" hue={p[1]} />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute left-4 right-4 bottom-4">
        <div className="font-mono text-[10px] tracking-[0.35em]" style={{ color: p[0] }}>STANDUPIFY ORIGINAL</div>
        <div className="font-display text-[26px] leading-[0.95] mt-1.5 line-clamp-2">{card.title}</div>
        <div className="text-[12px] text-white/70 mt-1.5">{card.comedianName} · {Math.round(card.minutes)} min{card.stage !== 'premiered' ? ' · rough cut' : ''}</div>
      </div>
      <span className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white text-black grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"><Icon name="play" size={16} /></span>
    </button>
  );
}

function Board({ card, onPlay, onPause }: { card: OriginalCard; onPlay: () => void; onPause: (v: boolean) => void }) {
  const tasks = useTasks();
  const live = tasks.find(t => t.status === 'running' && t.ref?.comedianId === card.comedianId && t.label.startsWith(card.title) && t.preview);
  const stageIx = STAGE_ORDER.indexOf(card.stage);
  const p = card.palette || ['#ffb547', '#123844', '#07141a'];
  const remaster = card.stage === 'premiered' && card.shots.done < card.shots.total;
  return (
    <div className="card p-4 md:p-5 grid md:grid-cols-[300px_minmax(0,1fr)] gap-5">
      <div className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-line">
        {live?.preview ? <img src={live.preview} alt="" className="absolute inset-0 w-full h-full object-cover" />
          : card.keyArt ? <img src={card.keyArt} alt="" className="absolute inset-0 w-full h-full object-cover" />
          : <StageArt className="absolute inset-0 w-full h-full" hue={p[1]} />}
        {live && <div className="absolute left-2 top-2 bg-live text-white text-[10px] font-mono tracking-widest px-2 py-0.5 rounded">ON SET</div>}
        {live && <div className="absolute inset-x-2 bottom-2"><div className="text-[10.5px] font-mono text-white/80 truncate mb-1">{live.label.replace(`${card.title} · `, '')}</div><Progress value={live.progress} /></div>}
      </div>
      <div className="min-w-0 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[28px] leading-none truncate">{card.title}</div>
            <div className="text-[13px] text-muted mt-1 truncate">{card.comedianName} · {card.source === 'circuit' ? 'greenlit by the Circuit' : 'greenlit in the studio'} · {ago(card.startedAt)}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {card.plates.done > 0 && <Button size="sm" icon="play" onClick={onPlay}>{card.stage === 'premiered' ? 'Watch' : 'Rough cut'}</Button>}
            {(card.stage !== 'premiered' || remaster) && <Button size="sm" variant="quiet" icon={card.paused ? 'play' : 'pause'} onClick={() => onPause(!card.paused)}>{card.paused ? 'Resume' : 'Pause'}</Button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_ORDER.slice(1).map((s, i) => {
            const k = i + 1;
            const done = k < stageIx || card.stage === 'premiered';
            const now = k === stageIx && card.stage !== 'premiered';
            return (
              <span key={s} className={`h-7 px-2.5 rounded-full text-[11.5px] flex items-center gap-1.5 border ${done ? 'border-ok/30 text-ok bg-ok/[0.06]' : now ? 'border-accent/40 text-accent bg-accent-soft' : 'border-line text-dim'}`}>
                {done ? <Icon name="check" size={12} /> : now ? <span className="w-1.5 h-1.5 rounded-full bg-accent breathe" /> : null}{STAGE_LABEL[s]}
              </span>
            );
          })}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
          <div><div className="text-muted mb-1">Camera plates</div><Progress value={card.plates.done / card.plates.total} /><div className="font-mono mt-1">{card.plates.done}/{card.plates.total}</div></div>
          <div><div className="text-muted mb-1">Coverage pass</div><Progress value={card.shots.pass1Total ? card.shots.pass1 / card.shots.pass1Total : 0} /><div className="font-mono mt-1">{card.shots.pass1}/{card.shots.pass1Total || '—'}</div></div>
          <div><div className="text-muted mb-1">{remaster ? 'Remaster' : 'Every shot'}</div><Progress value={card.shots.total ? card.shots.done / card.shots.total : 0} /><div className="font-mono mt-1">{card.shots.done}/{card.shots.total || '—'}{card.etaMinutes != null && card.shots.done < card.shots.total ? ` · ~${card.etaMinutes >= 90 ? `${Math.round(card.etaMinutes / 60)}h` : `${card.etaMinutes}m`} left` : ''}</div></div>
          <div><div className="text-muted mb-1">Voice track</div><Progress value={card.chapters ? card.voiced / card.chapters : 0} /><div className="font-mono mt-1">{card.voiced}/{card.chapters || '—'} chapters</div></div>
        </div>

        {card.error && <div className="text-[12px] text-live flex gap-2"><Icon name="alert" size={14} className="mt-0.5 shrink-0" />{card.error}</div>}
        <ul className="text-[12px] text-muted flex flex-col gap-1 max-h-[96px] overflow-y-auto">
          {card.log.map((l, i) => <li key={i} className={i === 0 ? 'text-text' : ''}><span className="font-mono text-dim mr-2">{ago(l.at)}</span>{l.text}</li>)}
        </ul>
      </div>
    </div>
  );
}

export default function OriginalsView({ roster, settings, onSettings }: { roster: Comedian[]; settings: AISettings; onSettings: (s: AISettings) => void }) {
  const eng = useEngines();
  const [cards, setCards] = useState<OriginalCard[] | null>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const [watch, setWatch] = useState<{ comedian: Comedian; set: ComedySet } | null>(null);
  const [pick, setPick] = useState('');
  const [minutes, setMinutes] = useState('14');
  const [budget, setBudget] = useState<Budget>('full');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => { try { setCards(await listOriginals()); } catch { /* next tick */ } }, []);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => {
    let alive = true;
    const go = () => describeRig(settings).then(r => { if (alive) setRig(r); }).catch(() => { /* engines moving */ });
    go();
    const t = setInterval(go, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [settings, eng.comfy.state, eng.comfy.inventoryStamp, eng.nightshift.state]);

  // While a production is playing, new clips flow into the open theater.
  useEffect(() => {
    if (!watch) return;
    const t = setInterval(async () => {
      const fresh = await getRepository().getSet(watch.set.id).catch(() => undefined);
      if (fresh?.premium && fresh.updatedAt !== watch.set.updatedAt) setWatch(w => (w ? { ...w, set: fresh } : w));
    }, 12_000);
    return () => clearInterval(t);
  }, [watch]);

  const open = async (card: OriginalCard) => {
    const [set, comedian] = await Promise.all([getRepository().getSet(card.setId), getRepository().getComedian(card.comedianId)]);
    if (!set?.premium?.script || !comedian) { notify('The writers are still on it. The rough cut opens once the plates are shot.'); return; }
    setWatch({ comedian, set });
  };

  const greenlight = async () => {
    const id = pick || roster[0]?.id;
    if (!id) return;
    setBusy(true);
    try {
      await greenlightOriginal(id, { minutes: Number(minutes), budget });
      notify(`Greenlit. ${roster.find(c => c.id === id)?.name} is going into production.`, { tone: 'ok' });
      await refresh();
    } catch (e) { notifyError(e); } finally { setBusy(false); }
  };

  const streaming = (cards || []).filter(c => c.stage === 'premiered');
  const making = (cards || []).filter(c => c.stage !== 'premiered' || c.shots.done < c.shots.total);
  const hero = streaming[0] || making[0];
  const castable = useMemo(() => roster.filter(c => c.status !== 'archived'), [roster]);

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-6 pb-32 flex flex-col gap-8">
      {/* Hero */}
      {hero ? (
        <div className="relative rounded-[28px] overflow-hidden border border-line min-h-[340px] md:min-h-[460px] flex items-end">
          {hero.keyArt ? <img src={hero.keyArt} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <StageArt className="absolute inset-0 w-full h-full" hue={hero.palette?.[1] || '#3b2a7a'} />}
          <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/55 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          <div className="relative p-6 md:p-10 max-w-2xl">
            <div className="font-mono text-[11px] tracking-[0.45em]" style={{ color: hero.palette?.[0] || '#ffb547' }}>STANDUPIFY ORIGINAL</div>
            <h1 className="font-display text-[48px] md:text-[84px] leading-[0.9] mt-3">{hero.title}</h1>
            <p className="text-white/75 mt-3 text-[15px] md:text-[17px] max-w-xl">{hero.logline}</p>
            <div className="text-[13px] text-white/60 mt-2 font-mono">{hero.comedianName} · {Math.round(hero.minutes)} min · {hero.chapters} chapters · 8 cameras</div>
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <Button variant="primary" icon="play" onClick={() => open(hero)} disabled={!hero.plates.done}>{hero.stage === 'premiered' ? 'Play' : 'Watch the rough cut'}</Button>
              {hero.stage !== 'premiered' && <span className="text-[13px] text-white/70">{STAGE_LABEL[hero.stage]} · {hero.shots.pass1}/{hero.shots.pass1Total || '—'} coverage shots</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="relative rounded-[28px] overflow-hidden border border-line p-8 md:p-12">
          <StageArt className="absolute inset-0 w-full h-full opacity-40" hue="#3b2a7a" />
          <div className="relative max-w-2xl">
            <div className="kicker !text-accent">The premium tier</div>
            <h1 className="font-display text-[44px] md:text-[72px] leading-[0.92] mt-3">Standupify Originals</h1>
            <p className="text-white/75 mt-4 text-[16px]">Fully produced 12–16 minute specials, made like a streaming network makes them: a production bible, a real hour of material, one theater shot by eight locked cameras, a live multi-cam cut on every beat, the comic's own voice, a laughing house, titles and credits. Every frame derived from one master plate, so the comic, the suit and the stage never change from shot to shot.</p>
          </div>
        </div>
      )}

      {/* Greenlight + rig */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5">
        <div className="card p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2"><Icon name="film" className="text-accent" /><div className="font-medium">Greenlight an Original</div></div>
          <div className="flex flex-wrap gap-3 items-center">
            <select value={pick || castable[0]?.id || ''} onChange={e => setPick(e.target.value)} className="h-11 w-full rounded-xl bg-raised border border-line px-3 text-[14px] outline-none">
              {castable.length ? castable.map(c => <option key={c.id} value={c.id}>{c.name}: {c.tagline}</option>) : <option value="">Cast a comedian in the Studio first</option>}
            </select>
            <Segmented value={minutes} onChange={setMinutes} options={[{ value: '12', label: '12 min' }, { value: '14', label: '14 min' }, { value: '16', label: '16 min' }]} />
            <Segmented value={budget} onChange={(v) => setBudget(v as Budget)} options={[{ value: 'full', label: 'Every shot' }, { value: 'coverage', label: 'Coverage' }]} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="sparkle" onClick={greenlight} disabled={busy || !castable.length}>{busy ? 'Greenlighting…' : 'Greenlight'}</Button>
            <span className="text-[12.5px] text-muted">{budget === 'full' ? 'Every shot gets its own clip (an overnight shoot on one GPU). It premieres after the coverage pass and keeps remastering.' : 'One clip per camera per chapter: premieres in a couple of hours, shots share takes.'}</span>
          </div>
          <label className="flex items-center gap-3 text-[13px] text-muted border-t border-line pt-4">
            <Toggle on={settings.autoOriginals !== false} onChange={v => onSettings({ ...settings, autoOriginals: v })} label="The Circuit greenlights Originals" />
            The Circuit greenlights Originals for its legends, champions and titleholders on its own.
          </label>
        </div>
        <div className="card p-5 flex flex-col gap-3 text-[13px]">
          <div className="kicker">The rig</div>
          <div className="flex justify-between gap-3"><span className="text-muted">Plates</span><span className="text-right">{rig?.plates || '—'}{rig?.rung === 'kontext' ? ' · face-locked' : rig?.rung === 'reference' ? ' · your workflow' : ''}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted">Cameras</span><span className="text-right">{rig?.clips || '—'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted">Finishing</span><span className="text-right">{rig?.finishing.length ? rig.finishing.join(' · ') : 'none installed'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted">Voice</span><span className="text-right">{rig?.voice ? 'Nightshift narration' : 'system voice'}</span></div>
          {rig?.advice && <div className="text-[12px] text-accent flex gap-2 border-t border-line pt-3"><Icon name="sparkle" size={13} className="mt-0.5 shrink-0" />{rig.advice}</div>}
        </div>
      </div>

      {/* Production board */}
      {making.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="kicker">In production</div>
          {making.map(c => <Board key={c.setId} card={c} onPlay={() => open(c)} onPause={(v) => pauseOriginal(c.setId, v).then(refresh)} />)}
        </section>
      )}

      {/* Streaming */}
      {streaming.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="kicker">Now streaming</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {streaming.map(c => <Poster key={c.setId} card={c} onPlay={() => open(c)} />)}
          </div>
        </section>
      )}

      {watch && <PremiumTheater comedian={watch.comedian} set={watch.set} onClose={() => setWatch(null)} />}
    </div>
  );
}
