'use client';

import { Loader2, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode, type RefObject } from 'react';
import type { MaterialStatus } from '@/lib/types';

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold tracking-widest text-aqua-400 uppercase">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'aqua',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: 'aqua' | 'violet' | 'amber' | 'green';
}) {
  const toneClass = {
    aqua: 'bg-aqua-500/10 text-aqua-300 ring-aqua-500/30',
    violet: 'bg-violet-500/10 text-violet-300 ring-violet-500/30',
    amber: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
    green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  }[tone];
  return (
    <div className="card flex items-start gap-4">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${toneClass}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
        {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-800 text-aqua-300">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <p className="font-medium text-white">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-slate-400">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-400" role="status">
      <Loader2 className="h-4 w-4 animate-spin text-aqua-400" aria-hidden />
      {label}
    </p>
  );
}

export function ProgressBar({ value, tone }: { value: number; tone?: 'auto' | 'aqua' }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color =
    tone === 'aqua' || tone === undefined
      ? 'bg-gradient-to-r from-aqua-600 to-aqua-400'
      : pct < 50
        ? 'bg-red-400'
        : pct <= 70
          ? 'bg-amber-400'
          : 'bg-emerald-400';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Circular score indicator. */
export function ScoreRing({ score, size = 112 }: { score: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const r = 42;
  const c = 2 * Math.PI * r;
  const color = pct > 70 ? 'var(--color-aqua-400)' : pct >= 50 ? '#fbbf24' : '#f87171';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Score ${Math.round(pct)}%`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-ink-700)" strokeWidth="9" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 50 50)"
      />
      <text x="50" y="55" textAnchor="middle" fontSize="20" fontWeight="700" fill="#fff">
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

export function MaterialStatusBadge({ status }: { status: MaterialStatus }) {
  const cls = {
    QUEUED: 'badge-neutral',
    PROCESSING: 'badge-amber',
    READY: 'badge-green',
    FAILED: 'badge-red',
  }[status];
  return (
    <span className={cls}>
      {(status === 'PROCESSING' || status === 'QUEUED') && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}

/** Closes a popover on outside click or Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function timeAgo(value: string) {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}
