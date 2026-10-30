import React, { useRef, useState } from 'react';
import { AISettings, Quality, ImageEngine } from '../types';
import { useEngines, launchEngine, refreshEngines, connectNightshiftDirect, connectComfyDirect } from '../services/engines';
import { addWorkflowFile, removeWorkflow, judgeAvailable, Capabilities } from '../services/studio';
import { getMediaPrivacy, setMediaPrivacy, PrivacyFloor } from '../services/nightshift/media';
import { RecipeStatus } from '../services/comfy/recipes';
import { Sheet, Button, Icon, Dot, Segmented, Toggle, notify, notifyError } from './ui';
import { nightshiftTone, comfyTone } from './TopBar';

function Capability({ ok, label, reason }: { ok: boolean; label: string; reason?: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={`mt-0.5 w-4 h-4 rounded-full grid place-items-center shrink-0 ${ok ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-dim'}`}>
        <Icon name={ok ? 'check' : 'close'} size={10} />
      </span>
      <div className="min-w-0">
        <div className={`text-[13px] ${ok ? '' : 'text-muted'}`}>{label}</div>
        {!ok && reason && <div className="text-[11px] text-dim leading-snug">{reason}</div>}
      </div>
    </div>
  );
}

function CopyCommand({ cmd }: { cmd: string }) {
  return (
    <button onClick={() => { navigator.clipboard?.writeText(cmd); notify('Copied. Paste it in a terminal in this folder.', { tone: 'ok' }); }}
      className="w-full flex items-center gap-3 rounded-xl bg-black/40 border border-line px-3.5 py-2.5 font-mono text-[12.5px] text-left hover:border-line-strong transition-colors">
      <span className="text-dim">$</span><span className="flex-1">{cmd}</span><Icon name="stack" size={14} className="text-muted" />
    </button>
  );
}

function EngineCard({ title, role, tone, headline, children }: { title: string; role: string; tone: ReturnType<typeof nightshiftTone>; headline: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5 md:p-6 flex flex-col gap-4 min-w-0">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="kicker">{role}</div>
          <h3 className="font-display text-[32px] leading-tight mt-1">{title}</h3>
        </div>
        <div className="flex items-center gap-2 h-8 px-3 rounded-full bg-white/[0.05] border border-line text-[12px]">
          <Dot tone={tone} />{headline}
        </div>
      </div>
      {children}
    </section>
  );
}

