import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Comedian, Set as ComedySet } from '../types';
import type { CameraId, Production, Shot } from '../services/premium/types';
import { CAMERAS, clipFor, countWords, laughSeconds, runningOrder, shotAt, type Cue } from '../services/premium/director';
import { applause, laugh, paceWords, setMuted, speak, startRoom, stopRoom, sting, unlockSound, hasSpeech } from '../services/tv/sound';
import { Icon } from './ui';
import { MadeInComfy } from './ComfyProvenance';

// =====================================================================
// The theater — an Original plays like a streaming special: network
// ident, title over the house, walk-on to applause, then a live
// multi-camera cut that follows the beat (setups on the master, punches
// on the close-up, laughs on the crowd), the comic's own voice, a room
// that laughs where the jokes land, the bow, and the credits.
// =====================================================================

const MOVE: Record<CameraId, string> = {
  master: 'cam-locked-off', medium: 'cam-dolly-in', close: 'cam-dolly-in', left: 'cam-orbit', right: 'cam-orbit',
  wide: 'cam-dolly-in', jib: 'cam-crane-up', crowd: 'cam-handheld'
};

type Overlay = 'ident' | 'title' | 'walkon' | 'bow' | 'credits' | null;

function fmt(s: number) { const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }

/** Waits `ms` of unpaused time. */
function wait(ms: number, signal: AbortSignal, paused: () => boolean, onTick?: (p: number) => void): Promise<void> {
  return new Promise(resolve => {
    let t = 0;
    const id = setInterval(() => {
      if (signal.aborted) { clearInterval(id); resolve(); return; }
      if (paused()) return;
      t += 50;
      onTick?.(Math.min(1, t / ms));
      if (t >= ms) { clearInterval(id); resolve(); }
    }, 50);
  });
}

