import React, { useEffect, useRef } from 'react';
import { Comedian, Set as ComedySet } from '../types';
import { useTasks, runningFor } from '../services/tasks';
import { venueById } from '../services/comfy/presets';
import { Button, Icon, Progress, StageArt } from './ui';

export type CastPhase = 'writing' | 'shooting' | 'done' | 'failed';

/** Pull what is already legible out of a half-written JSON answer. */
function peek(text: string) {
  const field = (k: string) => text.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))?.[1];
  const bitsAt = text.indexOf('"bits"');
  const titles = bitsAt === -1 ? [] : [...text.slice(bitsAt).matchAll(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1]);
  const jokes = bitsAt === -1 ? [] : [...text.slice(bitsAt).matchAll(/"description"\s*:\s*"((?:[^"\\]|\\.)*)/g)].map(m => m[1]);
  const material = [...text.matchAll(/"type"\s*:\s*"(PERSONA|PROP|VENUE|THEME|BIT|CATCHPHRASE)"/g)].length;
  return { name: field('name'), tagline: field('tagline'), voice: field('voice'), setTitle: field('setTitle'), titles, jokes, material };
}

function Frame({ label, src, preview, progress, stage, hue, tall }: { label: string; src?: string; preview?: string; progress?: number; stage?: string; hue: string; tall?: boolean }) {
  const shooting = !src && progress != null;
  return (
    <div className={`relative rounded-2xl overflow-hidden border border-line bg-raised ${tall ? 'aspect-[4/5]' : 'aspect-[4/3]'}`}>
      {src ? <img src={src} alt={label} className="absolute inset-0 w-full h-full object-cover animate-in fade-in zoom-in-[1.04] duration-700" />
        : preview ? <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover blur-[1px] opacity-90" />
        : <div className="absolute inset-0 opacity-40"><StageArt className="w-full h-full" hue={hue} /></div>}
      {!src && <div className={`absolute inset-0 ${shooting ? '' : 'shimmer'}`} />}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 to-transparent">
        <div className="text-[12px] font-medium truncate">{label}</div>
        {shooting && <><div className="text-[10.5px] text-white/60 font-mono truncate">{stage || 'in line'}</div><Progress value={progress!} className="mt-1.5" /></>}
      </div>
      {src && <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-ok/90 text-ink grid place-items-center"><Icon name="check" size={11} /></span>}
    </div>
  );
}

export default function CastingView({ phase, writing, comedian, set, error, onWatch, onRetry, onBack }: {
  phase: CastPhase; writing: string; comedian: Comedian | null; set: ComedySet | null; error?: string | null;
  onWatch: () => void; onRetry: () => void; onBack: () => void;
}) {
  const tasks = useTasks();
  const streamRef = useRef<HTMLPreElement>(null);
  useEffect(() => { streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight }); }, [writing]);

  const p = peek(writing);
  const name = comedian?.name || p.name;
  const tagline = comedian?.tagline || p.tagline;
  const hue = venueById(comedian?.venue).swatch[0];
  const bitTitles = set?.bits.map(b => b.title) || p.titles;
  const shot = set?.bits.filter(b => b.imageUrl).length || 0;
  const total = set?.bits.length || 4;

  const live = (bitId?: number) => {
    const t = runningFor({ bitId }, tasks)[0];
    return t ? { preview: t.preview, progress: t.progress, stage: t.stage } : {};
  };
  const headshotTask = comedian ? tasks.find(t => t.status === 'running' && t.ref?.comedianId === comedian.id && t.ref.bitId == null && t.kind === 'image') : undefined;

  const steps: { key: string; label: string; done: boolean; active: boolean }[] = [
    { key: 'write', label: 'Writing the act', done: phase !== 'writing', active: phase === 'writing' },
    { key: 'shoot', label: `Shooting stills ${set ? `${shot}/${total}` : ''}`, done: phase === 'done', active: phase === 'shooting' },
    { key: 'show', label: 'Special ready', done: phase === 'done', active: false }
  ];

  return (
    <div className="max-w-[1300px] mx-auto px-4 md:px-8 pt-8 pb-28">
      <button onClick={onBack} className="text-muted hover:text-text text-sm inline-flex items-center gap-2 mb-6"><Icon name="back" size={15} />Studio</button>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 items-start">
        {/* Writers' room */}
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {steps.map(s => (
              <div key={s.key} className={`flex items-center gap-3 text-sm ${s.done ? 'text-text' : s.active ? 'text-text' : 'text-dim'}`}>
                <span className={`w-5 h-5 rounded-full grid place-items-center ${s.done ? 'bg-ok/15 text-ok' : s.active ? 'bg-accent-soft text-accent' : 'bg-white/[0.05]'}`}>
                  {s.done ? <Icon name="check" size={11} /> : s.active ? <span className="w-1.5 h-1.5 rounded-full bg-accent breathe" /> : null}
                </span>
                {s.label}
              </div>
            ))}
          </div>

          <div className="card p-6 min-h-[260px]">
            <div className="kicker">{phase === 'writing' ? 'Nightshift is writing' : 'Now appearing'}</div>
            <h1 className={`font-display text-[52px] md:text-[64px] leading-[0.95] mt-3 ${name ? '' : 'text-dim'}`}>
              {name || <span className="caret">Somebody</span>}
            </h1>
            {tagline && <p className="text-muted mt-3 text-[15px] italic">“{tagline}”</p>}
            {p.voice && !comedian && <p className="text-[12px] text-dim mt-2 font-mono">{p.voice}</p>}
            <div className="mt-6 flex flex-col gap-2.5">
              {bitTitles.map((t, i) => (
                <div key={i} className="flex gap-3 items-baseline rise">
                  <span className="font-mono text-[11px] text-dim w-5">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium">{t}</div>
                    {(set?.bits[i]?.description || p.jokes[i]) && (
                      <div className="text-[13px] text-muted leading-snug line-clamp-2">{set?.bits[i]?.description || p.jokes[i]}</div>
                    )}
                  </div>
                </div>
              ))}
              {phase === 'writing' && <div className="h-4 w-40 rounded shimmer" />}
            </div>
            {p.material > 0 && phase === 'writing' && <div className="text-[11px] text-dim font-mono mt-4">{p.material} pieces of material so far</div>}
          </div>

          {writing && phase === 'writing' && (
            <pre ref={streamRef} className="max-h-36 overflow-y-auto text-[10.5px] leading-relaxed font-mono text-dim whitespace-pre-wrap break-words bg-black/30 border border-line rounded-2xl p-3">
              {writing.slice(-1600)}
            </pre>
          )}

          {phase === 'failed' && (
            <div className="card p-5 border-live/30">
              <div className="text-live text-sm font-medium flex items-center gap-2"><Icon name="alert" size={15} />Bombed on stage</div>
              <p className="text-sm text-muted mt-1.5">{error}</p>
              <div className="flex gap-2 mt-4"><Button variant="primary" icon="redo" onClick={onRetry}>Try again</Button><Button variant="quiet" onClick={onBack}>Back</Button></div>
            </div>
          )}
        </div>

        {/* Storyboard */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,5fr)] gap-4">
            <Frame label="Headshot" src={comedian?.headshotUrl || comedian?.avatarImage} hue={hue} tall
              preview={headshotTask?.preview} progress={headshotTask ? headshotTask.progress : comedian && !comedian.headshotUrl && phase === 'shooting' ? -1 : undefined} stage={headshotTask?.stage} />
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: Math.max(4, bitTitles.length) }).slice(0, 4).map((_, i) => {
                const bit = set?.bits[i];
                const l = live(bit?.id);
                return <Frame key={i} label={bit?.title || bitTitles[i] || `Bit ${i + 1}`} src={bit?.imageUrl} hue={hue}
                  preview={l.preview} progress={bit && !bit.imageUrl && phase === 'shooting' ? (l.progress ?? -1) : undefined} stage={l.stage} />;
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 card px-5 py-4">
            <div className="text-[13px] text-muted">
              {phase === 'writing' && 'Every frame you see is streamed live from the engines.'}
              {phase === 'shooting' && `${shot} of ${total} stills developed. You can start watching now.`}
              {phase === 'done' && 'The special is ready.'}
              {phase === 'failed' && 'Nothing was lost. Fix the engine and try again.'}
            </div>
            <Button variant="primary" icon="play" disabled={!set || (phase !== 'done' && shot === 0)} onClick={onWatch}>Watch the special</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
