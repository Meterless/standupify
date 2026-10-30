import React, { useState } from 'react';
import { CAMERA_MOVES, VENUES, Venue } from '../services/comfy/presets';
import { StageArt } from './ui';

/** Higgsfield-style shot presets, each previewed live on your own still. */
export function CameraMoves({ value, onChange, image, hue, compact = false }: {
  value: string; onChange: (id: string) => void; image?: string; hue?: string; compact?: boolean;
}) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className={`grid gap-2.5 ${compact ? 'grid-cols-4 lg:grid-cols-8' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {CAMERA_MOVES.map(m => {
        const active = m.id === value;
        const playing = active || hover === m.id;
        return (
          <button key={m.id} onClick={() => onChange(m.id)} onMouseEnter={() => setHover(m.id)} onMouseLeave={() => setHover(null)}
            title={m.blurb}
            className={`group text-left rounded-2xl overflow-hidden border transition-all duration-300 ${active ? 'border-accent shadow-[0_0_0_3px_rgb(255_181_71/0.18)]' : 'border-line hover:border-line-strong'}`}>
            <div className={`relative ${compact ? 'aspect-square' : 'aspect-[4/3]'} overflow-hidden bg-raised`}>
              <div className={`absolute inset-0 cam ${playing ? `cam-run ${m.css}` : ''}`}>
                {image ? <img src={image} alt="" className="w-full h-full object-cover" draggable={false} /> : <StageArt className="w-full h-full" hue={hue} />}
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
              {!compact && <div className="absolute left-3 bottom-2.5 right-3">
                <div className="text-[13px] font-semibold leading-tight">{m.name}</div>
                <div className="text-[11px] text-white/60 leading-tight truncate">{m.blurb}</div>
              </div>}
              {compact && <div className="absolute left-2 bottom-1.5 right-2 text-[10.5px] font-semibold leading-tight truncate">{m.name}</div>}
              {active && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent shadow-[0_0_10px_#ffb547]" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function VenuePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
      {VENUES.map((v: Venue) => {
        const active = v.id === value;
        return (
          <button key={v.id} onClick={() => onChange(v.id)}
            className={`shrink-0 flex items-center gap-2.5 h-11 pl-1.5 pr-4 rounded-full border transition-all ${active ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong bg-white/[0.02]'}`}>
            <span className="w-8 h-8 rounded-full" style={{ background: `radial-gradient(circle at 50% 25%, #ffd9a0aa, transparent 55%), linear-gradient(160deg, ${v.swatch[0]}, ${v.swatch[1]})` }} />
            <span className={`text-[13px] font-medium ${active ? 'text-text' : 'text-muted'}`}>{v.name}</span>
          </button>
        );
      })}
    </div>
  );
}