function Stage({ prod, shot, grade }: { prod: Production; shot: Shot | null; grade: string }) {
  const [ready, setReady] = useState(false);
  const plate = shot ? (prod.plates.find(p => p.camera === shot.camera)?.imageUrl || prod.plates.find(p => p.camera === 'master')?.imageUrl) : undefined;
  const clip = shot ? clipFor(prod, shot) : null;
  useEffect(() => { setReady(false); }, [shot?.id, clip?.url]);
  if (!shot) return <div className="absolute inset-0 bg-black" />;
  return (
    <div className="absolute inset-0 overflow-hidden bg-black" style={{ filter: grade }}>
      {plate && (
        <div key={`p${shot.id}`} className={`absolute inset-0 cam cam-play ${MOVE[shot.camera]}`} style={{ animationDuration: `${Math.max(2, shot.seconds + 1)}s` }}>
          <img src={plate} alt="" className="w-full h-full object-cover" draggable={false} />
        </div>
      )}
      {clip && /^data:image\/|\.(gif|webp)(\?|$)/i.test(clip.url) && (
        // Animated WEBP/GIF from ComfyUI builds without SaveVideo.
        <img key={`a${shot.id}${clip.url.slice(-24)}`} src={clip.url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      )}
      {clip && !/^data:image\/|\.(gif|webp)(\?|$)/i.test(clip.url) && (
        <video key={`v${shot.id}${clip.url.slice(-24)}`} src={clip.url} muted autoPlay playsInline loop preload="auto"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const spare = Math.max(0, v.duration - shot.seconds);
            v.currentTime = clip.offset * spare;
            // A clip a little short of the shot plays a touch slower rather than looping into view.
            v.playbackRate = v.duration && v.duration < shot.seconds ? Math.max(0.7, v.duration / shot.seconds) : 1;
          }}
          onPlaying={() => setReady(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${ready ? 'opacity-100' : 'opacity-0'}`} />
      )}
    </div>
  );
}

export default function PremiumTheater({ comedian, set, onClose }: { comedian: Comedian; set: ComedySet; onClose: () => void }) {
  const prod = set.premium!;
  const prodRef = useRef(prod);
  prodRef.current = prod;
  const cues = useMemo(() => runningOrder(prod), [prod.script, prod.shots.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  const starts = useMemo(() => { let t = 0; return cues.map(c => { const s = t; t += c.seconds; return s; }); }, [cues]);
  const total = starts.length ? starts[starts.length - 1] + cues[cues.length - 1].seconds : 0;
  const chapterWords = useMemo(() => (prod.script?.chapters || []).map(ch => ch.beats.reduce((a, b) => a + countWords(b.line), 0)), [prod.script]);
  const bible = prod.bible;
  const palette = bible?.palette || ['#ffb547', '#123844', '#07141a'];
  const grade = 'contrast(1.07) saturate(1.08) brightness(0.98)';

  const [cueIndex, setCueIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [shot, setShot] = useState<Shot | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('ident');
  const [caption, setCaption] = useState<{ words: string[]; shown: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [cc, setCc] = useState(false);
  const [muted, setMute] = useState(false);
  const [chrome, setChrome] = useState(true);
  const pausedRef = useRef(false);
  const runRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const who = useMemo(() => ({ id: comedian.id, look: comedian.look }), [comedian.id, comedian.look]);

  const isPaused = () => pausedRef.current;

  // ------------------------------------------------------------------
  // one cue at a time
  // ------------------------------------------------------------------
  const playLine = useCallback(async (cue: Extract<Cue, { kind: 'beat' }>, signal: AbortSignal) => {
    const words = cue.beat.line.split(/\s+/).filter(Boolean);
    const onWord = (i: number) => {
      const p = Math.min(1, (i + 1) / words.length);
      setProgress(p * 0.85);
      setShot(shotAt(cue.line, p));
      setCaption({ words, shown: i + 1 });
    };
    setShot(cue.line[0] || null);
    setCaption({ words, shown: 0 });
    const ch = prodRef.current.script!.chapters[cue.chapter];
    const a = audioRef.current;
    if (ch.audioUrl && a) {
      // The chapter's recording: play this beat's slice of it, then hold for the laugh.
      if (a.dataset.chapter !== ch.id) { a.src = ch.audioUrl; a.dataset.chapter = ch.id; await new Promise<void>(r => { a.onloadedmetadata = () => r(); setTimeout(r, 4000); }); }
      const dur = a.duration || ch.audioSeconds || 0;
      const chWords = chapterWords[cue.chapter] || 1;
      if (dur && dur > chWords / 6) {
        const start = (dur * cue.wordsBefore) / chWords, end = (dur * (cue.wordsBefore + words.length)) / chWords;
        if (Math.abs(a.currentTime - start) > 0.35) a.currentTime = start;
        try { await a.play(); } catch { /* blocked: fall through to the system voice below */ }
        if (!a.paused) {
          await new Promise<void>(resolve => {
            const tick = () => {
              if (signal.aborted) { a.pause(); resolve(); return; }
              if (pausedRef.current) { if (!a.paused) a.pause(); requestAnimationFrame(tick); return; }
              if (a.paused) a.play().catch(() => { /* ignore */ });
              const p = Math.max(0, Math.min(1, (a.currentTime - start) / Math.max(0.3, end - start)));
              onWord(Math.floor(p * words.length) - 1);
              if (a.currentTime >= end - 0.03 || a.ended) { a.pause(); resolve(); return; }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return;
        }
      }
    }
    if (hasSpeech() && !muted) await speak(cue.beat.line, who, onWord, signal);
    else await paceWords(words.length, onWord, signal, 2.55, isPaused);
  }, [chapterWords, who, muted]);

  const runFrom = useCallback(async (start: number) => {
    runRef.current?.abort();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    const ctl = new AbortController();
    runRef.current = ctl;
    const signal = ctl.signal;
    for (let i = start; i < cues.length && !signal.aborted; i++) {
      const cue = cues[i];
      setCueIndex(i);
      setProgress(0);
      const tick = (p: number) => setProgress(p);
      switch (cue.kind) {
        case 'ident':
          setOverlay('ident'); setShot(null); setCaption(null);
          sting();
          await wait(cue.seconds * 1000, signal, isPaused, tick);
          break;
        case 'title':
          setOverlay('title'); setCaption(null);
          startRoom();
          setShot(cue.shots[0] || null);
          await wait(cue.seconds * 1000, signal, isPaused, tick);
          break;
        case 'walkon': {
          setOverlay('walkon'); setCaption(null);
          applause(cue.seconds * 0.8, 9);
          const m = musicRef.current;
          if (m) { m.currentTime = 0; m.volume = 0.7; m.play().catch(() => { /* ignore */ }); }
          await wait(cue.seconds * 1000, signal, isPaused, p => { tick(p); setShot(shotAt(cue.shots, p)); });
          m?.pause();
          break;
        }
        case 'beat': {
          setOverlay(i === cues.findIndex(c => c.kind === 'beat') ? 'walkon' : null);
          await playLine(cue, signal);
          if (signal.aborted) break;
          setOverlay(null);
          const secs = laughSeconds(cue.beat);
          if (secs >= 0.5) {
            if (cue.beat.laugh >= 4 && !muted) laugh(cue.beat.laugh);
            if (cue.beat.laugh >= 9 && !muted) applause(secs * 0.8, 6);
            await wait(secs * 1000, signal, isPaused, p => { setProgress(0.85 + p * 0.15); if (cue.laugh.length) setShot(shotAt(cue.laugh, p)); });
          }
          setCaption(null);
          break;
        }
        case 'bow':
          setOverlay('bow'); setCaption(null);
          applause(cue.seconds, 10);
          await wait(cue.seconds * 1000, signal, isPaused, p => { tick(p); setShot(shotAt(cue.shots, p)); });
          break;
        case 'credits':
          setOverlay('credits'); setShot(null);
          stopRoom();
          await wait(cue.seconds * 1000, signal, isPaused, tick);
          break;
      }
    }
    if (!signal.aborted) { setPlaying(false); pausedRef.current = true; }
  }, [cues, playLine, muted]);

  // ------------------------------------------------------------------
  // transport
  // ------------------------------------------------------------------
  const begin = async () => {
    await unlockSound();
    setStarted(true);
    setPlaying(true);
    pausedRef.current = false;
    setCc(!hasSpeech() && !(prod.script?.chapters.some(c => c.audioUrl)));
    void runFrom(0);
  };
  const toggle = () => {
    if (!started) { void begin(); return; }
    const next = !playing;
    setPlaying(next);
    pausedRef.current = !next;
    try { if (next) window.speechSynthesis?.resume(); else window.speechSynthesis?.pause(); } catch { /* ignore */ }
    if (next && cueIndex >= cues.length - 1 && progress >= 1) void runFrom(0);
  };
  const seekCue = (i: number) => {
    const k = Math.max(0, Math.min(cues.length - 1, i));
    pausedRef.current = false;
    setPlaying(true);
    setStarted(true);
    void runFrom(k);
  };
  const chapterStarts = useMemo(() => cues.map((c, i) => (c.kind === 'beat' && c.index === 0 ? i : -1)).filter(i => i >= 0), [cues]);
  const chapterOf = (i: number) => { let ch = -1; for (const [k, s] of chapterStarts.entries()) if (i >= s) ch = k; return ch; };
  const skip = (dir: -1 | 1) => {
    const ch = chapterOf(cueIndex);
    const target = dir === 1 ? chapterStarts[ch + 1] ?? cues.length - 2 : chapterStarts[Math.max(0, ch - (progress < 0.2 && cues[cueIndex]?.kind === 'beat' && (cues[cueIndex] as any).index === 0 ? 1 : 0))] ?? 0;
    seekCue(target);
  };
  const seekTime = (t: number) => { let i = 0; while (i < starts.length - 1 && starts[i + 1] <= t) i++; seekCue(i); };

  useEffect(() => { setMuted(muted); }, [muted]);
  useEffect(() => () => {
    runRef.current?.abort();
    stopRoom();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    audioRef.current?.pause();
    musicRef.current?.pause();
  }, []);

  // Chrome hides while you watch; any movement brings it back.
  useEffect(() => {
    if (!playing) { setChrome(true); return; }
    let t = setTimeout(() => setChrome(false), 2800);
    const wake = () => { setChrome(true); clearTimeout(t); t = setTimeout(() => setChrome(false), 2800); };
    window.addEventListener('mousemove', wake);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); };
  }, [playing]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') skip(1);
      else if (e.key === 'ArrowLeft') skip(-1);
      else if (e.key === 'c') setCc(v => !v);
      else if (e.key === 'm') setMute(v => !v);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const elapsed = (starts[cueIndex] || 0) + (cues[cueIndex]?.seconds || 0) * progress;
  const chapters = prod.script?.chapters || [];
  const city = bible?.city || '';
  const live = prod.shots.filter(s => s.clipUrl).length;

  return (
    <div ref={rootRef} className="fixed inset-0 z-[80] bg-black text-white select-none" style={{ cursor: chrome ? 'default' : 'none' }}>
      <audio ref={audioRef} preload="auto" />
      {comedian.walkOnUrl && <audio ref={musicRef} src={comedian.walkOnUrl} preload="auto" />}

      <div className="absolute inset-0 grid place-items-center">
        <div className="relative w-full max-h-full aspect-video overflow-hidden">
          <Stage prod={prod} shot={shot} grade={grade} />
          {/* Lens: vignette + grain, the same on every camera. */}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 75% 70% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.55) 100%)' }} />
          <div className="absolute inset-0 pointer-events-none opacity-[0.07] mix-blend-overlay originals-grain" />

          {overlay === 'ident' && (
            <div className="absolute inset-0 grid place-items-center bg-black animate-in fade-in duration-700">
              <div className="text-center">
                <div className="mx-auto w-14 h-14 rounded-[14px] grid place-items-center animate-in zoom-in-50 duration-700" style={{ background: palette[0], color: '#1d1407' }}><Icon name="mic" size={28} /></div>
                <div className="mt-5 font-mono text-[12px] tracking-[0.5em] text-white/80 animate-in fade-in slide-in-from-bottom-2 duration-1000">STANDUPIFY ORIGINAL</div>
              </div>
            </div>
          )}
          {overlay === 'title' && (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/50 via-transparent to-black/70">
              <div className="text-center px-8 animate-in fade-in zoom-in-[0.96] duration-[1800ms]">
                <div className="font-mono text-[11px] md:text-[13px] tracking-[0.45em] text-white/70">{comedian.name.toUpperCase()}</div>
                <h1 className="font-display text-[56px] md:text-[112px] leading-[0.9] mt-4 [text-shadow:0_8px_60px_rgb(0_0_0/0.8)]" style={{ color: '#fff7ea' }}>{set.title.replace(new RegExp(`^${comedian.name}:\\s*`), '')}</h1>
                {bible && <div className="mt-5 text-[13px] md:text-[15px] tracking-[0.3em] uppercase" style={{ color: palette[0] }}>Live from {bible.theater} · {city}</div>}
              </div>
            </div>
          )}
          {overlay === 'walkon' && (
            <div className="absolute left-[5%] bottom-[12%] animate-in slide-in-from-left-6 fade-in duration-700">
              <div className="h-[3px] w-16 mb-3" style={{ background: palette[0] }} />
              <div className="font-display text-[34px] md:text-[52px] leading-none [text-shadow:0_4px_30px_rgb(0_0_0/0.9)]">{comedian.name}</div>
              <div className="font-mono text-[11px] tracking-[0.3em] uppercase text-white/75 mt-2">{set.title} · Live{city ? ` in ${city}` : ''}</div>
            </div>
          )}
          {overlay === 'credits' && (
            <div className="absolute inset-0 bg-black overflow-hidden">
              {prod.keyArt && <img src={prod.keyArt} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20 blur-sm scale-105" />}
              <div className="absolute inset-x-0 top-full originals-credits text-center" style={{ animationDuration: `${cues[cues.length - 1]?.seconds || 16}s` }}>
                <div className="font-display text-[54px] leading-none">{set.title}</div>
                <div className="text-white/60 mt-3 italic max-w-xl mx-auto px-6">{set.logline}</div>
                {[
                  ['Starring', comedian.name],
                  ['Written by', `${comedian.name} & the Nightshift writers' room${prod.script?.simulated ? ' (from the Circuit tapes)' : ''}`],
                  ['Recorded live at', bible ? `${bible.theater}, ${bible.city}` : 'the theater'],
                  ['Production design', bible?.stage || ''],
                  ['Director of photography', `ComfyUI · ${prod.rig?.plates || 'stills'} plates · ${prod.rig?.clips || 'clips'} cameras`],
                  ['Color', bible?.grade || ''],
                  ['Finishing', (prod.rig?.finishing || []).join(' · ') || 'Standupify'],
                  ['Coverage', `${prod.shots.length} shots · eight cameras · ${live} rendered`],
                  ['Audience', bible?.crowd || ''],
                  ['A Standupify Original', 'Made entirely on one local GPU']
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={k} className="mt-9">
                    <div className="font-mono text-[11px] tracking-[0.35em] uppercase" style={{ color: palette[0] }}>{k}</div>
                    <div className="text-[18px] mt-1.5 max-w-2xl mx-auto px-6">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {cc && caption && (
            <div className="absolute inset-x-0 bottom-[7%] px-6 text-center pointer-events-none">
              <span className="inline bg-black/70 px-2 py-1 text-[18px] md:text-[24px] leading-[1.6] box-decoration-clone">
                {caption.words.slice(Math.max(0, caption.shown - 16), Math.max(1, caption.shown)).join(' ')}
              </span>
            </div>
          )}

          {!started && (
            <button onClick={begin} className="absolute inset-0 group">
              {prod.keyArt && <img src={prod.keyArt} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: grade }} />}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />
              <div className="absolute left-[6%] bottom-[12%] text-left max-w-2xl">
                <div className="font-mono text-[11px] tracking-[0.45em]" style={{ color: palette[0] }}>STANDUPIFY ORIGINAL</div>
                <div className="font-display text-[48px] md:text-[84px] leading-[0.92] mt-3">{set.title}</div>
                <div className="text-white/75 mt-3 text-[15px] md:text-[17px]">{set.logline}</div>
                <div className="flex items-center gap-4 mt-6">
                  <span className="h-12 pl-5 pr-6 rounded-full bg-white text-black font-semibold flex items-center gap-2 group-hover:scale-[1.03] transition-transform"><Icon name="play" size={18} />Play</span>
                  <span className="text-white/60 text-[13px] font-mono">{Math.round(total / 60)} min · {chapters.length} chapters · 8 cameras{prod.stage !== 'premiered' ? ' · rough cut' : ''}</span>
                </div>
              </div>
            </button>
          )}
        </div>
      </div>

      {started && shot && (
        <div className={`transition-opacity duration-500 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <MadeInComfy drop="down" className="top-[76px] right-5"
            url={clipFor(prod, shot)?.url || prod.plates.find(p => p.camera === shot.camera)?.imageUrl || prod.plates.find(p => p.camera === 'master')?.imageUrl} />
        </div>
      )}

      {/* Chrome */}
      <div className={`absolute inset-x-0 top-0 p-5 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-500 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center" aria-label="Close"><Icon name="back" /></button>
        <div className="min-w-0">
          <div className="font-display text-[22px] leading-none truncate">{set.title}</div>
          <div className="text-[12px] text-white/60 mt-1 truncate">{comedian.name}{bible ? ` · ${bible.theater}` : ''}{shot ? ` · ${CAMERAS[shot.camera].name}` : ''}</div>
        </div>
      </div>
      {started && (
        <div className={`absolute inset-x-0 bottom-0 px-5 pb-5 pt-16 bg-gradient-to-t from-black/90 to-transparent transition-opacity duration-500 ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="relative h-1.5 rounded-full bg-white/15 cursor-pointer group" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekTime(((e.clientX - r.left) / r.width) * total); }}>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(elapsed / Math.max(1, total)) * 100}%`, background: palette[0] }} />
            {chapterStarts.map((ci, k) => (
              <div key={ci} title={chapters[k]?.title} className="absolute top-0 bottom-0 w-[3px] bg-black/70" style={{ left: `${(starts[ci] / Math.max(1, total)) * 100}%` }} />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={toggle} className="w-11 h-11 rounded-full bg-white text-black grid place-items-center" aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button>
            <button onClick={() => skip(-1)} className="w-10 h-10 rounded-full hover:bg-white/10 grid place-items-center" aria-label="Previous chapter"><Icon name="back" /></button>
            <button onClick={() => skip(1)} className="w-10 h-10 rounded-full hover:bg-white/10 grid place-items-center rotate-180" aria-label="Next chapter"><Icon name="back" /></button>
            <span className="font-mono text-[12px] text-white/70 ml-2">{fmt(elapsed)} / {fmt(total)}</span>
            <span className="text-[12px] text-white/50 ml-3 truncate hidden md:inline">{chapterOf(cueIndex) >= 0 ? chapters[chapterOf(cueIndex)]?.title : ''}</span>
            <div className="ml-auto flex items-center gap-1">
              <button onClick={() => setCc(v => !v)} className={`h-9 px-3 rounded-full text-[12px] font-mono ${cc ? 'bg-white text-black' : 'hover:bg-white/10 text-white/80'}`}>CC</button>
              <button onClick={() => setMute(v => !v)} className="h-9 px-3 rounded-full text-[12px] hover:bg-white/10 text-white/80">{muted ? 'Unmute' : 'Mute'}</button>
              <button onClick={() => (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen())?.catch?.(() => { /* ignore */ })} className="h-9 px-3 rounded-full text-[12px] hover:bg-white/10 text-white/80">Full screen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