function RecipeList({ kind, list, selected, onSelect }: { kind: string; list: RecipeStatus[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const [openMissing, setOpenMissing] = useState<string | null>(null);
  if (!list.length) return null;
  const firstReady = list.find(r => r.ok)?.recipe.id;
  return (
    <div>
      <div className="kicker mb-2">{kind}</div>
      <div className="flex flex-col gap-1">
        {list.map(r => {
          const active = r.ok && (selected ? selected === r.recipe.id : firstReady === r.recipe.id);
          return (
            <div key={r.recipe.id}>
              <button disabled={!r.ok && !r.missing.length}
                onClick={() => r.ok ? onSelect(r.recipe.id === firstReady ? null : r.recipe.id) : setOpenMissing(openMissing === r.recipe.id ? null : r.recipe.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${active ? 'bg-accent-soft' : 'hover:bg-white/[0.04]'}`}>
                <span className={`w-3.5 h-3.5 rounded-full border grid place-items-center ${active ? 'border-accent' : 'border-line-strong'}`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                </span>
                <span className={`text-[13px] font-medium ${r.ok ? '' : 'text-dim'}`}>{r.recipe.name}</span>
                {r.recipe.custom && <span className="text-[10px] font-mono text-cool border border-cool/30 rounded px-1">YOURS</span>}
                <span className="ml-auto text-[11px] text-muted">{r.ok ? (r.picks && Object.values(r.picks)[0]) || r.recipe.speed : 'not installed'}</span>
              </button>
              {openMissing === r.recipe.id && (
                <ul className="ml-9 mb-2 mt-1 text-[11px] text-muted list-disc pl-4 space-y-0.5">
                  {r.missing.map(m => <li key={m}>{m}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function EnginesSheet({ open, onClose, settings, onSettings, caps }: {
  open: boolean; onClose: () => void; settings: AISettings; onSettings: (s: AISettings) => void; caps: Capabilities;
}) {
  const eng = useEngines();
  const ns = eng.nightshift;
  const comfy = eng.comfy;
  const [busy, setBusy] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<PrivacyFloor>(getMediaPrivacy());
  const [directUrl, setDirectUrl] = useState('');
  const [directToken, setDirectToken] = useState('');
  const [comfyUrl, setComfyUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const start = async (which: 'nightshift' | 'comfy') => {
    setBusy(which);
    const r = await launchEngine(which);
    setBusy(null);
    notify(r.message, { tone: r.ok ? 'info' : 'error' });
  };

  const addFiles = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      try {
        const wf = await addWorkflowFile(f);
        notify(`Added “${wf.name}” as a ${wf.kind === 'video' ? 'clip' : 'still'} recipe.`, { tone: 'ok' });
      } catch (e) { notifyError(e); }
    }
  };

  const set = (patch: Partial<AISettings>) => onSettings({ ...settings, ...patch });
  const customs = [...caps.imageRecipes, ...caps.videoRecipes].filter(r => r.recipe.custom);

  const nsHeadline = ns.state === 'online' ? 'Ready' : ns.state === 'starting' || eng.launching.nightshift ? 'Starting…' : ns.state === 'unauthorized' ? 'Locked' : 'Off';
  const comfyHeadline = comfy.state === 'online' ? 'Ready' : eng.launching.comfy ? 'Starting…' : 'Off';

  return (
    <Sheet open={open} onClose={onClose} width="max-w-5xl">
      <div className="p-4 sm:p-6 md:p-8">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <div className="kicker">Engines</div>
            <h2 className="font-display text-[34px] sm:text-[44px] leading-[1.05] mt-1">Two engines. Zero setup.</h2>
            <p className="text-muted text-sm mt-2 max-w-xl">Standupify finds both on this computer by itself: ports, keys, models. If one is off, press its button.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text p-2 -mr-2"><Icon name="close" size={20} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* ---------------- Nightshift ---------------- */}
          <EngineCard title="Nightshift" role="Writes · judges · voices" tone={nightshiftTone(ns.state, eng.launching.nightshift)} headline={nsHeadline}>
            {ns.state === 'online' ? (
              <div className="text-[13px] text-muted">
                Connected at <span className="font-mono text-text">{ns.origin?.replace(/^https?:\/\//, '')}</span> · {ns.modes} routing modes ·{' '}
                {ns.tokenSource === 'file' ? 'key found automatically' : ns.tokenSource === 'env' ? 'key from environment' : 'key pasted'}
              </div>
            ) : ns.state === 'unauthorized' ? (
              <div className="text-[13px] text-muted">Nightshift is running but refused the key. {eng.bridge ? 'Restart Nightshift so its key file is fresh, then press Check again.' : 'Paste its Quick Connect link or key below.'}</div>
            ) : ns.state === 'starting' || eng.launching.nightshift ? (
              <div className="text-[13px] text-muted">Loading models. This lights up on its own.</div>
            ) : ns.installed ? (
              <Button variant="primary" size="lg" icon="power" disabled={busy === 'nightshift' || !ns.canLaunch} onClick={() => start('nightshift')}>Start Nightshift</Button>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-muted">Nightshift is the local AI runtime from Meterless. It runs the writers' room on your own GPU.</p>
                <a href="https://meterless.ai" target="_blank" rel="noreferrer"><Button variant="primary" icon="download">Get Nightshift</Button></a>
              </div>
            )}

            {!eng.bridge && ns.state !== 'online' && (
              <div className="flex flex-col gap-2">
                <input value={directUrl} onChange={e => setDirectUrl(e.target.value)} placeholder="Quick Connect link or http://127.0.0.1:8088"
                  className="h-10 rounded-xl bg-black/40 border border-line px-3 text-sm outline-none focus:border-accent/60" />
                <input value={directToken} onChange={e => setDirectToken(e.target.value)} placeholder="API key (not needed with a Quick Connect link)" type="password"
                  className="h-10 rounded-xl bg-black/40 border border-line px-3 text-sm outline-none focus:border-accent/60" />
                <Button onClick={() => connectNightshiftDirect(directUrl, directToken)}>Connect</Button>
              </div>
            )}

            <div className="border-t border-line pt-3 grid grid-cols-1 gap-0.5">
              <Capability ok={caps.write} label="Writes comedians, sets & bits" reason="Needs Nightshift running." />
              <Capability ok={caps.write} label={caps.write && !judgeAvailable() ? 'Laugh meter (grading with the text model; no judge lane)' : 'Laugh meter (judge)'} reason="Needs Nightshift running." />
              <Capability ok={caps.voice} label="Voices every bit" reason={caps.reasons.voice} />
              <Capability ok={caps.music} label="Walk-on music" reason={caps.reasons.music} />
              <Capability ok={caps.stills?.engine === 'Nightshift' || (ns.state === 'online' && !!caps.stills)} label="Backup still camera" reason={caps.reasons.stills || 'Used only when ComfyUI is off.'} />
            </div>
          </EngineCard>

          {/* ---------------- ComfyUI ---------------- */}
          <EngineCard title="ComfyUI" role="Shoots · animates" tone={comfyTone(comfy.state, eng.launching.comfy)} headline={comfyHeadline}>
            {comfy.state === 'online' ? (
              <div className="text-[13px] text-muted">
                {comfy.gpu ? <><span className="text-text">{comfy.gpu.name}</span> · {Math.round(comfy.gpu.vramTotal / 1024 ** 3)} GB · </> : null}
                ComfyUI {comfy.version || ''} at <span className="font-mono text-text">{comfy.origin?.replace(/^https?:\/\//, '').replace('/api/comfy', 'bridge')}</span>
              </div>
            ) : eng.launching.comfy ? (
              <div className="text-[13px] text-muted">Booting ComfyUI. The first launch takes about a minute.</div>
            ) : comfy.installed ? (
              <Button variant="primary" size="lg" icon="power" disabled={busy === 'comfy' || !comfy.canLaunch} onClick={() => start('comfy')}>Start ComfyUI</Button>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-[13px] text-muted">One command installs ComfyUI with FLUX stills and LTX-Video clips into <span className="font-mono">./engines</span>:</p>
                <CopyCommand cmd="npm run setup:comfy" />
                <p className="text-[12px] text-dim">Already use ComfyUI Desktop or portable? Just open it. Standupify finds it on port 8000 or 8188.</p>
              </div>
            )}

            {!eng.bridge && comfy.state !== 'online' && (
              <div className="flex gap-2">
                <input value={comfyUrl} onChange={e => setComfyUrl(e.target.value)} placeholder="http://127.0.0.1:8188 (start it with --enable-cors-header)"
                  className="flex-1 h-10 rounded-xl bg-black/40 border border-line px-3 text-sm outline-none focus:border-accent/60" />
                <Button onClick={() => connectComfyDirect(comfyUrl)}>Connect</Button>
              </div>
            )}

            {comfy.state === 'online' && (
              <div className="border-t border-line pt-3 flex flex-col gap-4">
                <RecipeList kind="Stills" list={caps.imageRecipes} selected={settings.imageRecipe} onSelect={id => set({ imageRecipe: id })} />
                <RecipeList kind="Clips" list={caps.videoRecipes} selected={settings.videoRecipe} onSelect={id => set({ videoRecipe: id })} />
              </div>
            )}

            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={`rounded-2xl border border-dashed px-4 py-4 flex items-center gap-3 transition-colors cursor-pointer ${dragging ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-accent/50'}`}>
              <Icon name="workflow" size={20} className="text-accent shrink-0" />
              <div className="text-[12.5px] leading-snug">
                <span className="font-medium">Drop any ComfyUI workflow</span>
                <span className="text-muted"> (Workflow › Export (API)). FLUX 3, LTX 2.5, Wan: it becomes a one-click recipe.</span>
              </div>
              <input ref={fileRef} type="file" accept=".json,application/json" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {customs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customs.map(r => (
                  <span key={r.recipe.id} className="inline-flex items-center gap-1.5 h-7 pl-3 pr-1.5 rounded-full bg-white/[0.05] border border-line text-[12px]">
                    {r.recipe.name}
                    <button onClick={() => removeWorkflow(r.recipe.id)} className="text-dim hover:text-live p-0.5"><Icon name="close" size={12} /></button>
                  </span>
                ))}
              </div>
            )}
          </EngineCard>
        </div>

        {/* ---------------- Preferences ---------------- */}
        <section className="mt-4 card p-4 sm:p-5 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
          <div>
            <div className="kicker mb-2">Writers' room</div>
            <Segmented<Quality> value={settings.quality} onChange={q => set({ quality: q })} options={[
              { value: 'auto', label: 'Auto', hint: 'Each job picks its own speed' },
              { value: 'fast', label: 'Fast', hint: 'Only models already loaded' },
              { value: 'deep', label: 'Best', hint: 'The strongest model on the box' },
              { value: 'local', label: 'Private', hint: 'Never leaves this computer' }
            ]} />
          </div>
          <div>
            <div className="kicker mb-2">Still camera</div>
            <Segmented<ImageEngine> value={settings.imageEngine} onChange={v => set({ imageEngine: v })} options={[
              { value: 'auto', label: 'Auto', hint: 'ComfyUI, else Nightshift' },
              { value: 'comfy', label: 'ComfyUI' },
              { value: 'nightshift', label: 'Nightshift' }
            ]} />
          </div>
          <div>
            <div className="kicker mb-2">Clip length</div>
            <Segmented<string> value={String(settings.clipSeconds)} onChange={v => set({ clipSeconds: Number(v) })} options={[
              { value: '3', label: '3 s' }, { value: '4', label: '4 s' }, { value: '6', label: '6 s' }, { value: '8', label: '8 s' }
            ]} />
          </div>
          <div>
            <div className="kicker mb-2">Media privacy</div>
            <Segmented<PrivacyFloor> value={privacy} onChange={v => { setPrivacy(v); setMediaPrivacy(v); }} options={[
              { value: 'local-only', label: 'This computer', hint: 'Renders never leave the machine' },
              { value: 'edge-only', label: 'My network' },
              { value: 'cloud-ok', label: 'Cloud OK' }
            ]} />
          </div>
          <label className="flex items-center justify-between gap-4">
            <span><span className="text-sm font-medium">Voice new bits</span><span className="block text-xs text-muted">Nightshift reads every joke aloud.</span></span>
            <Toggle on={settings.autoVoice} onChange={v => set({ autoVoice: v })} label="Voice new bits" />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span><span className="text-sm font-medium">Laugh meter</span><span className="block text-xs text-muted">Grade every bit like a club booker.</span></span>
            <Toggle on={settings.autoJudge} onChange={v => set({ autoJudge: v })} label="Laugh meter" />
          </label>
        </section>

        <div className="mt-4 flex justify-end">
          <Button variant="quiet" icon="redo" onClick={() => refreshEngines(true)}>Check again</Button>
        </div>
      </div>
    </Sheet>
  );
}
