import React, { useEffect } from 'react';
import { useCircuit } from '../services/league/store';
import { ensureCircuit, comedianOf, comedianName } from '../services/league/engine';
import { FORMAT_LABEL } from '../services/league/types';
import { venueById } from '../services/comfy/presets';
import { Icon, plainText } from './ui';

/** The Circuit, glimpsed from the Studio: what is on stage right now, or the latest news. */
export default function CircuitTicker({ onOpen }: { onOpen: () => void }) {
  const { state, live, shows } = useCircuit();
  useEffect(() => { ensureCircuit().catch(() => { /* the ticker just stays quiet */ }); }, []);
  if (!state) return null;

  const running = ['booking', 'rehearsing', 'judging', 'crowd'].includes(live.phase) && live.show;
  const club = running ? state.clubs.find(c => c.id === live.show!.clubId) : null;
  const last = shows[0];
  const onStage = running && live.current >= 0 ? live.show!.lineup[live.current] : null;
  const faces = (running ? live.show!.lineup : last?.lineup || Object.keys(state.stats).slice(0, 5)).slice(0, 5);
  const swatch = venueById(club?.venue || state.clubs[0]?.venue).swatch;

  return (
    <button onClick={onOpen}
      className="group w-full mt-14 rounded-[22px] border border-line hover:border-line-strong overflow-hidden text-left transition-colors rise [animation-delay:240ms]"
      style={{ background: `linear-gradient(100deg, ${swatch[0]}44, transparent 55%), var(--color-surface)` }}>
      <div className="flex items-center gap-4 p-4 md:p-5">
        <span className={`h-7 px-2.5 rounded-full text-[10.5px] font-mono tracking-widest flex items-center gap-1.5 shrink-0 ${running || state.live ? 'bg-live text-white' : 'bg-white/10 text-muted'}`}>
          {(running || state.live) && <span className="w-1.5 h-1.5 rounded-full bg-white breathe" />}{running ? 'LIVE' : state.live ? 'ON AIR' : 'THE CIRCUIT'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] md:text-[15px] font-medium truncate">
            {running
              ? <>{FORMAT_LABEL[live.show!.format]} at {club?.name}{onStage ? <>: <span className="text-accent">{comedianName(onStage)}</span> {live.phase === 'rehearsing' ? 'is backstage' : 'is on'}</> : ''}</>
              : last ? <>Night {last.night}: {last.headline}</> : <>{Object.keys(state.stats).length} comedians, four clubs, one stage. The comedy circuit that runs itself</>}
          </div>
          <div className="text-[12px] text-muted truncate">
            {running ? live.note : plainText(state.events[0]?.text || '') || 'Press Go live and the scene starts living.'}
          </div>
        </div>
        <span className="hidden sm:flex -space-x-2 shrink-0">
          {faces.map(id => {
            const c = comedianOf(id);
            const src = c?.headshotUrl || c?.avatarImage;
            return src
              ? <img key={id} src={src} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-ink" />
              : <span key={id} className="w-8 h-8 rounded-full ring-2 ring-ink bg-raised grid place-items-center text-[10px] font-semibold">{(c?.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('')}</span>;
          })}
        </span>
        <Icon name="arrow" size={16} className="text-muted group-hover:text-text group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
    </button>
  );
}
