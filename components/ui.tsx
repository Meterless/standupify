import React, { useEffect, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------
// Icons — one stroke family, 1.6px, currentColor.
// ---------------------------------------------------------------------

const PATHS: Record<string, React.ReactNode> = {
  home: <><path d="M3 10l9-7 9 7M5 9v11h14V9M9 20v-7h6v7" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />,
  play: <path d="M7 4.5v15l12.5-7.5L7 4.5z" />,
  pause: <><rect x="6.5" y="4.5" width="4" height="15" rx="1" /><rect x="13.5" y="4.5" width="4" height="15" rx="1" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  wave: <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />,
  music: <><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>,
  redo: <><path d="M20 11a8 8 0 1 0-2.3 5.6" /><path d="M20 4v7h-7" /></>,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" />,
  chip: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  dice: <><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="9" cy="9" r="1" fill="currentColor" /><circle cx="15" cy="15" r="1" fill="currentColor" /><circle cx="15" cy="9" r="1" fill="currentColor" /><circle cx="9" cy="15" r="1" fill="currentColor" /></>,
  laugh: <><circle cx="12" cy="12" r="9" /><path d="M7.5 13.5a4.5 4.5 0 0 0 9 0z" /><path d="M8.5 9.5h1.5M14 9.5h1.5" /></>,
  workflow: <><rect x="3" y="4" width="6" height="5" rx="1.5" /><rect x="15" y="15" width="6" height="5" rx="1.5" /><rect x="15" y="4" width="6" height="5" rx="1.5" /><path d="M9 6.5h6M18 9v6M9 6.5c3 0 3 11 6 11" /></>,
  power: <path d="M12 3v8M6.3 7a8 8 0 1 0 11.4 0" />,
  stack: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  dots: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className = '' }: { name: IconName; size?: number; className?: string }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

export function Button({ variant = 'ghost', size = 'md', icon, children, className = '', ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-full transition-all duration-200 select-none disabled:opacity-40 active:scale-[0.98]';
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-10 px-4 text-sm', lg: 'h-14 px-7 text-base' }[size];
  const variants: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-[0_8px_30px_-8px_rgb(255_181_71/0.55)]',
    ghost: 'bg-white/[0.06] text-text hover:bg-white/[0.1] border border-line',
    quiet: 'text-muted hover:text-text hover:bg-white/[0.06]',
    danger: 'text-live hover:bg-live/10'
  };
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'lg' ? 20 : 16} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className = '', active, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; active?: boolean }) {
  return (
    <button aria-label={label} title={label}
      className={`w-9 h-9 inline-flex items-center justify-center rounded-full transition-colors disabled:opacity-30 ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text hover:bg-white/[0.07]'} ${className}`}
      {...rest}>
      <Icon name={icon} size={17} />
    </button>
  );
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------

export type Tone = 'ok' | 'warn' | 'off' | 'busy';

export function Dot({ tone, className = '' }: { tone: Tone; className?: string }) {
  const color = { ok: 'bg-ok', warn: 'bg-accent', off: 'bg-dim', busy: 'bg-accent breathe' }[tone];
  return (
    <span className={`relative inline-flex w-2 h-2 ${className}`}>
      {tone === 'ok' && <span className="absolute inset-0 rounded-full bg-ok/50 animate-ping [animation-duration:2.4s]" />}
      <span className={`relative w-2 h-2 rounded-full ${color}`} />
    </span>
  );
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  const indeterminate = value < 0;
  return (
    <div className={`h-1 rounded-full bg-white/[0.08] overflow-hidden ${className}`}>
      {indeterminate
        ? <div className="h-full w-full shimmer" />
        : <div className="h-full bg-accent rounded-full transition-[width] duration-500" style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }:
  { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex flex-wrap max-w-full p-1 rounded-[20px] bg-white/[0.05] border border-line">
      {options.map(o => (
        <button key={o.value} title={o.hint} onClick={() => onChange(o.value)}
          className={`${size === 'sm' ? 'h-7 px-3 text-xs' : 'h-8 px-4 text-[13px]'} rounded-full font-medium transition-all ${value === o.value ? 'bg-text text-ink shadow' : 'text-muted hover:text-text'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-white/[0.12]'}`}>
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${on ? 'left-5' : 'left-1'}`} />
    </button>
  );
}

// ---------------------------------------------------------------------
// Sheet (modal panel)
// ---------------------------------------------------------------------

export function Sheet({ open, onClose, children, width = 'max-w-3xl' }: { open: boolean; onClose: () => void; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:p-4 md:p-10 overflow-y-auto animate-in fade-in duration-200">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} glass rounded-[28px] shadow-2xl animate-in slide-in-from-bottom-4 zoom-in-[0.98] duration-300`}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------

interface Toast { id: number; text: string; fix?: string; tone: 'error' | 'ok' | 'info'; action?: { label: string; run: () => void } }
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
const emitToasts = () => { toasts = [...toasts]; toastListeners.forEach(l => l()); };

/** Logged prose (events written by older builds or by the model) shown with plain punctuation. */
export const plainText = (s: string) => String(s || '').replace(/\s*—\s*/g, ', ').replace(/,\s*([,.;:!?])/g, '$1');

export function notify(text: string, opts: Partial<Omit<Toast, 'id' | 'text'>> = {}) {
  const t: Toast = { id: Date.now() + Math.random(), text, tone: 'info', ...opts };
  toasts = [...toasts.slice(-3), t];
  emitToasts();
  setTimeout(() => { toasts = toasts.filter(x => x.id !== t.id); emitToasts(); }, t.tone === 'error' ? 9000 : 4500);
}

export function notifyError(e: unknown, action?: Toast['action']) {
  const any = e as any;
  notify(String(any?.message || e), { tone: 'error', fix: Array.isArray(any?.fix) ? any.fix[0] : undefined, action });
}

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => { toastListeners.add(l); return () => { toastListeners.delete(l); }; },
    () => toasts, () => toasts
  );
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 w-[min(92vw,460px)] pointer-events-none">
      {list.map(t => (
        <div key={t.id} className="glass rounded-2xl px-4 py-3 shadow-2xl pointer-events-auto animate-in slide-in-from-top-2 fade-in duration-300 flex gap-3 items-start">
          <span className={`mt-0.5 ${t.tone === 'error' ? 'text-live' : t.tone === 'ok' ? 'text-ok' : 'text-accent'}`}>
            <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'ok' ? 'check' : 'sparkle'} size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm leading-snug">{t.text}</div>
            {t.fix && <div className="text-xs text-muted mt-1">{t.fix}</div>}
          </div>
          {t.action && (
            <button className="text-xs font-semibold text-accent hover:underline shrink-0 mt-0.5" onClick={() => { t.action!.run(); toasts = toasts.filter(x => x.id !== t.id); emitToasts(); }}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Stage illustration — what a still will look like before one exists.
// ---------------------------------------------------------------------

export function StageArt({ className = '', hue = '#7a2e1c' }: { className?: string; hue?: string }) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`wall${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hue} stopOpacity="0.55" />
          <stop offset="1" stopColor="#0b0b0c" />
        </linearGradient>
        <radialGradient id={`spot${id}`} cx="0.5" cy="0.15" r="0.75">
          <stop offset="0" stopColor="#ffd9a0" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#ffb547" stopOpacity="0.12" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <pattern id={`brick${id}`} width="40" height="20" patternUnits="userSpaceOnUse">
          <path d="M0 0h40M0 10h40M0 20h40M20 0v10M0 10v10M40 10v10" stroke="#000" strokeOpacity="0.35" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect width="400" height="300" fill={`url(#wall${id})`} />
      <rect width="400" height="230" fill={`url(#brick${id})`} />
      <rect width="400" height="300" fill={`url(#spot${id})`} />
      <rect y="232" width="400" height="68" fill="#0b0b0c" />
      <ellipse cx="200" cy="236" rx="110" ry="10" fill="#ffb547" opacity="0.15" />
      <g fill="#060607">
        <circle cx="200" cy="112" r="17" />
        <path d="M176 236 L182 150 Q200 132 218 150 L224 236 Z" />
        <path d="M216 156 L238 128 L244 132 L224 164 Z" />
        <rect x="236" y="116" width="7" height="14" rx="3.5" transform="rotate(25 240 123)" />
        <path d="M150 236 L152 168 M146 168 h12" stroke="#060607" strokeWidth="3" />
        <rect x="140" y="214" width="28" height="4" />
        <path d="M144 218 L140 236 M164 218 L168 236" stroke="#060607" strokeWidth="3" />
      </g>
      <g fill="#000" opacity="0.85">
        {[30, 85, 140, 260, 315, 370].map((x, i) => <ellipse key={x} cx={x} cy={300} rx="30" ry={38 + (i % 2) * 6} />)}
      </g>
    </svg>
  );
}

/** A still, or the stage illustration while there is none. */
export function Still({ src, alt, className = '', hue, imgClassName = '' }: { src?: string; alt: string; className?: string; hue?: string; imgClassName?: string }) {
  return (
    <div className={`relative overflow-hidden bg-raised ${className}`}>
      {src ? <img src={src} alt={alt} className={`w-full h-full object-cover ${imgClassName}`} draggable={false} /> : <StageArt className="w-full h-full" hue={hue} />}
    </div>
  );
}
