import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AISettings, Comedian, Set as ComedySet } from '../types';
import { useCircuit } from '../services/league/store';
import { ensureCircuit, setLive, comedianOf } from '../services/league/engine';
import { useTasks } from '../services/tasks';
import { FORMAT_LABEL } from '../services/league/types';
import { getRepository } from '../services/repository';
import { useEngines } from '../services/engines';
import { venueById } from '../services/comfy/presets';
import { buildCatalog, program, reconcileProgram, CHANNELS, Channel, Segment, judgeName } from '../services/tv/programming';
import { PREVIEW_SEGMENTS } from '../services/tv/preview';
import * as sound from '../services/tv/sound';
import { holdMs } from '../services/league/room';
import { Icon, StageArt } from './ui';
import { MadeInComfy } from './ComfyProvenance';

type Phase = 'slate' | 'set' | 'laugh' | 'verdict';

const PREF_KEY = 'standupify_tv_prefs';
function prefs(): { channel: Channel; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { channel: CHANNELS.some(c => c.id === saved.channel) ? saved.channel : 'best', muted: saved.muted === true };
  } catch { return { channel: 'best', muted: false }; }
}

/** Waits that respect pause and cancellation. */
function makeClock(paused: React.MutableRefObject<boolean>, signal: AbortSignal) {
  return (ms: number) => new Promise<void>((resolve) => {
    let left = ms;
    let last = performance.now();
    const tick = () => {
      if (signal.aborted) return resolve();
      const now = performance.now();
      if (!paused.current) left -= now - last;
      last = now;
      if (left <= 0) return resolve();
      setTimeout(tick, 60);
    };
    tick();
  });
}

const STILL_MOVES = ['dolly-in', 'orbit', 'handheld', 'crane-up'];

function initials(name: string) { return name.split(/\s+/).map(w => w[0]).slice(0, 2).join(''); }

