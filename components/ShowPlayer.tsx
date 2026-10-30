import React, { useEffect, useState } from 'react';
import { CircuitState, FORMAT_LABEL, Show } from '../services/league/types';
import { comedianName, comedianOf, JUDGES } from '../services/league/engine';
import { venueById } from '../services/comfy/presets';
import { Icon, Sheet } from './ui';

type Beat = { kind: 'title' } | { kind: 'set'; i: number } | { kind: 'cards'; i: number } | { kind: 'finale' };

/** Circuit TV: any show, replayed as a broadcast. */
export default function ShowPlayer({ show, st, onClose }: { show: Show | null; st: CircuitState; onClose: () => void }) {
  const [beat, setBeat] = useState<Beat>({ kind: 'title' });
  const [reveal, setReveal] = useState(0);

  useEffect(() => { setBeat({ kind: 'title' }); setReveal(0); }, [show?.id]);

  useEffect(() => {
    if (!show) return;
    let ms = 3200;
    if (beat.kind === 'set') ms = Math.max(4500, (show.performances[beat.i]?.text.length || 100) * 55);
    if (beat.kind === 'cards') ms = 3600;
    if (beat.kind === 'finale') return;
    const t = setTimeout(() => {
      setReveal(0);
      setBeat(b => b.kind === 'title' ? { kind: 'set', i: 0 }
        : b.kind === 'set' ? { kind: 'cards', i: b.i }
        : b.kind === 'cards' ? (b.i + 1 < show.performances.length ? { kind: 'set', i: b.i + 1 } : { kind: 'finale' })
        : b);
    }, ms);
    return () => clearTimeout(t);
  }, [beat, show]);

  // Captions roll in word by word during a set.
  useEffect(() => {
    if (!show || beat.kind !== 'set') return;
    const words = (show.performances[beat.i]?.text || '').split(/\s+/).length;
    const total = Math.max(4500, (show.performances[beat.i]?.text.length || 100) * 55) * 0.85;
    const id = setInterval(() => setReveal(r => Math.min(words, r + 1)), total / Math.max(words, 1));
    return () => clearInterval(id);
  }, [beat, show]);

  if (!show) return null;
  const club = st.clubs.find(c => c.id === show.clubId);
  const v = venueById(club?.venue);
  const bg = { background: `radial-gradient(ellipse at 50% 0%, #ffd9a03a, transparent 60%), linear-gradient(160deg, ${v.swatch[0]}, ${v.swatch[1]})` };
  const ranked = [...show.performances].sort((a, b) => a.rank - b.rank);
  const perf = beat.kind === 'set' || beat.kind === 'cards' ? show.performances[beat.i] : null;
  const face = (id: string, size: number) => {
    const c = comedianOf(id);
    const src = c?.headshotUrl || c?.avatarImage;
    return src
      ? <img src={src} alt="" className="rounded-full object-cover ring-4 ring-accent/60" style={{ width: size, height: size }} />
      : <span className="rounded-full grid place-items-center font-display text-white ring-4 ring-accent/60" style={{ width: size, height: size, fontSize: size * 0.38, background: 'rgb(0 0 0 / 0.35)' }}>{(c?.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('')}</span>;
  };

  return (
    <Sheet open={!!show} onClose={onClose} width="max-w-5xl">
      <div className="relative min-h-[560px] md:min-h-0 md:aspect-video rounded-[28px] overflow-hidden" style={bg}>
        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-black/50 grid place-items-center text-white"><Icon name="close" size={16} /></button>
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <span className="h-6 px-2.5 rounded-full bg-live text-white text-[10.5px] font-mono tracking-widest grid place-items-center">CIRCUIT TV</span>
          <span className="text-[12px] text-white/70">night {show.night} · {club?.name}</span>
        </div>

        {beat.kind === 'title' && (
          <div key="title" className="absolute inset-0 grid place-items-center text-center px-6 animate-in fade-in zoom-in-[0.96] duration-700">
            <div>
              <div className="kicker !text-white/60">Tonight · theme: {show.theme}</div>
              <div className="font-display text-[44px] md:text-[80px] leading-none mt-3">{FORMAT_LABEL[show.format]}</div>
              <div className="text-white/70 mt-2">at {club?.name}</div>
              <div className="flex justify-center gap-4 mt-7">{show.lineup.map(id => <div key={id} className="flex flex-col items-center gap-2">{face(id, 64)}<span className="text-[12px] text-white/80">{comedianName(id)}</span></div>)}</div>
            </div>
          </div>
        )}

        {perf && beat.kind === 'set' && (
          <div key={`set${beat.i}`} className="absolute inset-0 animate-in fade-in duration-500">
            {perf.videoUrl && !perf.videoUrl.startsWith('data:image/') ? <video src={perf.videoUrl} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover opacity-80" />
              : (perf.videoUrl || perf.imageUrl) ? <img src={perf.videoUrl || perf.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80 cam cam-play cam-dolly-in" /> : null}
            <div className="absolute left-6 top-16 flex items-center gap-3">
              {face(perf.comedianId, 56)}
              <div>
                <div className="font-display text-[30px] leading-none">{comedianName(perf.comedianId)}</div>
                <div className="text-[12.5px] text-white/70 mt-1">“{perf.title}”{perf.target ? ` · roasting ${comedianName(perf.target)}` : ''}</div>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 px-8 pb-8 pt-24 bg-gradient-to-t from-black/90 to-transparent">
              <p className="text-[17px] md:text-[23px] leading-snug font-medium text-center max-w-3xl mx-auto [text-shadow:0_2px_12px_rgb(0_0_0/0.9)]">
                {perf.text.split(/\s+/).slice(Math.max(0, reveal - 24), Math.max(reveal, 1)).join(' ')}
              </p>
            </div>
          </div>
        )}

        {perf && beat.kind === 'cards' && (
          <div key={`cards${beat.i}`} className="absolute inset-0 grid place-items-center px-6 bg-black/40">
            <div className="w-full max-w-3xl">
              <div className="text-center mb-5"><span className="font-display text-[30px]">{comedianName(perf.comedianId)}</span></div>
              <div className="grid grid-cols-3 gap-3">
                {perf.cards.map((c, j) => (
                  <div key={c.judge} className="glass rounded-2xl p-4 text-center animate-in zoom-in-[0.85] fade-in duration-500" style={{ animationDelay: `${j * 350}ms`, animationFillMode: 'both' }}>
                    <div className="text-[12px] text-muted">{JUDGES[j]?.name}, {JUDGES[j]?.role}</div>
                    <div className="font-display text-[54px] leading-none text-accent mt-1">{c.score.toFixed(1)}</div>
                    <div className="text-[12px] italic mt-2 line-clamp-3">“{c.line}”</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-3 justify-center text-[13px]">
                <span className="text-muted">the room</span>
                <div className="w-48 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-accent meter-fill" style={{ width: `${perf.crowd * 10}%` }} /></div>
                <span className="font-mono">{perf.crowd.toFixed(1)}</span>
                {perf.moments.map(m => <span key={m} className="text-accent">· {m}</span>)}
              </div>
            </div>
          </div>
        )}

        {beat.kind === 'finale' && (
          <div key="finale" className="absolute inset-0 grid place-items-center px-6 animate-in fade-in duration-700">
            <div className="text-center w-full max-w-2xl">
              <div className="kicker !text-accent">Tonight's winner</div>
              <div className="flex justify-center mt-4 animate-in zoom-in-[0.8] duration-700">{face(show.winnerId || '', 110)}</div>
              <div className="font-display text-[46px] md:text-[64px] leading-none mt-4">{comedianName(show.winnerId || '')}</div>
              <div className="text-white/75 italic mt-2">{show.headline}</div>
              <div className="flex flex-col gap-1.5 mt-6 text-[13px]">
                {ranked.map(p => (
                  <div key={p.comedianId} className="flex items-center gap-3 justify-center">
                    <span className="font-mono text-white/60 w-6">#{p.rank}</span>
                    <span className="w-40 text-left truncate">{comedianName(p.comedianId)}</span>
                    <span className="font-mono w-10">{p.final.toFixed(1)}</span>
                    <span className={`font-mono w-16 text-left ${p.eloAfter >= p.eloBefore ? 'text-ok' : 'text-live'}`}>{p.eloAfter >= p.eloBefore ? '+' : ''}{p.eloAfter - p.eloBefore}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => { setBeat({ kind: 'title' }); setReveal(0); }} className="mt-6 text-[13px] text-accent hover:underline">↺ Watch again</button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
