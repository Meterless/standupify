import React, { useRef } from 'react';
import { Comedian } from '../types';
import { venueById } from '../services/comfy/presets';
import { Button, Icon, IconButton, Still, Toggle } from './ui';

export default function Roster({ comedians, onOpen, onDelete, onToggleShift, onImport, onExport, onNew, onEnterCircuit }: {
  comedians: Comedian[];
  onOpen: (c: Comedian) => void;
  onDelete: (c: Comedian) => void;
  onToggleShift: (c: Comedian, on: boolean) => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onNew: () => void;
  onEnterCircuit: (c: Comedian) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="max-w-[1300px] mx-auto px-4 md:px-8 pt-12 pb-28">
      <div className="flex flex-wrap items-end gap-4 mb-8">
        <div className="flex-1">
          <div className="kicker">Roster</div>
          <h1 className="font-display text-[42px] sm:text-[56px] leading-none mt-2">Everyone you've cast</h1>
        </div>
        <Button variant="quiet" icon="upload" onClick={() => fileRef.current?.click()}>Import</Button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        <Button variant="quiet" icon="download" onClick={onExport} disabled={!comedians.length}>Back up</Button>
        <Button variant="primary" icon="plus" onClick={onNew}>Cast someone</Button>
      </div>

      {!comedians.length ? (
        <div className="card p-12 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-accent-soft text-accent grid place-items-center"><Icon name="mic" size={26} /></div>
          <h2 className="font-display text-[36px] mt-5">The stage is empty</h2>
          <p className="text-muted mt-2">Cast your first comedian. It takes about a minute.</p>
          <Button variant="primary" icon="sparkle" className="mt-6" onClick={onNew}>Cast a comedian</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {comedians.map(c => {
            const onShift = c.autopilotConfig.enabled && c.status === 'active';
            return (
              <div key={c.id} className="group rounded-[22px] overflow-hidden border border-line bg-surface hover:border-line-strong transition-all">
                <button onClick={() => onOpen(c)} className="block w-full text-left">
                  <div className="relative">
                    <Still src={c.headshotUrl || c.avatarImage} alt={c.name} className="aspect-[4/5]" hue={venueById(c.venue).swatch[0]} imgClassName="group-hover:scale-[1.03] transition-transform duration-700" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
                    <div className="absolute left-4 right-4 bottom-4">
                      <div className="font-display text-[30px] leading-none">{c.name}</div>
                      <div className="text-[12.5px] text-white/70 mt-1.5 line-clamp-2">{c.tagline}</div>
                    </div>
                    {onShift && <span className="absolute top-3 left-3 h-6 px-2 rounded-full bg-black/60 text-[10.5px] font-mono flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-live breathe" />ON SHIFT</span>}
                  </div>
                </button>
                <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
                  <span className="text-[12px] text-muted capitalize flex-1 truncate">{c.style} · {venueById(c.venue).name}</span>
                  <span className="text-[11px] text-muted">Night Shift</span>
                  <Toggle on={onShift} onChange={v => onToggleShift(c, v)} label={`Night Shift for ${c.name}`} />
                  <IconButton icon="laugh" label={`Put ${c.name} on the Circuit`} onClick={() => onEnterCircuit(c)} />
                  <IconButton icon="trash" label={`Delete ${c.name}`} onClick={() => onDelete(c)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
