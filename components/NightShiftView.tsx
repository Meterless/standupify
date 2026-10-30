import React, { useEffect, useState } from 'react';
import { AutopilotJob, Comedian } from '../types';
import { onStatus, AutopilotStatus, triggerCycleNow } from '../services/autopilot';
import { getRepository } from '../services/repository';
import { useEngines } from '../services/engines';
import { AISettings } from '../types';
import { Button, Icon, IconName, Still, Toggle, notifyError, notify } from './ui';
import { venueById } from '../services/comfy/presets';

const AGENT: Record<string, { icon: IconName; label: string; doing: string }> = {
  writer: { icon: 'sparkle', label: 'wrote a new set', doing: 'writing a new set' },
  clipper: { icon: 'film', label: 'cut clips', doing: 'cutting clips' },
  promoter: { icon: 'image', label: 'made a promo poster', doing: 'making a promo poster' },
  scout: { icon: 'arrow', label: 'drafted outreach', doing: 'drafting outreach' },
  analytics: { icon: 'laugh', label: 'read the room', doing: 'reading the room' },
  booker: { icon: 'grid', label: 'booked the release queue', doing: 'booking the release queue' }
};

function ago(ts?: number) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export default function NightShiftView({ comedians, running, onToggle, onToggleComedian, onUpdateComedian, settings }: {
  comedians: Comedian[];
  running: boolean;
  onToggle: () => void | Promise<void>;
  onToggleComedian: (c: Comedian, on: boolean) => void;
  onUpdateComedian: (c: Comedian) => void;
  settings: AISettings;
}) {
  const eng = useEngines();
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [history, setHistory] = useState<AutopilotJob[]>([]);
  const [runningNow, setRunningNow] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    getRepository().listJobs().then(j => setHistory(j.slice(0, 30)));
    return onStatus(s => { setStatus(s); setHistory(s.history); });
  }, []);

  const onShift = comedians.filter(c => c.autopilotConfig.enabled && c.status === 'active');
  const byId = new Map(comedians.map(c => [c.id, c]));
  const ready = eng.nightshift.state === 'online';
  const toggle = async () => {
    setToggling(true);
    try { await onToggle(); } catch (e) { notifyError(e); }
    finally { setToggling(false); }
  };

  const runNow = async (c: Comedian) => {
    setRunningNow(c.id);
    try { await triggerCycleNow(c, settings); notify(`${c.name} finished a shift.`, { tone: 'ok' }); }
    catch (e) { notifyError(e); }
    finally { setRunningNow(null); }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-8 pt-12 pb-28">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-8 items-start">
        <div className="min-w-0">
          <div className="kicker">Night Shift · powered by Nightshift</div>
          <h1 className="font-display text-[44px] sm:text-[56px] md:text-[76px] leading-[0.95] mt-3">Keep the club open<br /><span className="italic text-accent">while you sleep.</span></h1>
          <p className="text-muted mt-5 max-w-xl">Every comedian on the shift writes a new set, gets it shot, cuts clips, drafts a promo poster and outreach, then grades the room. On your GPU, overnight. Nothing is posted anywhere; it all waits in your roster.</p>

          <div className={`mt-8 card p-6 flex flex-wrap items-center gap-5 ${running ? 'border-live/40' : ''}`}>
            <div className={`w-14 h-14 rounded-2xl grid place-items-center ${running ? 'bg-live/15 text-live' : 'bg-white/[0.05] text-muted'}`}>
              <Icon name="moon" size={26} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="text-lg font-semibold">{status?.stopping ? 'Finishing the current step' : running ? 'The club is open' : status?.currentJob ? 'One shift in progress' : 'The club is closed'}</div>
              <div className="text-[13px] text-muted">
                {status?.stopping ? 'Progress is saved. No new steps will start.'
                  : status?.currentJob ? `${byId.get(status.currentJob.comedianId)?.name || 'Someone'} is ${AGENT[status.currentJob.agent]?.doing || 'working'}`
                  : running ? status?.waiting || `${onShift.length} on the shift · the next set starts when it is due`
                  : onShift.length ? `${onShift.length} comedian${onShift.length === 1 ? '' : 's'} ready to work` : 'Put someone on the shift below first.'}
              </div>
            </div>
            <Button variant={running ? 'ghost' : 'primary'} size="lg" icon={running ? 'pause' : 'moon'} onClick={toggle} disabled={toggling || !!status?.stopping || (!running && !onShift.length)}>
              {toggling ? 'Saving…' : running ? 'Close the club' : 'Open the club'}
            </Button>
          </div>
          <p className="mt-3 px-1 text-[12px] text-muted">
            {status?.owner === 'station' ? 'Runs in your local Station. You can close this tab; Night Shift resumes when the app restarts.' : 'Runs in this browser. Keep the tab open; your shift resumes when you return.'}
          </p>
          {status?.error && <p role="status" className="mt-3 text-[12px] text-live">Last issue: {status.error}. Completed work is saved in the roster.</p>}

          <div className="mt-8">
            <div className="kicker mb-3">Who's on</div>
            {!comedians.length && <p className="text-muted text-sm">Cast a comedian first.</p>}
            <div className="flex flex-col gap-2">
              {comedians.map(c => {
                const on = c.autopilotConfig.enabled && c.status === 'active';
                return (
                  <div key={c.id} className="flex items-center gap-4 p-3 rounded-2xl border border-line bg-surface">
                    <Still src={c.headshotUrl || c.avatarImage} alt="" className="w-12 h-12 rounded-xl shrink-0" hue={venueById(c.venue).swatch[0]} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-[12px] text-muted truncate">{c.autopilotConfig.lastSetAt ? `last shift ${ago(c.autopilotConfig.lastSetAt)}` : 'never worked a shift'}</div>
                    </div>
                    <label className="hidden md:flex items-center gap-2 text-[12px] text-muted">
                      Animate clips
                      <Toggle on={c.autopilotConfig.generateVideo} onChange={v => onUpdateComedian({ ...c, autopilotConfig: { ...c.autopilotConfig, generateVideo: v } })} label="Animate clips" />
                    </label>
                    <Button size="sm" variant="quiet" icon="bolt" disabled={!ready || runningNow != null} onClick={() => runNow(c)}>{runningNow === c.id ? 'Working…' : 'Run now'}</Button>
                    <Toggle on={on} onChange={v => onToggleComedian(c, v)} label={`Night Shift for ${c.name}`} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="card p-5 lg:sticky lg:top-24">
          <div className="kicker mb-4">The shift log</div>
          {!history.length && <p className="text-[13px] text-muted">Nothing yet. Open the club and this fills up.</p>}
          <ol className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
            {history.map(j => {
              const a = AGENT[j.agent] || { icon: 'sparkle' as IconName, label: j.agent, doing: j.agent };
              return (
                <li key={j.id} className="flex gap-3 items-start">
                  <span className={`mt-0.5 w-7 h-7 rounded-lg grid place-items-center shrink-0 ${j.status === 'failed' ? 'bg-live/10 text-live' : j.status === 'running' ? 'bg-accent-soft text-accent' : 'bg-white/[0.05] text-muted'}`}>
                    <Icon name={a.icon} size={14} />
                  </span>
                  <div className="min-w-0 text-[13px] leading-snug">
                    <span className="font-medium">{byId.get(j.comedianId)?.name || 'Someone'}</span>{' '}
                    <span className="text-muted">{j.status === 'running' ? `is ${a.doing}` :j.status === 'failed' ? `couldn't finish (${j.agent})` : a.label}</span>
                    {j.error && <div className="text-[11px] text-live/80 truncate">{j.error}</div>}
                    <div className="text-[11px] text-dim">{ago(j.finishedAt || j.startedAt || j.createdAt)}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </div>
  );
}
