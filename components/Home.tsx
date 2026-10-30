import React, { useEffect, useMemo, useState } from 'react';
import type { Comedian, Set as ComedySet } from '../types';
import { getRepository } from '../services/repository';
import { useCircuit } from '../services/league/store';
import { comedianOf } from '../services/league/engine';
import { useEngines } from '../services/engines';
import { stationConnected } from '../services/station/client';
import { useTasks } from '../services/tasks';
import { buildCatalog, program } from '../services/tv/programming';
import { PREVIEW_SEGMENTS } from '../services/tv/preview';
import { venueById } from '../services/comfy/presets';
import { Button, Icon, Still, plainText } from './ui';

export default function Home({ roster, onWatch, onPreview, onCreate, onCircuit, onEngines, onToggleClub, clubBusy }: {
  roster: Comedian[];
  onWatch: (key?: string) => void;
  onPreview: (key?: string) => void;
  onCreate: () => void;
  onCircuit: () => void;
  onEngines: () => void;
  onToggleClub: (on: boolean) => void;
  clubBusy: boolean;
}) {
  const { state, shows, live } = useCircuit();
  const engines = useEngines();
  const tasks = useTasks();
  const [specials, setSpecials] = useState<{ comedian: Comedian; set: ComedySet }[]>([]);
  const [libraryError, setLibraryError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const repo = getRepository();
        const rows = await Promise.all(roster.map(async c => ({ c, sets: await repo.listSets(c.id) })));
        if (!alive) return;
        setSpecials(rows.flatMap(({ c, sets }) => sets.filter(s => s.title !== 'Live on the Circuit' && s.bits.length).map(set => ({ comedian: c, set }))));
        setLibraryError(false);
      } catch { if (alive) setLibraryError(true); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [roster, state?.night, reload]);

  const catalog = useMemo(() => buildCatalog(state, shows, specials, comedianOf), [state, shows, specials]);
  const picks = useMemo(() => program(catalog, 'best').slice(0, 4), [catalog]);
  const feature = picks[0] || PREVIEW_SEGMENTS[0];
  const ready = catalog.length > 0;
  const onAir = !!state?.live;
  const writing = engines.nightshift.state === 'online';
  const warming = engines.nightshift.state === 'starting' || !!engines.launching.nightshift;
  const working = !!state?.pending?.show && !state.pending.show.endedAt || ['booking', 'rehearsing', 'judging', 'crowd'].includes(live.phase);
  const currentTask = tasks.find(t => t.status === 'running');
  const active = Object.values(state?.stats || {}).filter(c => c.life === 'active').length;
  const exchanges = (state?.events || []).filter(e => e.actors.length > 1 && ['study', 'mind', 'rivalry', 'apprentice'].includes(e.kind)).slice(0, 3);
  const events = exchanges.length ? exchanges : (state?.events || []).filter(e => e.kind !== 'season').slice(0, 3);
  const statusTitle = onAir ? writing ? 'Your club is on air' : warming ? 'Warming up the writers’ room' : 'Ready when the writer connects' : working ? 'Finishing the current show' : 'Let the club take it from here';
  const statusDetail = onAir
    ? live.note || 'Booking shows, writing new material, and finding the next headliner.'
    : working ? 'The current show will finish and stay in your library. New shows are paused.'
    : 'The cast writes, competes, mentors, and makes new shows. You choose when to watch.';

  return (
    <div className="max-w-[1240px] mx-auto px-4 md:px-8 pt-9 md:pt-14 pb-28">
      <section className="grid lg:grid-cols-[1fr_1.04fr] gap-8 lg:gap-12 items-center">
        <div className="rise">
          <div className="kicker flex items-center gap-2"><span className="h-px w-7 bg-accent" /> Your own comedy channel</div>
          <h1 className="font-display text-[48px] sm:text-[66px] xl:text-[76px] leading-[1.02] mt-5">Great company.<br /><span className="text-accent">Zero homework.</span></h1>
          <p className="text-muted text-[16px] leading-relaxed mt-5 max-w-[420px]">A whole comedy scene, with a life of its own. Find your favorite comic. Watch a set. Let the next one come to you.</p>
          <div className="flex flex-wrap gap-3 mt-7">
            <Button variant="primary" size="lg" icon="play" onClick={() => ready ? onWatch() : onPreview()}>{ready ? 'Watch the best' : 'Play a preview'}</Button>
            <Button size="lg" variant="quiet" icon="plus" onClick={onCreate}>Create a comic</Button>
          </div>
          <p className="text-[12px] text-muted mt-3">{ready ? 'A continuous show, picked from your own library.' : 'A short sample show. No setup, GPU, or account needed.'}</p>
          <dl className="flex flex-wrap gap-x-8 gap-y-4 mt-9 pt-6 border-t border-line">
            {[[ready ? catalog.length : '—', 'sets & bits ready'], [state ? active : '—', 'comedians in the cast'], [state?.night ?? '—', 'nights on the circuit']].map(([value, label]) => (
              <div key={label}><dt className="text-[11px] text-muted mt-1 order-2">{label}</dt><dd className="font-display text-[27px] mt-1">{value}</dd></div>
            ))}
          </dl>
        </div>

        <button onClick={() => ready ? onWatch(feature.key) : onPreview()} className="group relative text-left rounded-[26px] overflow-hidden border border-line-strong bg-surface aspect-[4/3] sm:aspect-[1.35] lg:aspect-[1.08] shadow-[0_24px_80px_-28px_#000] rise [animation-delay:100ms]" aria-label={ready ? `Watch ${feature.title} by ${feature.name}` : 'Play the sample show'}>
          <Still src={feature.image || feature.headshot} alt="" className="!absolute inset-0 w-full h-full" hue={venueById(feature.venue).swatch[0]} imgClassName="group-hover:scale-[1.035] transition-transform duration-700" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-black/10" />
          <div className="absolute top-5 left-5 right-5 flex items-center justify-between gap-2">
            <span className="bg-black/45 backdrop-blur-md rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] border border-white/15">{ready ? 'Tonight’s pick' : 'Meet the cast · preview'}</span>
            {ready && feature.score != null && <span className="rounded-full px-3 py-1.5 text-[12px] font-mono bg-accent text-accent-ink">{feature.score.toFixed(1)} / 10</span>}
          </div>
          <span className="absolute inset-0 grid place-items-center"><span className="w-[68px] h-[68px] rounded-full border border-white/30 bg-white/10 backdrop-blur-sm grid place-items-center group-hover:bg-accent group-hover:text-accent-ink group-hover:border-accent transition-colors"><Icon name="play" size={25} /></span></span>
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
            <div className="text-[12px] text-accent mb-2">{feature.name}{feature.club ? ` · ${feature.club}` : ''}</div>
            <h2 className="font-display text-[32px] sm:text-[39px] leading-tight line-clamp-2">{feature.title}</h2>
            <p className="text-[13px] text-white/60 mt-2 line-clamp-1">{feature.tagline}</p>
          </div>
        </button>
      </section>

      <section className={`mt-9 rounded-[22px] border p-5 sm:p-6 ${onAir ? 'border-ok/25 bg-ok/[0.035]' : 'border-line bg-surface'}`} aria-label="Automatic club control">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className={`w-11 h-11 rounded-2xl grid place-items-center shrink-0 ${onAir ? 'text-ok bg-ok/10' : 'text-accent bg-accent-soft'}`}><Icon name={onAir ? 'wave' : 'moon'} size={21} /></div>
          <div className="min-w-0 flex-1" role="status">
            <div className="flex flex-wrap items-center gap-2.5"><h2 className="font-display text-[22px]">{statusTitle}</h2>{onAir && <span className="text-[9px] font-mono uppercase tracking-widest text-ok border border-ok/25 rounded-full px-2 py-0.5">{writing ? 'Automatic' : 'Waiting'}</span>}</div>
            <p className="text-[13px] text-muted mt-1 leading-relaxed">{statusDetail}</p>
          </div>
          <Button variant={onAir ? 'ghost' : 'primary'} icon={onAir ? 'pause' : 'power'} disabled={clubBusy || !state} onClick={() => onToggleClub(!onAir)}>{clubBusy ? 'One moment…' : onAir ? 'Pause new shows' : 'Open the club'}</Button>
        </div>
        <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><Icon name={stationConnected() ? 'check' : 'chip'} size={13} />{stationConnected() ? 'Keeps running while Standupify is open, even with this tab closed' : 'Keep this tab open for automatic shows'}</span>
          <button onClick={onEngines} className="inline-flex items-center gap-1.5 hover:text-text"><span className={`w-1.5 h-1.5 rounded-full ${writing ? 'bg-ok' : 'bg-accent'}`} />{writing ? 'Writer connected' : warming ? 'Writer starting…' : 'Connect your local writer'}<Icon name="arrow" size={12} /></button>
          <span>{engines.comfy.state === 'online' ? 'Camera connected' : 'Videos follow when a camera is connected'}</span>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.25fr_1fr] gap-8 mt-10">
        <section>
          <div className="flex items-center justify-between gap-3 mb-4"><div><div className="kicker">Press play, settle in</div><h2 className="font-display text-[28px] mt-1">{ready ? 'Your evening, sorted.' : 'A few familiar faces.'}</h2></div>{ready && <button onClick={() => onWatch()} className="text-[12px] text-muted hover:text-accent">Watch all →</button>}</div>
          <div className="space-y-2">
            {(ready ? picks : PREVIEW_SEGMENTS).map((s, i) => (
              <button key={s.key} onClick={() => ready ? onWatch(s.key) : onPreview(s.key)} className="group w-full flex items-center gap-3 text-left p-3 rounded-2xl border border-line bg-surface hover:border-line-strong transition-colors">
                <span className="text-[10px] font-mono text-dim w-4 shrink-0">0{i + 1}</span>
                <Still src={s.image || s.headshot} alt="" hue={venueById(s.venue).swatch[0]} className="w-16 h-14 rounded-lg shrink-0 overflow-hidden" />
                <div className="flex-1 min-w-0"><div className="text-[14px] font-semibold truncate group-hover:text-accent">{s.title}</div><div className="text-[12px] text-muted truncate mt-0.5">{s.name} · {ready ? s.clips.length ? 'Animated' : 'Ready to watch' : 'Sample set'}</div></div>
                <Icon name="play" size={14} className="text-muted mr-2 shrink-0" />
              </button>
            ))}
          </div>
          {libraryError && <p role="alert" className="text-[12px] text-accent mt-3">Saved specials couldn’t refresh. <button className="underline" onClick={() => setReload(n => n + 1)}>Try again</button></p>}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3 mb-4"><div><div className="kicker">Life between the laughs</div><h2 className="font-display text-[28px] mt-1">In the green room</h2></div><button onClick={onCircuit} className="text-[12px] text-muted hover:text-accent">Visit the circuit →</button></div>
          <div className="rounded-[20px] border border-line bg-surface overflow-hidden">
            {currentTask && <div className="p-4 border-b border-line text-[12px] flex items-center gap-2.5 text-accent"><span className="w-1.5 h-1.5 rounded-full bg-accent breathe shrink-0" /><span className="truncate">{currentTask.label}</span></div>}
            {events.length ? events.map(e => <div key={e.id} className="p-4 border-b border-line last:border-b-0"><div className="text-[10px] font-mono text-muted mb-1.5">NIGHT {e.night} · {e.kind === 'study' || e.kind === 'mind' ? 'BACKSTAGE' : e.kind.toUpperCase()}</div><p className="text-[13px] leading-relaxed text-text/85 line-clamp-3">{plainText(e.text)}</p></div>) : <div className="p-6"><div className="flex -space-x-2 mb-4">{roster.slice(0, 5).map(c => <span key={c.id} className="w-10 h-10 rounded-full border-2 border-surface bg-raised overflow-hidden grid place-items-center text-[11px] text-accent">{c.headshotUrl ? <img src={c.headshotUrl} alt="" className="w-full h-full object-cover" /> : c.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>)}</div><p className="text-[14px] leading-relaxed">More than a lineup. A little world.</p><p className="text-[13px] text-muted mt-2 leading-relaxed">Mentors trade notes. Rivals call for rematches. Comics turn a shared idea into their next bit. Their story starts with the first show.</p><button onClick={onCircuit} className="text-accent text-[13px] mt-4 inline-flex items-center gap-2">Meet everyone <Icon name="arrow" size={14} /></button></div>}
          </div>
        </section>
      </div>
      <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-[11px] text-muted"><span>Made on your machine. Yours to keep.</span><button onClick={() => onPreview()} className="hover:text-accent">Play the sample show <span aria-hidden="true">↗</span></button></div>
    </div>
  );
}
