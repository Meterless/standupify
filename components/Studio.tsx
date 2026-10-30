import React, { useEffect, useRef, useState } from 'react';
import { AISettings, Comedian } from '../types';
import { Capabilities } from '../services/studio';
import { useEngines, launchEngine } from '../services/engines';
import { venueById } from '../services/comfy/presets';
import { Button, Icon, Still, notify } from './ui';
import { CameraMoves, VenuePicker } from './CameraMoves';
import CircuitTicker from './CircuitTicker';

const IDEAS = [
  'A burned-out kindergarten teacher who treats adults like toddlers',
  'A retired astronaut who is terrible at small talk',
  'A deadpan Midwestern grandma who just discovered crypto',
  'A Gen-Z HR rep with a dark side',
  'A former child actor who only does crowd work',
  'A sleep-deprived new dad doing absurdist one-liners',
  'A wedding DJ having an existential crisis',
  'A sommelier who reviews gas station food'
];

/** Shrink a photo to ≤1024px so it travels fast to the vision model. */
export async function photoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Pipeline({ caps }: { caps: Capabilities }) {
  const step = (on: boolean, label: string, by: string) => (
    <span className={`inline-flex items-center gap-1.5 ${on ? 'text-text' : 'text-dim line-through decoration-dim/60'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-ok' : 'bg-dim'}`} />{label} <span className="text-muted">· {by}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] font-mono">
      {step(caps.write, 'writes', 'Nightshift')}
      {step(!!caps.stills, 'shoots', caps.stills?.name || 'ComfyUI')}
      {step(!!caps.clips, 'animates', caps.clips?.name || 'ComfyUI')}
      {step(caps.voice, 'voices', 'Nightshift')}
    </div>
  );
}

