import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';

// The hosted web demo only (`npm run build:web`): a way from the sample
// engines to the real desktop app. The installers and downloads.json are
// copied next to the page by scripts/build-web.mjs.

declare const __WEB_DEMO__: boolean;
export const isWebDemo: boolean = __WEB_DEMO__;

const REPO = 'https://github.com/meterless/standupify';

interface Download { file: string; kind: 'exe' | 'msi'; size: number }
interface Downloads { version: string; files: Download[] }

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

export default function DownloadApp() {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Downloads | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('./downloads/downloads.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(setList).catch(() => setList(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const exe = list?.files.find(f => f.kind === 'exe');
  const msi = list?.files.find(f => f.kind === 'msi');

  return (
    <div ref={box} className="relative shrink-0">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="dialog" title="Download the full app"
        className="h-9 px-3.5 whitespace-nowrap rounded-full bg-accent text-accent-ink text-[12px] font-semibold flex items-center gap-2 hover:brightness-110 transition">
        <Icon name="download" size={14} /><span className="hidden min-[480px]:inline">Download</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Download Standupify"
          className="fixed left-4 right-4 top-[68px] max-h-[calc(100vh-84px)] overflow-y-auto sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px] sm:max-h-none rounded-2xl border border-line-strong bg-raised p-5 text-left shadow-[0_24px_80px_-20px_#000] z-50">
          <div className="kicker">The full studio</div>
          <h2 className="font-display text-[22px] leading-tight mt-1.5">Run it on your own GPU</h2>
          <p className="text-muted text-[13px] leading-relaxed mt-2">
            This demo runs sample engines in your browser. The desktop app is the real thing: Nightshift writes the comics, ComfyUI shoots and animates them, and the Circuit keeps going on its own.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {exe && (
              <a href={`./${exe.file}`} download
                className="h-11 px-4 rounded-full bg-accent text-accent-ink text-sm font-semibold flex items-center gap-2 hover:brightness-110 transition">
                <Icon name="download" size={16} />Windows installer<span className="ml-auto text-[12px] font-medium opacity-70">.exe · {mb(exe.size)}</span>
              </a>
            )}
            {msi && (
              <a href={`./${msi.file}`} download
                className="h-10 px-4 rounded-full border border-line bg-white/[0.06] hover:bg-white/[0.1] text-sm font-medium flex items-center gap-2 transition-colors">
                <Icon name="download" size={15} />Windows MSI<span className="ml-auto text-[12px] text-muted">.msi · {mb(msi.size)}</span>
              </a>
            )}
            <a href={REPO} target="_blank" rel="noopener"
              className="h-10 px-4 rounded-full text-muted hover:text-text hover:bg-white/[0.06] text-sm font-medium flex items-center gap-2 transition-colors">
              Mac, Linux or source: <span className="underline">GitHub</span><span className="ml-auto text-[12px]">npm start</span>
            </a>
          </div>
          <ul className="mt-4 space-y-1.5 text-[12px] text-muted leading-relaxed list-disc pl-4">
            <li>Windows 10 or 11 (64-bit). Node is included.</li>
            <li>Needs <a className="underline hover:text-text" href="https://meterless.ai" target="_blank" rel="noopener">Nightshift</a> and ComfyUI on the same PC. The app finds them and starts them for you; Engines explains anything that's missing.</li>
            <li>The installer isn't code-signed yet, so Windows may warn you. Choose <span className="text-text">More info → Run anyway</span>.</li>
            {list?.version && <li>Version {list.version}.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
