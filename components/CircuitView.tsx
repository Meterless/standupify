import React, { useEffect, useMemo, useState } from 'react';
import { AISettings } from '../types';
import { useCircuit } from '../services/league/store';
import {
  ensureCircuit, runShow, setLive, setRehearsals, nextPlan, lineageOf, comedianOf, comedianName, isShowRunning, JUDGES, resetCircuit, shootRoster
} from '../services/league/engine';
import { CircuitEvent, CircuitState, CircuitStats, FORMAT_LABEL, Performance, RoomState, Show, STAGE_LABEL, StageNotes } from '../services/league/types';
import { CRAFT, masterByKey, personaByKey } from '../services/league/masters';
import { LENS_LABEL } from '../services/league/forge';
import { venueById } from '../services/comfy/presets';
import { headshotPrompt, Capabilities } from '../services/studio';
import { useEngines } from '../services/engines';
import { Button, Icon, IconName, Progress, Segmented, notify, notifyError, plainText } from './ui';
import { MadeInComfy } from './ComfyProvenance';
import ShowPlayer from './ShowPlayer';

// ---------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------

function Avatar({ id, size = 36, ring }: { id: string; size?: number; ring?: string }) {
  const c = comedianOf(id);
  const src = c?.headshotUrl || c?.avatarImage;
  const hue = venueById(c?.venue).swatch;
  const initials = (c?.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('');
  return (
    <span className={`relative inline-grid place-items-center rounded-full overflow-hidden shrink-0 ${ring || ''}`} style={{ width: size, height: size, background: `linear-gradient(150deg, ${hue[0]}, ${hue[1]})` }}>
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <span className="font-semibold text-white/90" style={{ fontSize: size * 0.36 }}>{initials}</span>}
    </span>
  );
}

const STAGE_TONE: Record<string, string> = {
  open_mic: 'text-muted border-line', regular: 'text-cool border-cool/30', feature: 'text-ok border-ok/30', headliner: 'text-accent border-accent/40', legend: 'text-[#ffd98a] border-[#ffd98a]/60 bg-[#ffd98a]/10'
};

function StageBadge({ stage }: { stage: string }) {
  return <span className={`text-[10px] font-mono uppercase tracking-wider border rounded px-1.5 py-px ${STAGE_TONE[stage]}`}>{STAGE_LABEL[stage as keyof typeof STAGE_LABEL]}</span>;
}

