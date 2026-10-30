import React, { useState } from 'react';
import { useTasks, clearFinished, StudioTask } from '../services/tasks';
import { Icon, Progress } from './ui';

const KIND_ICON = { text: 'sparkle', image: 'image', video: 'film', audio: 'wave' } as const;

function elapsed(t: StudioTask) {
  const s = Math.round(((t.endedAt || Date.now()) - t.startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Row({ t }: { t: StudioTask }) {
  return (
    <div className="flex gap-3 items-center px-3 py-2.5 rounded-2xl hover:bg-white/[0.04] transition-colors">
      <div className="w-11 h-11 rounded-xl overflow-hidden bg-raised shrink-0 grid place-items-center relative">
        {t.preview
          ? <img src={t.preview} alt="" className="w-full h-full object-cover" />
          : <Icon name={KIND_ICON[t.kind]} size={17} className={t.status === 'failed' ? 'text-live' : t.status === 'done' ? 'text-ok' : 'text-accent breathe'} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium truncate">{t.label}</div>
        <div className="text-[11px] text-muted truncate">
          <span className="font-mono">{t.engine}</span>
          {' · '}
          {t.status === 'failed' ? <span className="text-live">{t.error}</span> : t.status === 'done' ? `done in ${elapsed(t)}` : `${t.stage || 'working'} · ${elapsed(t)}`}
        </div>
        {t.status === 'running' && <Progress value={t.progress} className="mt-1.5" />}
      </div>
      {t.cancel && (
        <button onClick={t.cancel} className="text-dim hover:text-text p-1" title="Cancel"><Icon name="close" size={14} /></button>
      )}
    </div>
  );
}

/** Every render in flight. Collapsed to one pill until you want the detail. */
export default function RenderDock() {
  const tasks = useTasks();
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  React.useEffect(() => {
    if (!tasks.some(t => t.status === 'running')) return;
    const id = setInterval(() => force(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [tasks]);

  if (!tasks.length) return null;
  const running = tasks.filter(t => t.status === 'running');
  const failed = tasks.filter(t => t.status === 'failed').length;
  const known = running.filter(t => t.progress >= 0);
  const overall = running.length ? (known.length ? known.reduce((a, t) => a + t.progress, 0) / running.length : -1) : 1;
  const thumbs = running.filter(t => t.preview).slice(0, 3);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 glass rounded-full h-12 pl-2 pr-4 flex items-center gap-3 shadow-2xl animate-in slide-in-from-bottom-3 fade-in duration-300 hover:border-line-strong">
        <span className="flex -space-x-2">
          {thumbs.length
            ? thumbs.map(t => <img key={t.id} src={t.preview} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-ink" />)
            : <span className={`w-8 h-8 rounded-full grid place-items-center ${running.length ? 'bg-accent-soft text-accent' : failed ? 'bg-live/15 text-live' : 'bg-ok/15 text-ok'}`}>
                <Icon name={running.length ? 'stack' : failed ? 'alert' : 'check'} size={15} />
              </span>}
        </span>
        <span className="text-[13px] font-medium whitespace-nowrap">
          {running.length ? `${running.length} rendering` : failed ? `${failed} need${failed === 1 ? 's' : ''} a look` : 'All done'}
        </span>
        {running.length > 0 && <Progress value={overall} className="w-20" />}
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(92vw,360px)] glass rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-3 fade-in duration-300">
      <button onClick={() => setOpen(false)} className="w-full flex items-center gap-2.5 px-4 h-12 text-left">
        <span className={`w-2 h-2 rounded-full ${running.length ? 'bg-accent breathe' : failed ? 'bg-live' : 'bg-ok'}`} />
        <span className="text-[13px] font-semibold">{running.length ? `${running.length} rendering` : failed ? `${failed} need${failed === 1 ? 's' : ''} a look` : 'All done'}</span>
        <span className="ml-auto text-muted"><Icon name="close" size={15} /></span>
      </button>
      <div className="px-1.5 pb-2 max-h-[46vh] overflow-y-auto">
        {tasks.map(t => <Row key={t.id} t={t} />)}
        {tasks.some(t => t.status !== 'running') && (
          <button onClick={clearFinished} className="w-full text-[11px] text-dim hover:text-muted py-1.5">Clear finished</button>
        )}
      </div>
    </div>
  );
}