export default function Studio({ settings, onSettings, caps, roster, onCast, onOpen, onOpenEngines, onOpenCircuit, onTuneIn, sampleImage }: {
  onOpenCircuit?: () => void;
  onTuneIn?: () => void;
  settings: AISettings;
  onSettings: (s: AISettings) => void;
  caps: Capabilities;
  roster: Comedian[];
  onCast: (input: { vibe: string; photo?: string }) => void;
  onOpen: (c: Comedian) => void;
  onOpenEngines: () => void;
  sampleImage?: string;
}) {
  const eng = useEngines();
  const [vibe, setVibe] = useState('');
  const [photo, setPhoto] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const venue = venueById(settings.venue);
  const ns = eng.nightshift;
  const [queued, setQueued] = useState(false);
  const pending = useRef<{ vibe: string; photo?: string } | null>(null);
  const openEnginesRef = useRef(onOpenEngines);
  openEnginesRef.current = onOpenEngines;

  // Starting the writer is part of casting, not a second task for the user.
  useEffect(() => {
    if (!queued) return;
    const timer = setTimeout(() => {
      if (!pending.current) return;
      pending.current = null;
      setQueued(false);
      notify('The writer is taking longer than expected. Your idea is still here.', { tone: 'info', action: { label: 'Check engines', run: () => openEnginesRef.current() } });
    }, 4 * 60_000);
    return () => clearTimeout(timer);
  }, [queued]);

  useEffect(() => {
    if (!pending.current) return;
    if (ns.state === 'online') {
      const input = pending.current;
      pending.current = null;
      setQueued(false);
      onCast(input);
    } else if (ns.state === 'unauthorized') {
      pending.current = null;
      setQueued(false);
      notify('The writer needs a connection update. Your idea is still here.', { tone: 'error', action: { label: 'Engines', run: onOpenEngines } });
    }
  }, [ns.state, queued, onCast, onOpenEngines]);

  const takeFile = async (f?: File | null) => {
    if (pending.current) return;
    if (!f || !f.type.startsWith('image/')) return;
    try { setPhoto(await photoToDataUrl(f)); } catch { notify('That photo could not be read.', { tone: 'error' }); }
  };

  const cast = async () => {
    if (pending.current) return;
    if (ns.state !== 'online') {
      if (ns.state === 'starting' || eng.launching.nightshift || (ns.canLaunch && ns.state === 'offline')) {
        const input = { vibe: vibe.trim(), photo };
        pending.current = input;
        setQueued(true);
        if (ns.state === 'offline' && !eng.launching.nightshift) {
          const r = await launchEngine('nightshift');
          if (!r.ok && pending.current === input) { pending.current = null; setQueued(false); notify(r.message, { tone: 'error' }); }
        }
      } else onOpenEngines();
      return;
    }
    onCast({ vibe: vibe.trim(), photo });
  };

  const ctaLabel = queued ? 'Warming up…' : ns.state === 'online' ? 'Cast my comic' : ns.state === 'starting' || eng.launching.nightshift ? 'Cast when ready' : ns.canLaunch && ns.state === 'offline' ? 'Start & cast' : 'Connect writer';

  return (
    <div className="max-w-[1100px] mx-auto px-4 md:px-8 pt-12 md:pt-20 pb-28">
      {/* Hero */}
      <div className="text-center rise">
        <div className="kicker">Your studio · one idea is enough</div>
        <h1 className="font-display text-[56px] md:text-[92px] leading-[0.95] mt-4 tracking-tight">
          Cast a comedian.<br /><span className="italic text-accent">Shoot the special.</span>
        </h1>
        {onTuneIn && (
          <button onClick={onTuneIn} className="mt-6 inline-flex items-center gap-2.5 h-11 pl-3 pr-5 rounded-full border border-[#ff5a43]/50 bg-[#ff5a43]/10 hover:bg-[#ff5a43]/20 text-[14px] font-medium transition-colors">
            <span className="w-2 h-2 rounded-full bg-[#ff5a43] breathe" />Just want to laugh? <span className="text-[#ff8a75]">Tune in to Standupify TV →</span>
          </button>
        )}
        <p className="text-muted mt-5 text-[15px] md:text-base max-w-xl mx-auto">
          Describe anyone, or drop a photo. Nightshift writes the act, ComfyUI shoots and animates it, all on your own GPU.
        </p>
      </div>

      {/* Prompt bar */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files?.[0]); }}
        className={`mt-10 md:mt-12 card p-2.5 md:p-3 rise [animation-delay:120ms] transition-colors ${dragging ? 'border-accent bg-accent-soft' : ''}`}>
        <div className="flex flex-wrap sm:flex-nowrap items-stretch gap-2.5">
          <div className="relative shrink-0 w-[72px] md:w-[88px] min-h-[72px]">
          <button onClick={() => fileRef.current?.click()} title="Build them from a photo" disabled={queued}
            className="absolute inset-0 rounded-[14px] overflow-hidden border border-dashed border-line-strong hover:border-accent/60 grid place-items-center transition-colors group">
            {photo
              ? <img src={photo} alt="Selected comedian photo" className="absolute inset-0 w-full h-full object-cover" />
              : <span className="flex flex-col items-center gap-1 text-muted group-hover:text-accent transition-colors"><Icon name="camera" size={20} /><span className="text-[10px] font-medium">Photo</span></span>}
          </button>
          {photo && <button aria-label="Remove photo" disabled={queued} onClick={() => setPhoto(undefined)} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/80 grid place-items-center text-white"><Icon name="close" size={12} /></button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { takeFile(e.target.files?.[0]); e.target.value = ''; }} />
          <textarea
            aria-label="Describe your comedian"
            disabled={queued}
            value={vibe} onChange={e => setVibe(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) cast(); }}
            placeholder={photo ? 'Anything to add about them? (optional)' : 'Describe a comedian… or leave it blank for a total surprise'}
            className="flex-1 min-w-0 bg-transparent resize-none outline-none text-[17px] md:text-[19px] leading-snug placeholder:text-dim py-3 px-1 min-h-[72px]"
          />
          <Button variant="primary" size="lg" icon={ns.state === 'online' ? 'sparkle' : 'power'} onClick={cast}
            disabled={queued} className="self-center shrink-0 w-full sm:w-auto !rounded-[16px] !h-[60px]">
            {ctaLabel}
          </Button>
        </div>
        {queued && <div role="status" className="px-2 pt-3 text-[12px] text-muted flex flex-wrap justify-between gap-2"><span>Your idea is saved here. Casting starts as soon as the writer is ready.</span><button className="text-accent" onClick={() => { pending.current = null; setQueued(false); }}>Cancel waiting</button></div>}
        <div className="flex items-center gap-2 mt-2.5 px-1.5 overflow-x-auto pb-0.5">
          <button disabled={queued} onClick={() => setVibe(IDEAS[Math.floor(Math.random() * IDEAS.length)])}
            className="shrink-0 h-7 w-7 rounded-full grid place-items-center text-muted hover:text-accent hover:bg-white/[0.05]" title="Surprise me"><Icon name="dice" size={15} /></button>
          {IDEAS.slice(0, 5).map(i => (
            <button key={i} disabled={queued} onClick={() => setVibe(i)}
              className="shrink-0 h-7 px-3 rounded-full text-[12px] text-muted hover:text-text bg-white/[0.04] hover:bg-white/[0.08] border border-line transition-colors">
              {i.replace(/^An? /, '')}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-center rise [animation-delay:200ms]">
        <button onClick={onOpenEngines}><Pipeline caps={caps} /></button>
      </div>

      {onOpenCircuit && <CircuitTicker onOpen={onOpenCircuit} />}

      <details className="mt-10 rounded-[20px] border border-line p-5">
        <summary className="cursor-pointer text-[14px] font-medium">Customize the production <span className="text-muted font-normal ml-2 text-[12px]">Optional · {venue.name} · automatic settings ready</span></summary>
      <section className="mt-6 rise [animation-delay:260ms]">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="kicker">Stage</div>
            <h2 className="font-display text-[34px] leading-tight mt-1">Where do they play?</h2>
          </div>
        </div>
        <VenuePicker value={settings.venue} onChange={id => onSettings({ ...settings, venue: id })} />
      </section>

      <section className="mt-12 rise [animation-delay:320ms]">
        <div className="flex items-end justify-between mb-4 gap-4">
          <div>
            <div className="kicker">Camera</div>
            <h2 className="font-display text-[34px] leading-tight mt-1">Pick the shot. Hover to watch it.</h2>
          </div>
          <span className="text-[12px] text-muted hidden md:block max-w-[260px] text-right">{caps.clips ? `${caps.clips.name} renders the real move` : 'Previews play now; real clips once ComfyUI has a video model'}</span>
        </div>
        <CameraMoves value={settings.cameraMove} onChange={id => onSettings({ ...settings, cameraMove: id })} image={sampleImage} hue={venue.swatch[0]} />
      </section>

      </details>
      {/* Roster strip */}
      {roster.length > 0 && (
        <section className="mt-16">
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="kicker">Your roster</div>
              <h2 className="font-display text-[34px] leading-tight mt-1">Back on stage</h2>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {roster.slice(0, 8).map(c => (
              <button key={c.id} onClick={() => onOpen(c)} className="group text-left rounded-2xl overflow-hidden border border-line hover:border-line-strong bg-surface transition-all hover:-translate-y-0.5">
                <Still src={c.headshotUrl || c.avatarImage} alt={c.name} className="aspect-[4/5]" hue={venueById(c.venue).swatch[0]} imgClassName="group-hover:scale-[1.03] transition-transform duration-700" />
                <div className="p-3">
                  <div className="font-display text-[22px] leading-tight truncate">{c.name}</div>
                  <div className="text-[12px] text-muted truncate">{c.tagline}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
