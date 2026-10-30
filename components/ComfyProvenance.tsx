import React, { useEffect, useState } from 'react';
import { Icon } from './ui';
import { getEngines } from '../services/engines';
import type { ComfyGraph, ProvenanceSummary } from '../services/comfy/provenance';

// "Made in ComfyUI": the graph that made a still or clip, read by the
// Station from the file's own metadata. Hidden with ?clean in the URL (for
// clean recordings) or localStorage standupify_hide_provenance = "1".

interface Provenance { ok: true; graph: ComfyGraph; summary: ProvenanceSummary }

const cache = new Map<string, Promise<Provenance | null>>();

function mediaName(url?: string | null): string | null {
  if (!url) return null;
  const m = /\/api\/station\/media\/([a-f0-9]{40}\.[a-z0-9]+)/.exec(url);
  return m ? m[1] : null;
}

function load(name: string): Promise<Provenance | null> {
  if (!cache.has(name)) {
    cache.set(name, fetch(`/api/station/provenance/media/${name}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && j.ok ? (j as Provenance) : null))
      .catch(() => { cache.delete(name); return null; }));
  }
  return cache.get(name)!;
}

function hidden(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('clean')) return true;
    return localStorage.getItem('standupify_hide_provenance') === '1';
  } catch { return false; }
}

export function useProvenance(url?: string | null): Provenance | null {
  const name = mediaName(url);
  const [p, setP] = useState<Provenance | null>(null);
  useEffect(() => {
    let live = true;
    // Keep the last graph on screen while the next shot's loads (players cut often).
    if (!name) setP(null);
    else load(name).then(v => { if (live) setP(v); });
    return () => { live = false; };
  }, [name]);
  return p;
}

// The nodes worth calling out in the chain.
const KEY_NODE = /ImgToVideo|ImageToVideo|ImageToVideoLatent|Sampler|Guider|Scheduler|Kontext|Upscale|RIFE|SaveVideo|SaveImage/;

function spec(s: ProvenanceSummary): string {
  const bits: string[] = [];
  if (s.width && s.height) bits.push(`${s.width}×${s.height}`);
  if (s.frames) bits.push(`${s.frames} frames${s.fps ? ` @ ${s.fps} fps` : ''}`);
  if (s.steps) bits.push(`${s.steps} steps`);
  return bits.join(' · ');
}

function download(name: string, graph: ComfyGraph) {
  const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `standupify_${name.replace(/\.[a-z0-9]+$/, '')}_api.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ProvenancePanel({ name, p, onClose }: { name: string; p: Provenance; onClose: () => void }) {
  const s = p.summary;
  const comfy = getEngines().comfy.origin;
  const stats: [string, string | number | null][] = [
    ['Size', s.width && s.height ? `${s.width}×${s.height}` : null],
    ['Frames', s.frames ? `${s.frames}${s.fps ? ` @ ${s.fps} fps` : ''}` : null],
    ['Steps', s.steps],
    ['CFG', s.cfg],
    ['Sampler', s.sampler],
    ['Seed', s.seed]
  ];
  return (
    <div onClick={e => e.stopPropagation()}
      className="w-[min(440px,calc(100vw-32px))] max-h-[min(70vh,620px)] overflow-y-auto rounded-2xl border border-white/15 bg-black/85 backdrop-blur-md p-4 text-left text-white shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start gap-3">
        <Icon name="workflow" size={20} className="text-[#ffb547] mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-white/55">Made in ComfyUI</div>
          <div className="font-semibold text-[15px] leading-tight">{s.family} {s.kind === 'video' ? 'clip' : s.kind === 'still' ? 'still' : 'render'}</div>
          <div className="text-[11.5px] text-white/55 mt-0.5">Read from this file's embedded graph, not from Standupify's records.</div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-white/60 hover:text-white p-1 -m-1"><Icon name="close" size={16} /></button>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2 mt-3">
        {stats.filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
          <div key={k} className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-white/45">{k}</div>
            <div className="text-[12.5px] font-mono truncate">{String(v)}</div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Models</div>
        <div className="flex flex-wrap gap-1.5">
          {s.models.map(m => (
            <span key={m.file} title={m.file} className="text-[11.5px] rounded-full border border-white/15 px-2 py-0.5">
              {m.label} <span className="text-white/45">{m.role}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Graph · {s.nodeCount} nodes, in execution order</div>
        <ol className="flex flex-wrap items-center gap-y-1.5 text-[11.5px]">
          {s.chain.map((n, i) => (
            <li key={n.id} className="flex items-center min-w-0" title={n.detail ? `${n.type}: ${n.detail}` : n.type}>
              <span className={`rounded-md px-1.5 py-0.5 font-mono max-w-[200px] truncate ${KEY_NODE.test(n.type) ? 'bg-[#ffb547]/20 text-[#ffd59a] border border-[#ffb547]/40' : 'bg-white/8 border border-white/10 text-white/80'}`}>
                {n.type}
              </span>
              {i < s.chain.length - 1 && <span className="text-white/30 px-1">›</span>}
            </li>
          ))}
        </ol>
      </div>

      {s.prompt && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Prompt</div>
          <p className="text-[12px] leading-snug text-white/85 line-clamp-5">{s.prompt}</p>
        </div>
      )}
      {s.startImage && (
        <div className="mt-2 text-[11.5px] text-white/55">Start frame: <span className="font-mono">{s.startImage}</span></div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={() => download(name, p.graph)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#ffb547] text-black text-[12.5px] font-semibold px-3 py-1.5 hover:brightness-110">
          <Icon name="download" size={14} /> Workflow JSON
        </button>
        {comfy && (
          <a href={comfy} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/25 text-[12.5px] px-3 py-1.5 hover:bg-white/10">
            Open ComfyUI
          </a>
        )}
      </div>
      <div className="text-[10.5px] text-white/40 mt-2">Load the JSON in ComfyUI (Workflow › Open) to re-run this exact shot.</div>
    </div>
  );
}

/** A corner badge over a still or clip. Renders nothing when the file has no ComfyUI graph. */
export function MadeInComfy({ url, className = '', align = 'right', drop = 'up' }: { url?: string | null; className?: string; align?: 'left' | 'right'; drop?: 'up' | 'down' }) {
  const p = useProvenance(url);
  const [open, setOpen] = useState(false);
  const name = mediaName(url);
  if (!p || !name || hidden()) return null;
  const s = p.summary;
  return (
    <div className={`absolute z-20 ${className}`} onClick={e => e.stopPropagation()}>
      {open && (
        <div className={`absolute ${drop === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <ProvenancePanel name={name} p={p} onClose={() => setOpen(false)} />
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        title="See the ComfyUI graph that made this shot"
        className="inline-flex items-center gap-1.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur border border-white/20 text-white text-[11.5px] px-2.5 py-1 shadow-lg">
        <Icon name="workflow" size={13} className="text-[#ffb547]" />
        <span className="font-semibold">ComfyUI</span>
        <span className="text-white/75">{s.family}</span>
        {spec(s) && <span className="hidden sm:inline text-white/50 font-mono text-[10.5px]">{spec(s)}</span>}
      </button>
    </div>
  );
}