function Spark({ values, w = 72, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return <span className="inline-block" style={{ width: w }} />;
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(1, hi - lo);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - lo) / span) * (h - 2) - 1}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return <svg width={w} height={h} className="shrink-0"><polyline points={pts} fill="none" stroke={up ? 'var(--color-ok)' : 'var(--color-live)'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

const EVENT_ICON: Record<CircuitEvent['kind'], IconName> = {
  debut: 'mic', win: 'check', upset: 'bolt', bomb: 'alert', streak: 'sparkle', promotion: 'stack', title: 'sparkle',
  rivalry: 'bolt', theft: 'alert', apprentice: 'workflow', retirement: 'moon', applause: 'laugh', heckler: 'laugh', season: 'grid', special: 'film',
  arrival: 'dice', era: 'grid', aim: 'check', room: 'mic', study: 'sparkle', mind: 'sparkle'
};
const EVENT_TONE: Partial<Record<CircuitEvent['kind'], string>> = {
  title: 'text-[#ffd98a]', special: 'text-[#ffd98a]', era: 'text-[#ffd98a]', arrival: 'text-cool', aim: 'text-ok', room: 'text-accent', study: 'text-cool', mind: 'text-cool', upset: 'text-accent', theft: 'text-live', bomb: 'text-live', rivalry: 'text-accent', promotion: 'text-ok', apprentice: 'text-cool', applause: 'text-accent'
};

function ago(night: number, now: number) {
  const d = now - night;
  return d <= 0 ? 'tonight' : d === 1 ? 'last night' : `${d} nights ago`;
}

// ---------------------------------------------------------------------
// the live stage
// ---------------------------------------------------------------------

function Scoreboard({ show, compact }: { show: Show; compact?: boolean }) {
  const ranked = [...show.performances].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return (
    <div className="flex flex-col gap-2">
      {ranked.map(p => <PerfRow key={p.comedianId} p={p} winner={p.comedianId === show.winnerId} compact={compact} />)}
    </div>
  );
}

function PerfRow({ p, winner, compact }: { p: Performance; winner: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const delta = p.eloAfter - p.eloBefore;
  return (
    <div className={`rounded-2xl border transition-colors ${winner ? 'border-accent/60 bg-accent-soft' : 'border-line bg-white/[0.02]'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 p-3 text-left">
        <span className={`w-6 text-center font-mono text-[13px] ${winner ? 'text-accent' : 'text-dim'}`}>{p.rank ? `#${p.rank}` : '·'}</span>
        <Avatar id={p.comedianId} size={38} ring={winner ? 'ring-2 ring-accent' : ''} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold truncate">{comedianName(p.comedianId)} {p.simulated && <span className="text-[10px] font-mono text-dim">SIMULATED</span>}</div>
          <div className="text-[12px] text-muted truncate">“{p.title}”{p.target ? ` · roasting ${comedianName(p.target)}` : ''}{p.rehearsed > 1 ? ` · best of ${p.rehearsed} drafts` : ''}</div>
        </div>
        {!compact && p.cards.length > 0 && (
          <div className="hidden md:flex gap-1.5">
            {p.cards.map(c => <span key={c.judge} title={c.line} className="w-9 h-8 rounded-lg bg-black/40 border border-line grid place-items-center font-mono text-[12px]">{c.score.toFixed(1)}</span>)}
          </div>
        )}
        {p.final > 0 && (
          <div className="text-right w-[70px] shrink-0">
            <div className={`font-display text-[26px] leading-none ${winner ? 'text-accent' : ''}`}>{p.final.toFixed(1)}</div>
            <div className={`text-[10.5px] font-mono ${delta >= 0 ? 'text-ok' : 'text-live'}`}>{delta >= 0 ? '+' : ''}{delta} Elo</div>
          </div>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 -mt-1 flex flex-col gap-3 animate-in fade-in duration-200">
          <p className="text-[14px] leading-relaxed text-text/90">{p.text}</p>
          {p.cards.length > 0 && (
            <div className="grid sm:grid-cols-3 gap-2">
              {p.cards.map((c, i) => (
                <div key={c.judge} className="rounded-xl bg-black/30 border border-line p-2.5">
                  <div className="flex items-center justify-between text-[11px] text-muted"><span>{JUDGES[i]?.name}, {JUDGES[i]?.role}</span><span className="font-mono text-text">{c.score.toFixed(1)}</span></div>
                  <div className="text-[12.5px] mt-1 italic">“{c.line}”</div>
                </div>
              ))}
            </div>
          )}
          {p.stage && <StageBlock s={p.stage} />}
          <div className="flex flex-wrap gap-2 text-[11.5px] text-muted">
            <span>crowd {p.crowd.toFixed(1)} · {p.laughs} laughs</span>
            {p.moments.map(m => <span key={m} className="text-accent">· {m}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// the Room — who is in it, and how each comic worked it
// ---------------------------------------------------------------------

function Gauge({ label, value, before }: { label: string; value: number; before?: number }) {
  const d = before == null ? 0 : value - before;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-12 text-muted">{label}</span>
      <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-accent meter-fill" style={{ width: `${value * 10}%` }} /></div>
      <span className="font-mono w-7">{value.toFixed(1)}</span>
      {before != null && Math.abs(d) >= 0.1 && <span className={`font-mono ${d > 0 ? 'text-ok' : 'text-live'}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(1)}</span>}
    </div>
  );
}

function RoomStrip({ room }: { room: RoomState }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 mb-3 pb-3 border-b border-line/60">
      <div className="flex flex-col gap-1">
        <Gauge label="energy" value={room.energy} /><Gauge label="warmth" value={room.warmth} /><Gauge label="focus" value={room.focus} />
      </div>
      <div className="min-w-0 flex-1 text-[11.5px] text-muted flex flex-col gap-1">
        <span>{room.size} room{room.regulars ? ' · the regulars are in' : ''}{room.lastKill ? ` · still buzzing about ${comedianName(room.lastKill)}` : room.lastBomb ? ` · cold after ${comedianName(room.lastBomb)}` : ''}</span>
        <span className="flex flex-wrap gap-1">
          {room.people.map(p => <span key={p.id} title={p.seat} className={`rounded-full border px-2 py-px text-[10.5px] ${p.usedBy ? 'border-accent/50 text-accent' : 'border-line'}`}>{p.who.split(',')[0]}</span>)}
        </span>
      </div>
    </div>
  );
}

function StageBlock({ s }: { s: StageNotes }) {
  return (
    <div className="rounded-xl bg-black/30 border border-line p-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-muted tracking-wider">WORKING THE ROOM{s.lift ? ` · ${s.lift > 0 ? '+' : ''}${s.lift.toFixed(1)} crowd` : ''}</span>
        <span className="flex flex-wrap gap-1">{s.craft.map(c => <span key={c} title={`${CRAFT[c].what} ${CRAFT[c].drill}`} className="rounded-full border border-cool/40 text-cool px-2 py-px text-[10.5px]">{CRAFT[c].name}</span>)}</span>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <Gauge label="energy" value={s.room.after.energy} before={s.room.before.energy} />
        <Gauge label="warmth" value={s.room.after.warmth} before={s.room.before.warmth} />
        <Gauge label="focus" value={s.room.after.focus} before={s.room.before.focus} />
      </div>
      {(s.incident || s.followed) && (
        <div className="text-[11.5px] text-muted">
          {s.followed && <span>Followed {s.followed === 'killer' ? 'a killer' : 'a bomb'}. </span>}
          {s.incident && <span>Mid-set, {s.incident.split(' — ')[0]}, <span className={s.handled ? 'text-ok' : 'text-live'}>{s.handled ? 'rode it' : 'let it pass'}</span>.</span>}
        </div>
      )}
      {s.delivery.some(b => b.cue) && (
        <p className="text-[12.5px] leading-relaxed text-text/80">
          {s.delivery.map((b, i) => (
            <React.Fragment key={i}>
              {b.lead && <span className="font-mono text-[10.5px] text-accent">[{b.lead}] </span>}
              {b.line}{b.cue && <span className="font-mono text-[10.5px] text-accent"> [{b.cue}]</span>}{' '}
            </React.Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Call it — your picks, scored against what actually happened
// ---------------------------------------------------------------------

const PICKS_KEY = 'standupify_circuit_picks_v1';
function readPicks(): Record<string, string> { try { return JSON.parse(localStorage.getItem(PICKS_KEY) || '{}'); } catch { return {}; } }

function usePicks(shows: Show[]) {
  const [picks, setPicks] = useState<Record<string, string>>(readPicks);
  const setPick = (showId: string, comedianId: string) => {
    const next = { ...picks, [showId]: comedianId };
    setPicks(next);
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(next)); } catch { /* private window */ }
  };
  const judged = shows.filter(s => s.winnerId && picks[s.id]);
  const right = judged.filter(s => picks[s.id] === s.winnerId).length;
  return { picks, setPick, record: { right, total: judged.length } };
}

function LiveStage({ st, onOpen, onWatch, picks, setPick }: {
  st: CircuitState; onOpen: (id: string, setId?: string | null) => void; onWatch: (s: Show) => void;
  picks: Record<string, string>; setPick: (showId: string, comedianId: string) => void;
}) {
  const { live, shows } = useCircuit();
  const show = live.show || shows[0] || null;
  const club = show ? st.clubs.find(c => c.id === show.clubId) : null;
  const venue = venueById(club?.venue);
  const busy = live.phase === 'booking' || live.phase === 'rehearsing' || live.phase === 'judging' || live.phase === 'crowd';
  const onStage = busy && live.current >= 0 ? show?.lineup[live.current] : null;
  const winner = show?.performances.find(p => p.comedianId === show.winnerId);
  const plan = nextPlan(st);

  if (!show) {
    return (
      <div className="relative card overflow-hidden min-h-[360px] grid place-items-center p-8 text-center"
        style={{ background: `radial-gradient(ellipse at 50% 0%, #ffd9a022, transparent 60%), linear-gradient(160deg, ${venueById(plan.club.venue).swatch[0]}55, transparent)` }}>
        <div>
          <div className="kicker">Night {plan.night}</div>
          <div className="font-display text-[44px] leading-tight mt-2">{FORMAT_LABEL[plan.format]} at {plan.club.name}</div>
          <p className="text-muted mt-2 text-sm">The doors open when you press Run a show, or go live and let the Circuit run itself.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative card overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-70" style={{ background: `radial-gradient(ellipse at 50% -10%, #ffd9a02a, transparent 55%), linear-gradient(170deg, ${venue.swatch[0]}66, transparent 60%)` }} />
      <div className="relative p-5 md:p-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          {busy ? <span className="h-6 px-2.5 rounded-full bg-live text-white text-[10.5px] font-mono tracking-widest flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-white breathe" />LIVE</span>
            : <span className="h-6 px-2.5 rounded-full bg-white/10 text-[10.5px] font-mono tracking-widest grid place-items-center">NIGHT {show.night}</span>}
          <span className="font-display text-[28px] md:text-[34px] leading-none">{FORMAT_LABEL[show.format]} <span className="text-muted">at</span> {club?.name}</span>
          <span className="ml-auto text-[12px] text-muted">theme · <span className="text-text">{show.theme}</span></span>
        </div>

        {/* Lineup — and your call on who takes it */}
        <div className="flex flex-wrap gap-3">
          {show.lineup.map((id, i) => {
            const done = show.performances.some(p => p.comedianId === id);
            const now = id === onStage;
            const mine = picks[show.id] === id;
            const settled = !!show.winnerId && !busy;
            return (
              <div key={id} className={`flex items-center rounded-full border transition-all ${mine ? 'border-cool/70 bg-cool/10' : now ? 'border-accent bg-accent-soft scale-[1.03]' : done ? 'border-line bg-white/[0.04]' : 'border-line/60'}`}>
                <button onClick={() => onOpen(id, st.stats[id]?.circuitSetId)} className={`flex items-center gap-2.5 pl-1.5 pr-3 h-12 ${!now && !done && !mine ? 'opacity-60' : ''}`}>
                  <Avatar id={id} size={36} ring={now ? 'ring-2 ring-accent' : ''} />
                  <span className="text-left">
                    <span className="block text-[13px] font-medium leading-tight">{comedianName(id)}</span>
                    <span className="block text-[10.5px] text-muted leading-tight">{now ? (live.phase === 'rehearsing' ? 'backstage' : 'on stage') : done ? 'performed' : i === show.lineup.length - 1 && show.format === 'headliner' ? 'headliner' : 'waiting'}</span>
                  </span>
                </button>
                {busy && !show.winnerId && (
                  <button onClick={() => setPick(show.id, id)} title="Call it: you think they win tonight"
                    className={`mr-1.5 h-7 px-2.5 rounded-full text-[10.5px] font-mono transition-colors ${mine ? 'bg-cool text-ink' : 'text-muted hover:text-text hover:bg-white/[0.08]'}`}>
                    {mine ? 'YOUR PICK' : 'PICK'}
                  </button>
                )}
                {settled && mine && <span className={`mr-2 text-[10.5px] font-mono ${show.winnerId === id ? 'text-ok' : 'text-live'}`}>{show.winnerId === id ? 'CALLED IT' : 'MISSED'}</span>}
              </div>
            );
          })}
        </div>

        {/* What is happening right now */}
        {busy && (
          <div className="rounded-2xl bg-black/35 border border-line p-5 min-h-[150px]">
            <div className="flex items-center gap-2 text-[12px] text-muted mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent breathe" />{live.note}
              {live.drafts && <span className="ml-auto font-mono">Nightshift drafts {live.drafts.done}/{live.drafts.of}</span>}
            </div>
            {live.room && live.phase === 'rehearsing' && <RoomStrip room={live.room} />}
            {live.phase === 'rehearsing' && (
              live.streaming
                ? <p className="font-display text-[22px] md:text-[26px] leading-snug caret">{live.streaming}</p>
                : live.drafts
                  ? <div className="flex gap-2 mt-3">{Array.from({ length: live.drafts.of }).map((_, i) => {
                      const written = i < live.drafts!.done;
                      return (
                        <span key={i} className={`h-20 flex-1 rounded-xl border grid place-items-center text-[11px] font-mono ${written ? 'border-accent/50 bg-accent-soft text-accent' : 'border-line shimmer text-dim'}`}>
                          {written ? <span className="flex items-center gap-1.5"><Icon name="check" size={12} />draft {i + 1}</span> : `draft ${i + 1}…`}
                        </span>
                      );
                    })}</div>
                  : <div className="h-6 w-2/3 rounded shimmer mt-2" />
            )}
            {(live.phase === 'judging' || live.phase === 'crowd') && (
              <div className="grid sm:grid-cols-3 gap-3 mt-2">
                {JUDGES.map(j => (
                  <div key={j.key} className="rounded-xl border border-line bg-white/[0.03] p-3">
                    <div className="text-[13px] font-semibold">{j.name}</div>
                    <div className="text-[11px] text-muted">{j.role}</div>
                    <div className="h-8 mt-2 rounded shimmer" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {!busy && show.performances.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 items-start [&>*]:min-w-0">
            <div className="relative rounded-2xl overflow-hidden aspect-[4/3] bg-raised border border-accent/40">
              {winner?.videoUrl
                ? (winner.videoUrl.startsWith('data:image/')
                    ? <img src={winner.videoUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    : <video src={winner.videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" />)
                : winner?.imageUrl
                ? <img src={winner.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover cam cam-run cam-dolly-in" />
                : <div className="absolute inset-0 grid place-items-center" style={{ background: `radial-gradient(circle at 50% 30%, #ffd9a044, transparent 55%), linear-gradient(160deg, ${venue.swatch[0]}, ${venue.swatch[1]})` }}><Avatar id={show.winnerId || ''} size={120} ring="ring-4 ring-accent/70" /></div>}
              <MadeInComfy url={winner?.videoUrl || winner?.imageUrl} drop="down" className="top-3 right-3" />
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
                <div className="kicker !text-accent">Tonight's winner</div>
                <div className="font-display text-[30px] leading-tight">{comedianName(show.winnerId || '')}</div>
                <div className="text-[12.5px] text-white/75 italic line-clamp-2">{show.headline}</div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Scoreboard show={show} />
              <Button size="sm" icon="play" onClick={() => onWatch(show)} className="self-start">Watch it on Circuit TV</Button>
            </div>
          </div>
        )}
        {busy && show.performances.length > 0 && <Scoreboard show={show} compact />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------

export default function CircuitView({ getSettings, settings, caps, onOpen, onTuneIn }: {
  getSettings: () => AISettings; settings: AISettings; caps: Capabilities; onOpen: (comedianId: string, setId?: string | null) => void; onTuneIn?: () => void;
}) {
  const eng = useEngines();
  const { state: st, live, shows } = useCircuit();
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'feed' | 'lineage' | 'history'>('feed');
  const [watching, setWatching] = useState<Show | null>(null);
  const { picks, setPick, record } = usePicks(shows);
  const lastSettled = shows[0]?.winnerId ? shows[0] : null;
  useEffect(() => {
    if (!lastSettled || !picks[lastSettled.id] || Date.now() - (lastSettled.endedAt || 0) > 60_000) return;
    const right = picks[lastSettled.id] === lastSettled.winnerId;
    notify(right ? `You called it: ${comedianName(lastSettled.winnerId!)} takes the night.` : `Missed. ${comedianName(lastSettled.winnerId!)} won, not ${comedianName(picks[lastSettled.id])}.`, { tone: right ? 'ok' : 'info' });
  }, [lastSettled?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ensureCircuit().catch(e => notifyError(e)); }, []);

  // The moment ComfyUI can shoot, everyone on the Circuit without a face gets one — once per session.
  useEffect(() => {
    if (!st || caps.stills?.engine !== 'ComfyUI') return;
    const faceless = Object.values(st.stats).filter(s => s.life === 'active' && !comedianOf(s.comedianId)?.headshotUrl && !comedianOf(s.comedianId)?.avatarImage);
    if (!faceless.length) return;
    try { if (sessionStorage.getItem('standupify_auto_headshots') === '1') return; sessionStorage.setItem('standupify_auto_headshots', '1'); } catch { /* ignore */ }
    notify(`ComfyUI is up. Shooting headshots for ${faceless.length} comics on the Circuit.`);
    shootRoster(getSettings(), c => headshotPrompt(c, c.venue)).then(n => n && notify(`${n} new headshots on the board.`, { tone: 'ok' }));
  }, [caps.stills?.engine, !!st]);   // eslint-disable-line react-hooks/exhaustive-deps

  const board = useMemo(() => Object.values(st?.stats || {}).filter(s => s.life === 'active').sort((a, b) => b.elo - a.elo), [st]);
  if (!st) return <div className="max-w-[1300px] mx-auto px-4 md:px-8 pt-16"><div className="h-64 rounded-3xl shimmer" /></div>;

  const online = eng.nightshift.state === 'online';
  const runOnce = async () => {
    if (isShowRunning()) return;
    setBusy(true);
    try { await runShow(getSettings()); } catch (e) { notifyError(e); } finally { setBusy(false); }
  };
  const showRunning = ['booking', 'rehearsing', 'judging', 'crowd'].includes(live.phase);
  const rivals = [...st.rivalries].filter(r => r.heat >= 1).sort((a, b) => b.heat - a.heat).slice(0, 5);
  const lines = lineageOf(st);
  const retired = Object.values(st.stats).filter(s => s.life === 'retired').length;

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-10 md:pt-14 pb-28">
      {/* Hero */}
      <div className="flex flex-wrap items-end gap-6 mb-8">
        <div className="flex-1 min-w-[280px]">
          <div className="kicker">The Circuit · {st.night} night{st.night === 1 ? '' : 's'} played · {board.length} comics on the circuit{retired ? ` · ${retired} retired` : ''}</div>
          {st.era?.current && (
            <div className="mt-2 inline-flex items-center gap-2 h-7 px-3 rounded-full border border-[#ffd98a]/40 bg-[#ffd98a]/10 text-[12px] text-[#ffd98a]" title="The style that keeps winning shapes every comic born now">
              <Icon name="grid" size={12} />Now: {st.era.current.name.replace(/^the /, 'The ')} · since night {st.era.current.sinceNight}
            </div>
          )}
          <h1 className="font-display text-[44px] sm:text-[60px] md:text-[76px] leading-[0.95] mt-3">
            The comedy circuit<br /><span className="italic text-accent">that runs itself.</span>
          </h1>
          <p className="text-muted mt-4 max-w-2xl text-[15px]">
            Four clubs, a new show every night. Nightshift rehearses every set as {st.rehearsals > 1 ? `${st.rehearsals} competing drafts` : 'a fresh draft'}, a three-judge panel scores it, the room reacts, and careers rise and fall: rivalries, stolen jokes, apprentices, retirements. You just watch.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex flex-wrap gap-2 justify-end">
            {onTuneIn && <Button variant="ghost" icon="play" onClick={onTuneIn} className="!border-[#ff5a43]/50">Watch on TV</Button>}
            <Button variant="ghost" icon="bolt" onClick={runOnce} disabled={busy || showRunning}>{showRunning ? 'Show in progress…' : online ? 'Run one show' : 'Run (simulated)'}</Button>
            <Button variant={st.live ? 'ghost' : 'primary'} size="lg" icon={st.live ? 'pause' : 'moon'}
              onClick={() => setLive(!st.live, getSettings).then(() => notify(st.live ? 'The Circuit goes dark.' : 'The Circuit is live. Shows run back to back.', { tone: 'ok' }))}
              className={st.live ? '!border-live/50' : ''}>
              {st.live ? <><span className="w-2 h-2 rounded-full bg-live breathe" />Live · stop</> : 'Go live'}
            </Button>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-muted">
            Rehearsal drafts
            <Segmented size="sm" value={String(st.rehearsals)} onChange={v => setRehearsals(Number(v))} options={[
              { value: '1', label: '1', hint: 'One chat draft, fastest' }, { value: '3', label: '3', hint: 'Nightshift writes 3, keeps the best' }, { value: '5', label: '5', hint: 'Five drafts, slowest and sharpest' }
            ]} />
          </div>
          {shows[0]?.endedAt && (
            <div className="text-[11.5px] text-dim">
              last show took {Math.max(1, Math.round((shows[0].endedAt - shows[0].startedAt) / 60_000))} min on this machine · {shows[0].performances[0]?.rehearsed || 1} draft{(shows[0].performances[0]?.rehearsed || 1) === 1 ? '' : 's'} a set
            </div>
          )}
          {!online && <div className="text-[12px] text-accent">Nightshift is off. Shows run simulated from each comic's material.</div>}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <LiveStage st={st} onOpen={onOpen} onWatch={setWatching} picks={picks} setPick={setPick} />

          {/* Clubs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {st.clubs.map(c => {
              const v = venueById(c.venue);
              const next = nextPlan(st);
              return (
                <div key={c.id} className="rounded-2xl overflow-hidden border border-line bg-surface">
                  <div className="h-16 relative" style={{ background: `radial-gradient(circle at 50% 0%, #ffd9a055, transparent 60%), linear-gradient(160deg, ${v.swatch[0]}, ${v.swatch[1]})` }}>
                    {showRunning && live.show?.clubId === c.id
                      ? <span className="absolute top-2 left-2 text-[10px] font-mono bg-live text-white rounded px-1.5 py-0.5">LIVE NOW · {FORMAT_LABEL[live.show.format].toUpperCase()}</span>
                      : !showRunning && next.club.id === c.id && <span className="absolute top-2 left-2 text-[10px] font-mono bg-black/60 rounded px-1.5 py-0.5">NEXT · {FORMAT_LABEL[next.format].toUpperCase()}</span>}
                    <span className="absolute top-2 right-2 text-[11px] text-[#ffd98a]">{'★'.repeat(c.prestige)}</span>
                  </div>
                  <div className="p-3">
                    <div className="font-semibold text-[14px] truncate">{c.name}</div>
                    <div className="text-[11.5px] text-muted line-clamp-2 mt-0.5">{c.blurb}</div>
                    <div className="flex items-center gap-2 mt-2 text-[11px] text-muted">
                      {c.champion ? <><Avatar id={c.champion} size={18} /><span className="truncate">house champ · {comedianName(c.champion)}</span></> : <span>no house champion yet</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Feed / lineage / history */}
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-4">
              <Segmented<'feed' | 'lineage' | 'history'> size="sm" value={tab} onChange={setTab} options={[{ value: 'feed', label: 'The Grapevine' }, { value: 'lineage', label: 'Lineages' }, { value: 'history', label: 'Show history' }]} />
            </div>
            {tab === 'feed' && <Grapevine events={st.events} night={st.night} />}
            {tab === 'lineage' && (
              <div className="flex flex-col gap-4">
                <Forge st={st} onOpen={onOpen} />
                {lines.map(l => (
                  <div key={l.founderId} className="rounded-2xl border border-line p-4">
                    <div className="flex items-center gap-3">
                      <Avatar id={l.founderId} size={34} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold">House of {comedianName(l.founderId)}</div>
                        <div className="text-[11.5px] text-muted truncate">{st.stats[l.founderId]?.doctrine}</div>
                      </div>
                      <span className="text-[11px] text-muted font-mono">{l.wins} wins{l.titles ? ` · ${l.titles} titles` : ''}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {l.members.map(m => (
                        <button key={m.comedianId} onClick={() => onOpen(m.comedianId, m.circuitSetId)} className={`flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border border-line text-[12px] ${m.life === 'retired' ? 'opacity-50' : ''}`}>
                          <Avatar id={m.comedianId} size={24} />
                          <span className="text-dim font-mono">G{m.generation}</span>{comedianName(m.comedianId)}
                          {m.mentorId && <span className="text-dim">← {comedianName(m.mentorId).split(' ')[0]}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tab === 'history' && (
              <div className="flex flex-col gap-4">
                {!shows.length && <p className="text-sm text-muted">No shows yet.</p>}
                {shows.slice(0, 20).map(s => <HistoryRow key={s.id} show={s} st={st} onWatch={setWatching} />)}
              </div>
            )}
          </div>
        </div>

        {/* Leaderboard + rivalries */}
        <aside className="flex flex-col gap-5 xl:sticky xl:top-20">
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="kicker">The board</div>
              {st.champion && <span className="text-[11px] text-[#ffd98a] flex items-center gap-1.5"><Icon name="sparkle" size={12} />champion · {comedianName(st.champion)}</span>}
            </div>
            {record.total > 0 && (
              <div className="mx-1 mb-3 px-3 py-2 rounded-xl bg-cool/10 border border-cool/30 text-[12px] flex items-center justify-between">
                <span>Your booking eye</span>
                <span className="font-mono text-cool">{record.right}/{record.total} called</span>
              </div>
            )}
            <ol className="flex flex-col gap-1">
              {board.map((s, i) => <BoardRow key={s.comedianId} s={s} i={i} champion={st.champion === s.comedianId} onOpen={onOpen} />)}
            </ol>
            {caps.stills && board.some(s => !comedianOf(s.comedianId)?.headshotUrl && !comedianOf(s.comedianId)?.avatarImage) && (
              <Button size="sm" variant="quiet" icon="camera" className="w-full mt-2" onClick={() => shootRoster(getSettings(), c => headshotPrompt(c, c.venue)).then(n => notify(n ? `Shot ${n} headshots.` : 'No headshots came back.', { tone: n ? 'ok' : 'info' }))}>
                Shoot headshots for the roster
              </Button>
            )}
          </div>

          {rivals.length > 0 && (
            <div className="card p-4">
              <div className="kicker mb-3 px-1">Rivalries</div>
              <div className="flex flex-col gap-3">
                {rivals.map(r => (
                  <div key={r.a + r.b} className="flex items-center gap-3">
                    <Avatar id={r.a} size={28} /><span className="text-[11px] font-mono text-muted">{r.aWins}–{r.bWins}</span><Avatar id={r.b} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] truncate">{comedianName(r.a).split(' ')[0]} vs {comedianName(r.b).split(' ')[0]}</div>
                      <Progress value={Math.min(1, r.heat / 10)} className="mt-1" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ShowPlayer show={watching} st={st} onClose={() => setWatching(null)} />
          <div className="text-center">
            <button onClick={() => { if (window.confirm('Start a new season? Every rating, rivalry and show is wiped (comedians stay in your roster).')) resetCircuit(); }} className="text-[11px] text-dim hover:text-muted">New season</button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BoardRow({ s, i, champion, onOpen }: { s: CircuitStats; i: number; champion: boolean; onOpen: (id: string, setId?: string | null) => void }) {
  return (
    <li>
      <button onClick={() => onOpen(s.comedianId, s.circuitSetId)} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/[0.04] text-left">
        <span className={`w-5 text-right font-mono text-[12px] ${i < 3 ? 'text-accent' : 'text-dim'}`}>{i + 1}</span>
        <Avatar id={s.comedianId} size={32} ring={champion ? 'ring-2 ring-[#ffd98a]' : ''} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate">{comedianName(s.comedianId)}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StageBadge stage={s.stage} />
            <span className="text-[10.5px] text-dim">{s.wins}W · {s.shows} shows{s.streak >= 2 ? ` · 🔥${s.streak}` : ''}</span>
          </div>
          {s.aim && <div className="text-[10.5px] text-muted truncate mt-0.5" title={s.journal?.[0]?.text}>wants to {s.aim.text}</div>}
          {s.inner && <div className="text-[10.5px] text-cool truncate" title={plainText(s.inner.stream[0]?.text || '')}>{s.inner.felt.label}{s.inner.stream[0] ? ` · “${plainText(s.inner.stream[0].text)}”` : ''}</div>}
          {s.presence && (
            <div className="text-[10.5px] text-dim truncate" title={`${personaByKey(s.presence.persona)?.stance || ''}. Signature: ${s.presence.signature.map(c => CRAFT[c].name).join(', ')}${s.presence.lesson ? `. Drilling ${CRAFT[s.presence.lesson.craft].name}` : ''}`}>
              {personaByKey(s.presence.persona)?.name} · studies {s.presence.masters.map(k => masterByKey(k)?.name).filter(Boolean).join(', ')}
            </div>
          )}
        </div>
        <Spark values={s.eloHistory} w={46} h={18} />
        <span className="font-mono text-[13px] w-11 text-right">{s.elo}</span>
      </button>
    </li>
  );
}

function Grapevine({ events, night }: { events: CircuitEvent[]; night: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!events.length) return <p className="text-sm text-muted">Quiet night. Nothing on the grapevine yet.</p>;
  return (
    <ol className="flex flex-col gap-3 max-h-[520px] overflow-y-auto pr-1">
      {events.slice(0, 80).map(e => (
        <li key={e.id} className="flex gap-3 items-start">
          <span className={`mt-0.5 w-8 h-8 rounded-xl grid place-items-center shrink-0 bg-white/[0.05] ${EVENT_TONE[e.kind] || 'text-muted'}`}><Icon name={EVENT_ICON[e.kind]} size={15} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">{e.actors.slice(0, 3).map(a => <Avatar key={a} id={a} size={18} />)}<span className="text-[11px] text-dim">{ago(e.night, night)}</span></div>
            <div className="text-[13.5px] leading-snug mt-1">{plainText(e.text)}</div>
            {e.evidence && (
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="text-[11.5px] text-live mt-1 hover:underline">{open === e.id ? 'Hide the evidence' : 'See the evidence'}</button>
            )}
            {open === e.id && e.evidence && (
              <div className="grid sm:grid-cols-2 gap-2 mt-2">
                <div className="rounded-xl bg-black/30 border border-live/30 p-2.5 text-[12px]"><div className="text-[10px] font-mono text-live mb-1">ACCUSED · TONIGHT</div>{e.evidence.a}</div>
                <div className="rounded-xl bg-black/30 border border-line p-2.5 text-[12px]"><div className="text-[10px] font-mono text-muted mb-1">ORIGINAL · EARLIER</div>{e.evidence.b}</div>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function HistoryRow({ show, st, onWatch }: { show: Show; st: CircuitState; onWatch: (s: Show) => void }) {
  const [open, setOpen] = useState(false);
  const club = st.clubs.find(c => c.id === show.clubId);
  return (
    <div className="rounded-2xl border border-line">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 p-3 text-left">
        <span className="font-mono text-[11px] text-dim w-14">night {show.night}</span>
        {show.winnerId && <Avatar id={show.winnerId} size={30} />}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium truncate">{show.headline}</div>
          <div className="text-[11.5px] text-muted truncate">{FORMAT_LABEL[show.format]} · {club?.name} · {show.theme}</div>
        </div>
        <Icon name="arrow" size={14} className={`text-dim transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2"><Scoreboard show={show} /><Button size="sm" icon="play" onClick={() => onWatch(show)} className="self-start">Watch on Circuit TV</Button></div>}
    </div>
  );
}

/** Born through a lens on a muse — who the Forge made, and why. */
function Forge({ st, onOpen }: { st: CircuitState; onOpen: (id: string, setId?: string | null) => void }) {
  const forged = Object.values(st.stats).filter(s => s.lens && s.lens !== 'founder' && s.lens !== 'newcomer' && s.lens !== 'disciple')
    .sort((a, b) => b.joinedNight - a.joinedNight);
  const eras = [st.era?.current, ...(st.era?.history || [])].filter(Boolean);
  if (!forged.length && !eras.length) {
    return <div className="rounded-2xl border border-dashed border-line p-4 text-[12.5px] text-muted">The Forge is quiet. As styles start winning, the Circuit enters eras, and new comics arrive built in answer to the top of the board: imitators, answers, outsiders, seconds and sworn rivals.</div>;
  }
  return (
    <div className="rounded-2xl border border-cool/30 bg-cool/[0.04] p-4">
      <div className="flex items-center gap-2"><Icon name="dice" size={14} className="text-cool" /><span className="text-[14px] font-semibold">The Forge</span><span className="text-[11.5px] text-muted">comics born in answer to the board</span></div>
      {eras.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {eras.map((e, i) => <span key={e!.name + e!.sinceNight} className={`text-[11px] rounded-full px-2.5 py-1 border ${i === 0 ? 'border-[#ffd98a]/50 text-[#ffd98a]' : 'border-line text-dim'}`}>{e!.name.replace(/^the /, '')} · n{e!.sinceNight}</span>)}
        </div>
      )}
      <div className="flex flex-col gap-2 mt-3">
        {forged.map(s => (
          <button key={s.comedianId} onClick={() => onOpen(s.comedianId, s.circuitSetId)} className={`flex items-center gap-3 text-left rounded-xl px-2 py-1.5 hover:bg-white/[0.04] ${s.life === 'retired' ? 'opacity-50' : ''}`}>
            <Avatar id={s.comedianId} size={30} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{comedianName(s.comedianId)} <span className="text-muted font-normal">· {LENS_LABEL[s.lens!](s.museId ? comedianName(s.museId) : '')}</span></div>
              <div className="text-[11px] text-dim truncate">joined night {s.joinedNight}{s.bornEra ? ` · child of ${s.bornEra.replace(/^the /, '')}` : ''}{s.aim ? ` · wants to ${s.aim.text}` : ''}</div>
            </div>
            {s.museId && <Avatar id={s.museId} size={22} />}
            <span className="font-mono text-[12px] w-10 text-right">{s.elo}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
