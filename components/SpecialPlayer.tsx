import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AISettings, Bit, Comedian, Set as ComedySet } from '../types';
import { Capabilities } from '../services/studio';
import { useTasks, runningFor } from '../services/tasks';
import { moveById, venueById } from '../services/comfy/presets';
import { Button, Icon, IconButton, Progress, StageArt, Toggle } from './ui';
import { MadeInComfy } from './ComfyProvenance';
import { CameraMoves } from './CameraMoves';

export interface PlayerActions {
  animate(bitId: number, moveId: string): void;
  voice(bitId: number, force?: boolean): void;
  reshoot(bitId: number): void;
  judge(bitId: number): void;
  cut(bitId: number): void;
  move(bitId: number, dir: -1 | 1): void;
  addBit(instruction: string): Promise<void>;
  riff(): Promise<string>;
  walkOn(): void;
  animateAll(): void;
  exportSpecial(kind: 'html' | 'json'): void;
}

function laughLabel(s: number) {
  return s >= 9 ? 'applause break' : s >= 7.5 ? 'big laugh' : s >= 6 ? 'solid laugh' : s >= 4 ? 'chuckle' : 'crickets';
}

function LaughMeter({ score, compact }: { score: number; compact?: boolean }) {
  const hot = score >= 7.5;
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'glass rounded-full pl-2.5 pr-3.5 h-9'}`}>
      <Icon name="laugh" size={compact ? 13 : 16} className={hot ? 'text-accent' : 'text-muted'} />
      <div className={`${compact ? 'w-10' : 'w-20'} h-1.5 rounded-full bg-white/[0.12] overflow-hidden`}>
        <div className={`h-full rounded-full meter-fill ${hot ? 'bg-accent' : 'bg-white/60'}`} style={{ width: `${score * 10}%` }} />
      </div>
      <span className={`font-mono ${compact ? 'text-[10.5px]' : 'text-[12px]'} ${hot ? 'text-accent' : 'text-muted'}`}>{score.toFixed(1)}</span>
      {!compact && <span className="text-[11px] text-muted hidden md:inline">{laughLabel(score)}</span>}
    </div>
  );
}

/** Captions revealed in step with the narration (or a reading pace without one). */
function Captions({ text, progress }: { text: string; progress: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  const shown = Math.ceil(words.length * Math.min(1, progress));
  // Show a rolling window so long jokes stay two lines tall.
  const start = Math.max(0, shown - 22);
  return (
    <p className="text-[17px] md:text-[22px] leading-snug font-medium text-center max-w-3xl mx-auto [text-shadow:0_2px_12px_rgb(0_0_0/0.9)]">
      {words.slice(start, Math.max(shown, 1)).join(' ')}
    </p>
  );
}

export default function SpecialPlayer({ comedian, set, settings, onSettings, caps, actions, onBack, riffing, onToggleRiff }: {
  comedian: Comedian; set: ComedySet; settings: AISettings; onSettings: (s: AISettings) => void; caps: Capabilities;
  actions: PlayerActions; onBack: () => void; riffing: boolean; onToggleRiff: (v: boolean) => void;
}) {
  const tasks = useTasks();
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<'browse' | 'intro' | 'show'>('browse');
  const [captionProgress, setCaptionProgress] = useState(0);
  const [prompt, setPrompt] = useState('');
  const [writing, setWriting] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);

  const bits = set.bits;
  const bit: Bit | undefined = bits[Math.min(index, bits.length - 1)];
  const venue = venueById(comedian.venue || settings.venue);
  const move = moveById(bit?.cameraMove || settings.cameraMove);
  const bitTasks = bit ? runningFor({ bitId: bit.id }, tasks) : [];
  const videoTask = bitTasks.find(t => t.kind === 'video');
  const imageTask = bitTasks.find(t => t.kind === 'image');
  const audioTask = bitTasks.find(t => t.kind === 'audio');

  useEffect(() => { if (index >= bits.length && bits.length) setIndex(bits.length - 1); }, [bits.length, index]);

  const scored = bits.filter(b => b.laughScore != null);
  const avgLaugh = scored.length ? scored.reduce((a, b) => a + (b.laughScore || 0), 0) / scored.length : null;
  const clips = bits.filter(b => b.videoUrl).length;

  // ------------------------------------------------------------------
  // The show: walk-on → each bit (narration drives the timing) → done
  // ------------------------------------------------------------------
  const startShow = () => {
    setIndex(0);
    setCaptionProgress(0);
    setPlayKey(k => k + 1);
    setMode(comedian.walkOnUrl ? 'intro' : 'show');
  };
  const stopShow = () => {
    setMode('browse');
    audioRef.current?.pause();
    musicRef.current?.pause();
  };

  useEffect(() => {
    if (mode !== 'intro') return;
    const m = musicRef.current;
    if (m) { m.currentTime = 0; m.volume = 0.8; m.play().catch(() => { /* autoplay blocked */ }); }
    const t = setTimeout(() => { m?.pause(); setMode('show'); }, 5500);
    return () => clearTimeout(t);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'show' || !bit) return;
    setCaptionProgress(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    const next = () => {
      timer = setTimeout(() => {
        if (index < bits.length - 1) { setIndex(i => i + 1); setPlayKey(k => k + 1); }
        else setMode('browse');
      }, 1400);                                                     // a beat for the laugh
    };
    const a = audioRef.current;
    if (bit.audioUrl && a) {
      a.src = bit.audioUrl;
      a.currentTime = 0;
      const tick = () => { if (a.duration) setCaptionProgress(a.currentTime / a.duration); raf = requestAnimationFrame(tick); };
      a.onended = () => { setCaptionProgress(1); next(); };
      a.play().then(() => { raf = requestAnimationFrame(tick); }).catch(() => fallback());
    } else fallback();

    function fallback() {
      const ms = Math.max(4000, (bit!.description.length / 16) * 1000);
      const t0 = performance.now();
      const tick = () => {
        const p = (performance.now() - t0) / ms;
        setCaptionProgress(p);
        if (p < 1) raf = requestAnimationFrame(tick); else next();
      };
      raf = requestAnimationFrame(tick);
    }
    return () => { if (timer) clearTimeout(timer); cancelAnimationFrame(raf); if (a) a.onended = null; };
  }, [mode, index, playKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const hear = () => {
    const a = audioRef.current;
    if (!a || !bit?.audioUrl) return;
    if (!a.paused && a.src === bit.audioUrl) { a.pause(); return; }
    a.src = bit.audioUrl; a.currentTime = 0; a.onended = null; a.play().catch(() => { /* ignore */ });
  };

  const submit = async () => {
    const text = prompt.trim();
    if (!text) return;
    setWriting(true);
    try { await actions.addBit(text); setPrompt(''); setIndex(bits.length); } finally { setWriting(false); }
  };

  const suggest = async () => {
    setWriting(true);
    try { setPrompt(await actions.riff()); } finally { setWriting(false); }
  };

  const clipReason = !caps.clips ? caps.reasons.clips : !bit?.imageUrl ? 'Shoot a still first.' : '';
  const stageMedia = useMemo(() => {
    if (!bit) return null;
    if (bit.videoUrl?.startsWith('data:image/')) {
      // Animated WEBP/GIF from ComfyUI builds without SaveVideo.
      return <img key={`a${bit.id}${playKey}`} src={bit.videoUrl} alt={bit.title} className="absolute inset-0 w-full h-full object-cover animate-in fade-in duration-500" />;
    }
    if (bit.videoUrl) {
      return <video key={`v${bit.id}${playKey}`} src={bit.videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover animate-in fade-in duration-500" />;
    }
    if (bit.imageUrl) {
      return (
        <div key={`i${bit.id}${playKey}${move.id}`} className={`absolute inset-0 cam ${mode === 'browse' ? `cam-run ${move.css}` : `cam-play ${move.css}`}`}>
          <img src={bit.imageUrl} alt={bit.title} className="w-full h-full object-cover" draggable={false} />
        </div>
      );
    }
    return <div className="absolute inset-0 opacity-60"><StageArt className="w-full h-full" hue={venue.swatch[0]} /></div>;
  }, [bit?.id, bit?.videoUrl, bit?.imageUrl, playKey, move.id, mode, venue.swatch]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 pt-6 pb-32">
      <audio ref={audioRef} preload="auto" />
      {comedian.walkOnUrl && <audio ref={musicRef} src={comedian.walkOnUrl} preload="auto" />}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <IconButton icon="back" label="Back to studio" onClick={onBack} />
        <div className="w-12 h-12 rounded-full overflow-hidden border border-line shrink-0 bg-raised">
          {comedian.headshotUrl || comedian.avatarImage
            ? <img src={comedian.headshotUrl || comedian.avatarImage} alt="" className="w-full h-full object-cover" />
            : <StageArt className="w-full h-full" hue={venue.swatch[0]} />}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[34px] md:text-[40px] leading-none truncate">{comedian.name}</h1>
          <div className="text-[13px] text-muted truncate mt-1">
            <span className="italic">“{set.title}”</span> · {bits.length} bits · {clips}/{bits.length} clips
            {avgLaugh != null && <> · laugh avg <span className="text-accent font-mono">{avgLaugh.toFixed(1)}</span></>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {caps.music && !comedian.walkOnUrl && <Button size="sm" icon="music" onClick={actions.walkOn}>Walk-on music</Button>}
          {caps.clips && clips < bits.length && <Button size="sm" icon="film" onClick={actions.animateAll}>Animate all</Button>}
          <Button size="sm" icon="download" onClick={() => actions.exportSpecial('html')} title="A single HTML file that plays the whole special offline">Export</Button>
          {mode === 'browse'
            ? <Button variant="primary" icon="play" onClick={startShow} disabled={!bits.length}>Play special</Button>
            : <Button variant="primary" icon="pause" onClick={stopShow}>Stop</Button>}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {/* Stage */}
          <div className="relative aspect-video rounded-[24px] overflow-hidden bg-black border border-line shadow-[0_40px_120px_-40px_rgb(255_181_71/0.25)]">
            {mode === 'intro' ? (
              <div className="absolute inset-0 grid place-items-center animate-in fade-in duration-700"
                style={{ background: `radial-gradient(ellipse at 50% 20%, #ffd9a033, transparent 60%), linear-gradient(160deg, ${venue.swatch[0]}, ${venue.swatch[1]})` }}>
                <div className="text-center px-6">
                  <div className="kicker !text-white/60">Please welcome to the stage</div>
                  <div className="font-display text-[56px] md:text-[96px] leading-none mt-4 animate-in zoom-in-[0.9] fade-in duration-1000">{comedian.name}</div>
                  <div className="text-white/70 italic mt-4">{comedian.tagline}</div>
                </div>
              </div>
            ) : stageMedia}
            {mode !== 'intro' && <MadeInComfy url={bit?.videoUrl || bit?.imageUrl} drop="down" className="top-3 right-3" />}

            {/* Rendering overlay */}
            {(videoTask || imageTask) && mode === 'browse' && (
              <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[2px]">
                {(videoTask || imageTask)!.preview && <img src={(videoTask || imageTask)!.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />}
                <div className="relative glass rounded-2xl px-5 py-4 w-[min(80%,340px)]">
                  <div className="text-[13px] font-medium">{(videoTask || imageTask)!.label}</div>
                  <div className="text-[11px] text-muted font-mono mt-0.5">{(videoTask || imageTask)!.stage || 'in line'}</div>
                  <Progress value={(videoTask || imageTask)!.progress} className="mt-2.5" />
                </div>
              </div>
            )}

            {/* Overlays */}
            {mode !== 'intro' && bit && (
              <>
                <div className="absolute inset-x-0 top-0 p-4 flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent">
                  <div className="glass rounded-full h-9 px-3.5 flex items-center gap-2 text-[12px]">
                    <span className="font-mono text-muted">{String(index + 1).padStart(2, '0')}/{String(bits.length).padStart(2, '0')}</span>
                    <span className="font-medium truncate max-w-[40vw]">{bit.title}</span>
                  </div>
                  {bit.laughScore != null && <LaughMeter score={bit.laughScore} />}
                </div>
                <div className="absolute inset-x-0 bottom-0 px-6 pb-6 pt-16 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
                  {mode === 'show'
                    ? <Captions text={bit.description} progress={captionProgress} />
                    : <p className="text-[15px] md:text-[17px] leading-snug text-center max-w-3xl mx-auto text-white/90 [text-shadow:0_2px_12px_rgb(0_0_0/0.9)]">{bit.description}</p>}
                  {mode === 'show' && <div className="max-w-md mx-auto mt-4"><Progress value={(index + captionProgress) / bits.length} /></div>}
                </div>
                {mode === 'show' && index === 0 && captionProgress < 0.25 && (
                  <div className="absolute left-6 bottom-28 animate-in slide-in-from-left-4 fade-in duration-700">
                    <div className="bg-accent text-accent-ink px-3 py-1 text-[11px] font-mono tracking-widest uppercase">Live</div>
                    <div className="bg-black/80 px-4 py-2"><div className="font-display text-[28px] leading-none">{comedian.name}</div><div className="text-[12px] text-white/70 mt-1">{set.title}</div></div>
                  </div>
                )}
              </>
            )}
            {!bit && <div className="absolute inset-0 grid place-items-center text-muted text-sm">No bits yet. Write one below.</div>}
          </div>

          {/* Bit actions */}
          {bit && mode === 'browse' && (
            <div className="card p-4 md:p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" icon="film" disabled={!!clipReason || !!videoTask} title={clipReason || undefined}
                  onClick={() => actions.animate(bit.id, settings.cameraMove)}>
                  {videoTask ? 'Animating…' : bit.videoUrl ? `Re-shoot as ${moveById(settings.cameraMove).name}` : `Animate · ${moveById(settings.cameraMove).name}`}
                </Button>
                {bit.audioUrl
                  ? <Button icon="wave" onClick={hear}>Hear it</Button>
                  : <Button icon="wave" disabled={!caps.voice || !!audioTask} title={caps.voice ? undefined : caps.reasons.voice} onClick={() => actions.voice(bit.id)}>{audioTask ? 'Recording…' : 'Voice it'}</Button>}
                <Button icon="camera" disabled={!caps.stills || !!imageTask} title={caps.stills ? undefined : caps.reasons.stills} onClick={() => actions.reshoot(bit.id)}>{imageTask ? 'Shooting…' : bit.imageUrl ? 'Reshoot' : 'Shoot still'}</Button>
                <Button icon="laugh" disabled={!caps.write} onClick={() => actions.judge(bit.id)}>Laugh meter</Button>
                <div className="ml-auto flex items-center">
                  <IconButton icon="back" label="Move earlier" className="rotate-90" disabled={index === 0} onClick={() => { actions.move(bit.id, -1); setIndex(i => i - 1); }} />
                  <IconButton icon="back" label="Move later" className="-rotate-90" disabled={index >= bits.length - 1} onClick={() => { actions.move(bit.id, 1); setIndex(i => i + 1); }} />
                  {bit.audioUrl && <IconButton icon="redo" label="Record the voice again" onClick={() => actions.voice(bit.id, true)} />}
                  <IconButton icon="trash" label="Cut this bit" onClick={() => actions.cut(bit.id)} />
                </div>
              </div>
              {bit.laughNote && (
                <div className="text-[13px] text-muted flex gap-2"><Icon name="sparkle" size={14} className="text-accent mt-0.5 shrink-0" /><span><span className="text-text">Booker's note:</span> {bit.laughNote}</span></div>
              )}
              <div>
                <div className="kicker mb-2">Camera move {bit.videoUrl && bit.cameraMove ? <span className="normal-case tracking-normal text-dim">· clip shot as {moveById(bit.cameraMove).name}</span> : null}</div>
                <CameraMoves compact value={settings.cameraMove} onChange={id => onSettings({ ...settings, cameraMove: id })} image={bit.imageUrl} hue={venue.swatch[0]} />
              </div>
            </div>
          )}

          {/* Next bit */}
          <div className="card p-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <input value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                disabled={writing || !caps.write}
                placeholder={caps.write ? 'What is the next bit about? Use @material for callbacks…' : 'Start Nightshift to keep writing'}
                className="flex-1 min-w-0 h-12 bg-transparent outline-none px-3 text-[15px] placeholder:text-dim" />
              <Button variant="quiet" icon="dice" onClick={suggest} disabled={writing || !caps.write} title="Let Nightshift pitch the next bit" className="!px-3 sm:!px-4"><span className="hidden sm:inline">Riff</span></Button>
              <Button variant="primary" icon={writing ? undefined : 'plus'} onClick={submit} disabled={writing || !prompt.trim() || !caps.write}>{writing ? 'Writing…' : 'Add bit'}</Button>
            </div>
            <div className="flex items-center gap-2 px-1.5 overflow-x-auto">
              {comedian.profile.material.slice(0, 10).map(m => (
                <button key={m.id} onClick={() => setPrompt(p => `${p}${p && !p.endsWith(' ') ? ' ' : ''}@${m.name} `)} title={m.description}
                  className="shrink-0 h-7 px-2.5 rounded-full text-[12px] text-muted hover:text-text bg-white/[0.04] border border-line">
                  <span className="text-accent/80">@</span>{m.name}
                </button>
              ))}
              <label className="ml-auto shrink-0 flex items-center gap-2 text-[12px] text-muted pl-3">
                Keep riffing <Toggle on={riffing} onChange={onToggleRiff} label="Keep riffing" />
              </label>
            </div>
          </div>
        </div>

        {/* Bit rail */}
        <aside className="flex flex-col gap-2 xl:max-h-[calc(100vh-140px)] xl:overflow-y-auto xl:sticky xl:top-20 pr-1">
          <div className="kicker px-1 mb-1">The set</div>
          {bits.map((b, i) => {
            const t = runningFor({ bitId: b.id }, tasks)[0];
            const active = i === index;
            return (
              <button key={b.id} onClick={() => { setIndex(i); if (mode !== 'browse') stopShow(); }}
                className={`flex gap-3 p-2 rounded-2xl text-left transition-all ${active ? 'bg-white/[0.07] ring-1 ring-accent/50' : 'hover:bg-white/[0.04]'}`}>
                <div className="relative w-[104px] aspect-video rounded-xl overflow-hidden bg-raised shrink-0">
                  {b.imageUrl ? <img src={t?.preview || b.imageUrl} alt="" className="w-full h-full object-cover" /> : t?.preview ? <img src={t.preview} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full shimmer" />}
                  {b.videoUrl && <span className="absolute bottom-1 left-1 bg-black/70 rounded px-1 text-[9px] font-mono flex items-center gap-0.5"><Icon name="play" size={8} />CLIP</span>}
                  {t && <div className="absolute inset-x-1.5 bottom-1.5"><Progress value={t.progress} /></div>}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                  <div className="text-[13px] font-medium leading-tight line-clamp-2">{b.title}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {b.laughScore != null && <LaughMeter compact score={b.laughScore} />}
                    {b.audioUrl && <Icon name="wave" size={12} className="text-muted" />}
                  </div>
                  {t && <div className="text-[10.5px] text-accent font-mono mt-1 truncate">{t.kind === 'video' ? 'animating' : t.kind === 'audio' ? 'recording' : t.kind === 'image' ? 'shooting' : 'grading'}…</div>}
                </div>
              </button>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
