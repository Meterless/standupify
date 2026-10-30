import React from 'react';
import { useEngines } from '../services/engines';
import { Dot, Icon, Tone } from './ui';
import DownloadApp, { isWebDemo } from './DownloadApp';

export type View = 'home' | 'studio' | 'casting' | 'special' | 'roster' | 'circuit' | 'originals' | 'nightshift';

export function nightshiftTone(state: string, launching?: number): Tone {
  if (state === 'online') return 'ok';
  if (state === 'starting' || launching) return 'busy';
  if (state === 'unauthorized') return 'warn';
  return 'off';
}

export function comfyTone(state: string, launching?: number): Tone {
  if (state === 'online') return 'ok';
  if (launching) return 'busy';
  return 'off';
}

function EnginePill({ name, tone, detail, onClick }: { name: string; tone: Tone; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={detail}
      className="group h-9 pl-3 pr-3.5 rounded-full border border-line bg-white/[0.03] hover:bg-white/[0.07] flex items-center gap-2 transition-colors">
      <Dot tone={tone} />
      <span className="text-[13px] font-medium">{name}</span>
      <span className="hidden lg:inline text-[12px] text-muted group-hover:text-text transition-colors">{detail}</span>
    </button>
  );
}

export default function TopBar({ view, onNavigate, onOpenEngines, nightShiftOn, circuitLive, onTuneIn }: {
  view: View; onNavigate: (v: View) => void; onOpenEngines: () => void; nightShiftOn: boolean; circuitLive: boolean; onTuneIn: () => void;
}) {
  const eng = useEngines();
  const ns = eng.nightshift;
  const comfy = eng.comfy;

  const nsDetail = ns.state === 'online' ? 'writing' : ns.state === 'starting' || eng.launching.nightshift ? 'starting…' : ns.state === 'unauthorized' ? 'needs key' : 'off';
  const comfyDetail = comfy.state === 'online' ? (comfy.gpu ? comfy.gpu.name.replace(/NVIDIA |GeForce /g, '') : 'shooting') : eng.launching.comfy ? 'starting…' : 'off';

  const tab = (v: View, label: string, icon: React.ComponentProps<typeof Icon>['name']) => {
    const active = view === v || (v === 'studio' && (view === 'casting' || view === 'special'));
    return (
      <button onClick={() => onNavigate(v)} aria-current={active ? 'page' : undefined}
        className={`h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap flex items-center gap-2 transition-colors ${active ? 'bg-white/[0.09] text-text' : 'text-muted hover:text-text'}`}>
        <Icon name={icon} size={15} />
        <span>{label}</span>
        {((v === 'nightshift' && nightShiftOn) || (v === 'circuit' && circuitLive)) && <span className="w-1.5 h-1.5 rounded-full bg-live breathe" />}
      </button>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-ink/70 backdrop-blur-xl">
      <div className="max-w-[1240px] mx-auto h-16 px-4 md:px-8 flex items-center gap-3">
        <button onClick={() => onNavigate('home')} aria-label="Standupify home" className="flex items-center gap-2.5 mr-2 shrink-0">
          <span className="w-8 h-8 rounded-[10px] bg-accent text-accent-ink grid place-items-center shadow-[0_6px_24px_-6px_rgb(255_181_71/0.7)]">
            <Icon name="mic" size={17} />
          </span>
          <span className="font-display text-[19px] min-[380px]:text-[23px] sm:text-[26px] leading-none tracking-tight">Standupify</span>
        </button>

        <div className="ml-auto hidden md:flex items-center gap-2">
          <EnginePill name="Nightshift" tone={nightshiftTone(ns.state, eng.launching.nightshift)} detail={nsDetail} onClick={onOpenEngines} />
          <EnginePill name="ComfyUI" tone={comfyTone(comfy.state, eng.launching.comfy)} detail={comfyDetail} onClick={onOpenEngines} />
        </div>
        {/* Phones: one compact button, a dot per engine. */}
        <button onClick={onOpenEngines} title={`Nightshift ${nsDetail} · ComfyUI ${comfyDetail}`}
          className="md:hidden ml-auto h-9 px-2.5 rounded-full border border-line bg-white/[0.03] flex items-center gap-2 text-[12px] font-medium" aria-label="Open engine settings">
          <Dot tone={nightshiftTone(ns.state, eng.launching.nightshift)} />
          <Dot tone={comfyTone(comfy.state, eng.launching.comfy)} />
          <span className="hidden min-[420px]:inline">Engines</span>
        </button>
        {isWebDemo && <DownloadApp />}
        <button onClick={onTuneIn} title="Watch your comedy channel"
          className="h-9 px-3.5 shrink-0 whitespace-nowrap rounded-full bg-live text-white text-[12px] font-semibold flex items-center gap-2 hover:brightness-110 transition">
          <Icon name="play" size={13} />Tune in
        </button>
      </div>
      <nav aria-label="Main navigation" className="max-w-[1240px] mx-auto px-4 md:px-8 pb-3 flex items-center gap-1 overflow-x-auto">
        {tab('home', 'Home', 'home')}
        {tab('studio', 'Studio', 'sparkle')}
        {tab('circuit', 'Circuit', 'laugh')}
        {tab('originals', 'Originals', 'film')}
        {tab('roster', 'Roster', 'grid')}
        {tab('nightshift', 'Night Shift', 'moon')}
      </nav>
    </header>
  );
}