export default function TuneIn({ open, onClose, getSettings, preview = false, initialKey, onOpenEngines }: {
  open: boolean; onClose: () => void; getSettings: () => AISettings;
  preview?: boolean; initialKey?: string; onOpenEngines?: () => void;
}) {
  const { state, shows, live } = useCircuit();
  const eng = useEngines();
  const tasks = useTasks();
  const shooting = tasks.find(t => t.status === 'running' && t.engine === 'ComfyUI' && t.kind === 'video');
  const [specials, setSpecials] = useState<{ comedian: Comedian; set: ComedySet }[]>([]);
  const [channel, setChannel] = useState<Channel>(prefs().channel);
  const selectedChannel = preview ? 'best' : channel;
  const playbackKey = `${preview}:${selectedChannel}:${initialKey || ''}`;
  const [muted, setMutedState] = useState<boolean>(prefs().muted);
  const [playback, setPlayback] = useState<{ queue: Segment[]; index: number; turn: number; sessionKey: string }>({ queue: [], index: 0, turn: 0, sessionKey: '' });
  const { index, turn } = playback;
  const queue = playback.sessionKey === playbackKey ? playback.queue : [];
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [phase, setPhase] = useState<Phase>('slate');
  const [word, setWord] = useState(-1);
  const [pulse, setPulse] = useState(0);
  const [laughs, setLaughs] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [paused, setPaused] = useState(false);
  const [justIn, setJustIn] = useState<Set<string>>(new Set());
  const pausedRef = useRef(false);
  const mutedRef = useRef(muted);
  const knownKeys = useRef<Set<string>>(new Set());
  const session = useRef<string | null>(null);
  const pendingSelection = useRef<string | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => { pausedRef.current = paused; try { paused ? window.speechSynthesis?.pause() : window.speechSynthesis?.resume(); } catch { /* ignore */ } }, [paused]);
  useEffect(() => { mutedRef.current = muted; sound.setMuted(muted); try { localStorage.setItem(PREF_KEY, JSON.stringify({ channel, muted })); } catch { /* ignore */ } }, [muted, channel]);

  // Load the engine + every special in the roster when the TV opens.
  useEffect(() => {
    if (!open || preview) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    const load = () => (async () => {
      const repo = getRepository();
      const comics = await repo.listComedians();
      const out = (await Promise.all(comics.map(async comedian => (await repo.listSets(comedian.id))
        .filter(s => s.title !== 'Live on the Circuit' && s.bits.length).map(set => ({ comedian, set }))))).flat();
      if (active) setSpecials(out);
    })();
    Promise.all([ensureCircuit(), load()])
      .catch(() => { if (active) setLoadError('The channel could not reconnect. Return home and try again.'); })
      .finally(() => { if (active) setLoading(false); });
    // The Reel keeps shooting specials while you watch: pick up new angles.
    const t = setInterval(() => { load().catch(() => { /* keep the last playable catalog */ }); }, 30_000);
    return () => { active = false; clearInterval(t); };
  }, [open, preview]);

  // Tuning in keeps the engine on the air.
  useEffect(() => {
    if (open && !preview && state && !state.live && eng.nightshift.state === 'online') setLive(true, getSettings).catch(() => { /* the TV still plays reruns */ });
  }, [open, preview, !!state, eng.nightshift.state]);   // eslint-disable-line react-hooks/exhaustive-deps

  const catalog = useMemo(() => preview ? PREVIEW_SEGMENTS : buildCatalog(state, shows, specials, comedianOf), [preview, state, shows, specials]);

  // Program once per visit/channel, then merge new work around the current set.
  // The playback effect follows a stable key and a navigation counter, so a
  // newly rendered angle never restarts the comedian's narration.
  useEffect(() => {
    if (!open) { session.current = null; return; }
    if (session.current !== playbackKey) {
      session.current = playbackKey;
      knownKeys.current = new Set(catalog.map(s => s.key));
      setJustIn(new Set());
      const nextQueue = program(catalog, selectedChannel);
      const wanted = selectedChannel === 'best' ? initialKey : undefined;
      const start = wanted ? nextQueue.findIndex(s => s.key === wanted) : 0;
      pendingSelection.current = start < 0 ? wanted : undefined;
      setPlayback(p => ({ queue: start < 0 ? [] : nextQueue, index: Math.max(0, start), turn: p.turn + 1, sessionKey: playbackKey }));
      return;
    }
    if (pendingSelection.current) {
      const nextQueue = program(catalog, selectedChannel);
      const start = nextQueue.findIndex(s => s.key === pendingSelection.current);
      if (start >= 0) {
        pendingSelection.current = undefined;
        setPlayback(p => ({ ...p, queue: nextQueue, index: start }));
        return;
      }
      if (loading) return;
      pendingSelection.current = undefined;
    }
    const seen = knownKeys.current;
    knownKeys.current = new Set([...seen, ...catalog.map(s => s.key)]);
    const fresh = program(catalog, selectedChannel).filter(s => !seen.has(s.key));
    if (fresh.length) setJustIn(prev => new Set([...prev, ...fresh.map(s => s.key)]));
    setPlayback(p => {
      const next = reconcileProgram(p.queue, p.index, catalog, selectedChannel, seen);
      if (!p.queue.length && initialKey) next.index = Math.max(0, next.queue.findIndex(s => s.key === initialKey));
      return { ...p, ...next };
    });
  }, [catalog, open, playbackKey, selectedChannel, initialKey, loading, preview]);

  useEffect(() => {
    if (open) {
      pausedRef.current = false;
      setPaused(false);
      if (initialKey && !preview) setChannel('best');
    }
  }, [open, initialKey, preview]);

  const advance = useCallback((delta: number) => setPlayback(p => p.queue.length ? {
    ...p, index: ((p.index + delta) % p.queue.length + p.queue.length) % p.queue.length, turn: p.turn + 1
  } : p), []);

  const switchChannel = (c: Channel) => {
    setChannel(c);
    setPaused(false);
  };

  const seg: Segment | undefined = queue[index % Math.max(queue.length, 1)];
  const next: Segment | undefined = queue.length > 1 ? queue[(index + 1) % queue.length] : undefined;
  const words = useMemo(() => (seg?.text || '').split(/\s+/).filter(Boolean), [seg?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // the running order of one segment
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!open || !seg) return;
    const ctl = new AbortController();
    const wait = makeClock(pausedRef, ctl.signal);
    const ends = sound.punchlines(seg.text);
    const crowd = seg.crowd ?? (seg.score ?? 6);
    let lastLaughAt = -1;
    setLaughs(0);
    (async () => {
      setPhase('slate'); setWord(-1);
      if (!mutedRef.current) sound.sting();
      await wait(3400);
      if (ctl.signal.aborted) return;

      setPhase('set');
      const onWord = (i: number) => {
        setWord(i);
        // A laugh rolls in at each sentence that lands, bigger as the set builds.
        if (ends.includes(i - 1) && i - 1 !== lastLaughAt && !mutedRef.current) {
          lastLaughAt = i - 1;
          const k = ends.indexOf(i - 1) + 1;
          const strength = Math.min(10, crowd * (0.55 + 0.35 * (k / Math.max(ends.length, 1))));
          sound.laugh(strength);
          setPulse(p => p + 1);
          setLaughs(l => l + 1);
        }
      };
      let spoke = false;
      const beats = seg.delivery?.some(b => b.cue) ? seg.delivery : null;
      if (beats) {
        // The comic's own timing: line by line, holding where they wrote [beat], [hold], [stare]…
        let at = 0;
        for (const b of beats) {
          if (ctl.signal.aborted) break;
          const n = b.line.split(/\s+/).filter(Boolean).length;
          const from = at;
          let said = false;
          if (!mutedRef.current && sound.hasSpeech()) {
            const t0 = performance.now();
            await sound.speak(b.line, { id: seg.comedianId, look: seg.look }, i => onWord(from + i), ctl.signal);
            said = performance.now() - t0 > n * 120;
          }
          if (!said && !ctl.signal.aborted) await sound.paceWords(n, i => onWord(from + i), ctl.signal, 2.7, () => pausedRef.current);
          at += n;
          const hold = holdMs(b.cue);
          if (hold && !ctl.signal.aborted) await wait(hold);
        }
        spoke = true;
      } else if (!mutedRef.current && sound.hasSpeech()) {
        const t0 = performance.now();
        await sound.speak(seg.text, { id: seg.comedianId, look: seg.look }, onWord, ctl.signal);
        // No voices installed (or speech blocked) ends instantly: fall back to reading pace.
        spoke = performance.now() - t0 > words.length * 120;
      }
      if (!spoke && !ctl.signal.aborted) { setWord(-1); await sound.paceWords(words.length, onWord, ctl.signal, 2.7, () => pausedRef.current); }
      if (ctl.signal.aborted) return;

      setPhase('laugh');
      setPulse(p => p + 1);
      setLaughs(l => l + 1);
      const roar = mutedRef.current ? 0 : sound.laugh(crowd);
      if (!mutedRef.current && (seg.moments.includes('applause break') || crowd >= 8.6)) sound.applause(2.6, crowd);
      await wait(Math.max(1800, roar * 1000));
      if (ctl.signal.aborted) return;

      if (seg.cards.length) {
        setPhase('verdict');
        await wait(5200);
      }
      if (!ctl.signal.aborted) advance(1);
    })();
    return () => { ctl.abort(); try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };
  }, [open, seg?.key, turn]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // chrome, keys, fullscreen, the room
  // ------------------------------------------------------------------
  const poke = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 3200);
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = requestAnimationFrame(() => rootRef.current?.focus());
    sound.unlockSound().then(() => { if (active && !mutedRef.current && !pausedRef.current) sound.startRoom(); });
    poke();
    const onKey = (e: KeyboardEvent) => {
      poke();
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Tab') {
        const root = rootRef.current;
        const controls = root ? [...root.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length > 0) : [];
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { e.preventDefault(); root?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === root || !root?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root || !root?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
      else if (e.key === 'ArrowRight') { e.preventDefault(); advance(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); advance(-1); }
      else if (e.key === ' ') { e.preventDefault(); setPaused(p => !p); }
      else if (e.key.toLowerCase() === 'm') setMutedState(m => !m);
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      active = false;
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      sound.stopRoom();
      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* ignore */ });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) { if (muted || paused) sound.stopRoom(); else sound.startRoom(); } }, [muted, paused, open]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause(); else video.play().catch(() => { /* browser may require another gesture */ });
  }, [paused, open, seg?.key, seg?.clips, laughs, phase]);

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* ignore */ });
    else rootRef.current?.requestFullscreen?.().catch(() => { /* ignore */ });
  };

  if (!open) return null;

  // ------------------------------------------------------------------
  // render
  // ------------------------------------------------------------------
  const venue = venueById(seg?.venue);
  // A fully animated set: the Reel's angles, cut on every laugh, with the still
  // (under a camera move) as the reverse shot when there is only one angle.
  const shots: string[] = seg ? [...seg.clips, ...(seg.clips.length === 1 && seg.image ? [seg.image] : [])] : [];
  const shot = shots.length ? shots[(phase === 'set' || phase === 'laugh' ? laughs : 0) % shots.length] : undefined;
  const visual = shot || seg?.image || seg?.headshot;
  const isClip = !!shot && seg!.clips.includes(shot) && !shot.startsWith('data:image/');
  const stillMove = STILL_MOVES[laughs % STILL_MOVES.length];
  const backstage = !preview && ['booking', 'rehearsing', 'judging', 'crowd'].includes(live.phase) && live.show;
  const onStage = backstage && live.current >= 0 ? comedianOf(live.show!.lineup[live.current])?.name : null;
  const club = backstage ? state?.clubs.find(c => c.id === live.show!.clubId)?.name : null;
  const controlsVisible = chrome || paused || !seg;
  const channelName = CHANNELS.find(c => c.id === channel)?.name || 'This channel';
  const otherContent = !preview && catalog.length > 0;
  const waitingForShow = !preview && (!!backstage || !!state?.live && eng.nightshift.state === 'online');
  const emptyTitle = loading && !preview ? 'Finding your next laugh…'
    : otherContent ? `${channelName} is warming up.`
    : loadError && !preview ? 'The channel is taking a moment.'
    : waitingForShow ? 'Your first show is on its way.' : 'The stage is ready for you.';
  const emptyDetail = loading && !preview ? 'Gathering the performances already in your library.'
    : otherContent ? 'There are no performances in this channel yet. Watch the best available while more are made.'
    : loadError && !preview ? loadError
    : backstage ? `${onStage || 'A comic'} is ${live.phase === 'rehearsing' ? 'rehearsing backstage' : 'on'} at ${club}. The show appears here when it is ready.`
    : waitingForShow ? 'The Circuit is preparing fresh material. You can return home while it works.'
    : 'Connect Nightshift to start making shows, or return home to play the sample channel.';

  // Captions: the sentence being spoken, revealed word by word.
  const ends = sound.punchlines(seg?.text || '');
  const cur = Math.max(0, word);
  const sentStart = [-1, ...ends].filter(e => e < cur).pop()! + 1;
  const sentEnd = ends.find(e => e >= cur) ?? words.length - 1;
  const lineStart = Math.max(sentStart, sentEnd - sentStart > 26 ? cur - 14 : sentStart);
  const shown = words.slice(lineStart, sentEnd + 1);
  const setLength = Math.max(8, words.length / 2.6);

  return (
    <div ref={rootRef} onMouseMove={poke} onClick={poke}
      role="dialog" aria-modal="true" tabIndex={-1} aria-label={preview ? 'Standupify TV preview' : 'Standupify TV'}
      className={`fixed inset-0 z-[90] bg-black text-white overflow-hidden select-none ${controlsVisible ? '' : 'md:cursor-none'}`}>

      {/* ---------------- the picture ---------------- */}
      {seg ? (
        <div key={seg.key} className="absolute inset-0 animate-in fade-in duration-1000">
          {isClip
            ? <video ref={videoRef} key={shot} src={shot} autoPlay={!paused} loop muted playsInline className="absolute inset-0 w-full h-full object-cover animate-in fade-in duration-300"
                style={{ filter: phase === 'slate' ? 'blur(14px) brightness(.55)' : 'none', transition: 'filter 1s' }} />
            : visual && seg.clips.length && shot === visual
              ? <img key={`${shot}${laughs}`} src={visual} alt="" className={`absolute inset-0 w-full h-full object-cover cam cam-run cam-${stillMove} animate-in fade-in duration-300`} style={{ objectPosition: '50% 28%', animationPlayState: paused ? 'paused' : 'running' }} />
            : visual
              ? <img src={visual} alt="" className="absolute inset-0 w-full h-full object-cover"
                  style={{ objectPosition: '50% 28%', transform: phase === 'slate' ? 'scale(1.18)' : 'scale(1.04)', transition: `transform ${phase === 'set' ? setLength : 3}s cubic-bezier(.25,.1,.25,1)`, filter: phase === 'slate' ? 'blur(14px) brightness(.55)' : 'none' }} />
              : <StageArt className="absolute inset-0 w-full h-full" hue={venue.swatch[0]} />}
          {/* spotlight, vignette, letterbox, grain */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 70% 75% at 50% 32%, transparent 35%, rgb(0 0 0 / .55) 75%, rgb(0 0 0 / .92) 100%)' }} />
          <div className="absolute inset-0 pointer-events-none mix-blend-soft-light" style={{ background: `radial-gradient(ellipse 45% 40% at 50% 8%, #ffd9a0, transparent 70%)`, opacity: 0.5 }} />
          <div key={pulse} className="absolute inset-0 pointer-events-none laugh-pulse" style={{ background: 'radial-gradient(ellipse at 50% 60%, rgb(255 181 71 / .22), transparent 65%)' }} />
          <div className="absolute inset-x-0 top-0 h-[7vh] bg-black" />
          <div className="absolute inset-x-0 bottom-0 h-[7vh] bg-black" />
        </div>
      ) : (
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 20%, #3a2a12, #000 70%)' }} />
      )}
      <div className="absolute inset-0 pointer-events-none opacity-[0.07]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }} />

      {/* ---------------- empty: say what is actually available ---------------- */}
      {!seg && (
        <div className="absolute inset-0 grid place-items-center px-8 text-center">
          <div className="max-w-3xl">
            <div className="text-[11px] tracking-[0.3em] text-white/50 font-mono">STANDUPIFY TV</div>
            <div className="font-display text-[40px] md:text-[64px] leading-none mt-4">{emptyTitle}</div>
            <p className="text-white/60 mt-4 max-w-xl mx-auto">{emptyDetail}</p>
            <div className="flex flex-wrap justify-center gap-3 mt-7">
              {otherContent && <button onClick={() => switchChannel('best')} className="h-12 rounded-full px-6 bg-[#ffb547] text-[#1d1407] font-semibold">Watch best available</button>}
              {!otherContent && !waitingForShow && !loading && !preview && onOpenEngines && <button onClick={() => { onClose(); onOpenEngines(); }} className="h-12 rounded-full px-6 bg-[#ffb547] text-[#1d1407] font-semibold">Connect engines</button>}
              <button onClick={onClose} className="h-12 rounded-full px-6 border border-white/25 text-white/85 hover:bg-white/10">Return home</button>
            </div>
            {!preview && live.streaming && <p className="font-display text-[22px] md:text-[28px] leading-snug mt-8 text-white/85 caret">{live.streaming.slice(-280)}</p>}
          </div>
        </div>
      )}

      {/* ---------------- slate ---------------- */}
      {seg && phase === 'slate' && (
        <div key={`slate${seg.key}`} className="absolute inset-0 grid place-items-center text-center px-6">
          <div className="animate-in fade-in zoom-in-[0.97] duration-1000">
            <div className="text-[11px] md:text-[12px] tracking-[0.32em] text-[#ffd98a]/80 font-mono uppercase">
              {preview ? 'Preview · sample material' : <>{justIn.has(seg.key) ? 'Just in · ' : ''}{seg.special ? `From the special “${seg.special}”` : `Live at ${seg.club || 'the club'}${seg.night ? ` · night ${seg.night}` : ''}`}</>}
            </div>
            <div className="font-display text-[56px] md:text-[120px] leading-[0.92] mt-5 [text-shadow:0_8px_60px_rgb(0_0_0/.8)]">{seg.name}</div>
            <div className="text-white/70 italic mt-4 text-[16px] md:text-[20px]">{seg.tagline}</div>
            <div className="flex flex-wrap justify-center gap-2 mt-6 text-[11px] font-mono tracking-wider">
              {seg.stage && <span className="px-2.5 py-1 rounded-full border border-[#ffd98a]/50 text-[#ffd98a]">{seg.stage.toUpperCase()}</span>}
              {seg.format && <span className="px-2.5 py-1 rounded-full border border-white/25 text-white/80">{seg.format.toUpperCase()}</span>}
              {seg.record && <span className="px-2.5 py-1 rounded-full border border-white/25 text-white/60">{seg.record}</span>}
              {seg.clips.length > 0 && <span className="px-2.5 py-1 rounded-full bg-[#ff5a43] text-white">ANIMATED · {seg.clips.length} ANGLE{seg.clips.length === 1 ? '' : 'S'}</span>}
            </div>
            <div className="mt-8 font-display text-[22px] md:text-[30px] text-white/90">“{seg.title}”{seg.target ? <span className="text-white/60 text-[18px]"> · roasting {seg.target}</span> : null}</div>
          </div>
        </div>
      )}

      {/* ---------------- the set ---------------- */}
      {seg && phase === 'set' && (
        <>
          <div className="absolute left-6 md:left-12 top-[9vh] flex items-center gap-3 animate-in slide-in-from-left-4 fade-in duration-700">
            <span className={`${preview ? 'bg-[#ffb547] text-[#1d1407]' : 'bg-[#ff5a43] text-white'} text-[10px] font-mono tracking-[0.2em] px-2 py-1`}>{preview ? 'PREVIEW' : 'LIVE'}</span>
            <div>
              <div className="font-display text-[26px] md:text-[34px] leading-none [text-shadow:0_2px_20px_rgb(0_0_0/.9)]">{seg.name}</div>
              <div className="text-[12px] text-white/65 mt-1">“{seg.title}”{seg.club ? ` · ${seg.club}` : ''}</div>
            </div>
          </div>
          <div className="absolute right-6 md:right-12 top-[9vh] flex items-center gap-2">
            {Array.from({ length: Math.min(laughs, 8) }).map((_, i) => <span key={i} className="w-1.5 rounded-full bg-[#ffb547] animate-in zoom-in duration-300" style={{ height: 10 + i * 4 }} />)}
          </div>
          <div className="absolute inset-x-0 bottom-[10vh] px-6 md:px-24">
            <p className="font-display text-center text-[28px] md:text-[48px] leading-[1.15] max-w-5xl mx-auto [text-shadow:0_4px_30px_rgb(0_0_0/.95)]">
              {shown.map((w, k) => {
                const at = lineStart + k;
                return <span key={at} className="transition-all duration-300" style={{ opacity: at <= word ? 1 : 0.22, color: at === word ? '#ffd98a' : undefined }}>{w}{' '}</span>;
              })}
            </p>
          </div>
        </>
      )}

      {/* ---------------- the room reacts ---------------- */}
      {seg && phase === 'laugh' && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center animate-in zoom-in-[0.8] fade-in duration-500">
            {seg.score != null && <div className="font-display text-[110px] md:text-[180px] leading-none text-[#ffd98a] [text-shadow:0_0_80px_rgb(255_181_71/.5)]">{seg.score.toFixed(1)}</div>}
            <div className="text-white/75 tracking-[0.3em] text-[12px] font-mono mt-2">
              {preview ? 'SAMPLE PERFORMANCE' : <>{seg.moments.includes('applause break') ? 'APPLAUSE BREAK' : (seg.crowd ?? 0) >= 7.5 ? 'BIG LAUGH' : (seg.crowd ?? 0) >= 5 ? 'SOLID LAUGH' : 'TOUGH ROOM'}{seg.laughs ? ` · ${seg.laughs} LAUGHS` : ''}</>}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- the verdict ---------------- */}
      {seg && phase === 'verdict' && (
        <div className="absolute inset-x-0 bottom-[10vh] px-6 md:px-16">
          <div className="grid md:grid-cols-3 gap-3 max-w-5xl mx-auto">
            {seg.cards.map((c, i) => (
              <div key={c.judge} className="rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 p-4 animate-in slide-in-from-bottom-4 fade-in duration-700" style={{ animationDelay: `${i * 450}ms`, animationFillMode: 'both' }}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] text-white/60">{judgeName(c.judge)}</span>
                  <span className="font-display text-[34px] leading-none text-[#ffd98a]">{c.score.toFixed(1)}</span>
                </div>
                <div className="font-display italic text-[19px] leading-snug mt-2">“{c.line}”</div>
              </div>
            ))}
          </div>
          {seg.winner && <div className="text-center mt-4 text-[11px] tracking-[0.3em] font-mono text-[#ffd98a]">WON THE NIGHT</div>}
        </div>
      )}

      {/* ---------------- chrome ---------------- */}
      <div className={`absolute inset-x-0 top-0 p-4 md:p-6 flex flex-wrap items-center gap-3 transition-opacity duration-500 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${preview ? 'bg-[#ffb547]' : 'bg-[#ff5a43] breathe'}`} />
          <span className="text-[12px] font-mono tracking-[0.25em]">STANDUPIFY TV</span>
        </div>
        <div className="order-last md:order-none basis-full md:basis-auto md:flex-1 min-w-0 flex gap-1.5 overflow-x-auto md:justify-center">
          {preview ? <span className="text-[11px] text-[#ffd98a] px-3 py-1.5 rounded-full border border-[#ffd98a]/30 bg-black/40">Preview · sample material</span>
            : CHANNELS.map(c => (
              <button key={c.id} title={c.blurb} aria-pressed={channel === c.id} onClick={(e) => { e.stopPropagation(); poke(); switchChannel(c.id); }}
                className={`shrink-0 h-8 px-3 rounded-full text-[12px] transition-colors ${channel === c.id ? 'bg-white text-black font-semibold' : 'bg-black/40 text-white/75 hover:text-white backdrop-blur'}`}>{c.name}</button>
            ))}
        </div>
        <div className="ml-auto md:ml-0 flex items-center gap-1.5 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); poke(); setMutedState(m => !m); }} className="w-9 h-9 rounded-full bg-black/40 backdrop-blur grid place-items-center" aria-label={muted ? 'Turn sound on' : 'Mute'} title={muted ? 'Sound on (M)' : 'Mute (M)'}><Icon name={muted ? 'close' : 'wave'} size={15} /></button>
          <button onClick={(e) => { e.stopPropagation(); poke(); toggleFullscreen(); }} className="w-9 h-9 rounded-full bg-black/40 backdrop-blur grid place-items-center" aria-label="Toggle fullscreen" title="Fullscreen (F)"><Icon name="grid" size={15} /></button>
          <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="w-9 h-9 rounded-full bg-black/40 backdrop-blur grid place-items-center" aria-label="Leave TV" title="Leave (Esc)"><Icon name="close" size={16} /></button>
        </div>
      </div>

      {seg && (
        <div className={`transition-opacity duration-500 ${controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <MadeInComfy url={isClip ? shot : visual} drop="down" className="top-[112px] md:top-[84px] right-4 md:right-6" />
        </div>
      )}

      <div className={`absolute inset-x-0 bottom-0 p-4 md:p-6 flex flex-wrap md:flex-nowrap items-center gap-3 transition-opacity duration-500 ${controlsVisible ? 'opacity-100' : 'opacity-100 md:opacity-0 md:pointer-events-none'}`}>
        <div className="flex items-center gap-1.5 p-1.5 rounded-full border border-white/15 bg-black/65 backdrop-blur-md shrink-0" aria-label="Playback controls">
          <button disabled={!seg} onClick={(e) => { e.stopPropagation(); poke(); advance(-1); }} className="w-10 h-10 rounded-full hover:bg-white/15 grid place-items-center disabled:opacity-30" aria-label="Previous performance" title="Previous (←)"><Icon name="back" size={17} /></button>
          <button disabled={!seg} onClick={(e) => { e.stopPropagation(); poke(); setPaused(p => !p); }} className="w-11 h-11 rounded-full bg-white text-black hover:bg-[#ffd98a] grid place-items-center disabled:opacity-30" aria-label={paused ? 'Resume playback' : 'Pause playback'} title={paused ? 'Play (Space)' : 'Pause (Space)'}><Icon name={paused ? 'play' : 'pause'} size={18} /></button>
          <button disabled={!seg} onClick={(e) => { e.stopPropagation(); poke(); advance(1); }} className="w-10 h-10 rounded-full hover:bg-white/15 grid place-items-center disabled:opacity-30" aria-label="Next performance" title="Next (→)"><Icon name="arrow" size={17} /></button>
        </div>
        {/* Backstage: the engine never stops */}
        <div className="flex flex-1 items-center gap-2.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 pl-3 pr-4 h-10 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${preview ? 'bg-[#ffb547]' : backstage ? 'bg-[#ff5a43] breathe' : state?.live ? 'bg-[#5ee08f]' : 'bg-white/30'}`} />
          <span className="text-[12px] text-white/80 truncate">
            {preview ? 'Sample material · no engines needed' : backstage
              ? <>Backstage · {onStage ? <><b className="font-semibold text-white">{onStage}</b> {live.phase === 'rehearsing' ? `is rehearsing${live.drafts ? ` (draft ${Math.min(live.drafts.done + 1, live.drafts.of)}/${live.drafts.of})` : ''}` : 'is on'}</> : live.note} for {FORMAT_LABEL[live.show!.format]} at {club}</>
              : state?.live ? 'Backstage · the next show is being booked' : 'The Circuit is dark. Reruns only'}
          </span>
        </div>
        {!preview && shooting && (
          <div className="hidden xl:flex items-center gap-2.5 rounded-full bg-black/55 backdrop-blur-md border border-[#ff5a43]/40 pl-1 pr-4 h-10 min-w-0 max-w-[25%]" title="The Reel animates only the best sets and specials">
            {shooting.preview ? <img src={shooting.preview} alt="" className="w-8 h-8 rounded-full object-cover" /> : <span className="w-8 h-8 rounded-full bg-white/10 grid place-items-center"><Icon name="film" size={14} /></span>}
            <span className="text-[12px] text-white/80 truncate">The Reel is shooting <b className="font-semibold text-white">{shooting.label}</b>{shooting.progress > 0 ? ` · ${Math.round(shooting.progress * 100)}%` : ''}</span>
          </div>
        )}
        {next && (
          <button onClick={(e) => { e.stopPropagation(); poke(); advance(1); }} className="hidden lg:flex items-center gap-3 rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 pl-2 pr-4 py-2 text-left hover:bg-black/70 shrink-0">
            {next.headshot ? <img src={next.headshot} alt="" className="w-10 h-10 rounded-full object-cover" /> : <span className="w-10 h-10 rounded-full bg-white/10 grid place-items-center text-[12px] font-semibold">{initials(next.name)}</span>}
            <span>
              <span className="block text-[10px] font-mono tracking-[0.2em] text-white/50">{justIn.has(next.key) ? 'JUST IN' : 'UP NEXT'}</span>
              <span className="block text-[13px] font-medium">{next.name}</span>
              <span className="block text-[11px] text-white/60 max-w-[220px] truncate">“{next.title}”</span>
            </span>
            <Icon name="arrow" size={14} className="text-white/50" />
          </button>
        )}
      </div>

      {paused && <div className="absolute inset-0 grid place-items-center pointer-events-none"><div className="w-20 h-20 rounded-full bg-black/60 grid place-items-center"><Icon name="pause" size={28} /></div></div>}

      {/* progress through the channel */}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
        <div className="h-full bg-[#ffb547] transition-[width] duration-700" style={{ width: queue.length ? `${((index % queue.length) + (phase === 'verdict' ? 0.9 : phase === 'laugh' ? 0.75 : phase === 'set' ? 0.2 + 0.5 * (Math.max(0, word) / Math.max(words.length, 1)) : 0.05)) / queue.length * 100}%` : '0%' }} />
      </div>
    </div>
  );
}
