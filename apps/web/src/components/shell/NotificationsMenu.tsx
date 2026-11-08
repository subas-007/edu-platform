'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Award, Bell, CheckCircle2, ClipboardList, GraduationCap } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { NotificationItem } from '@/lib/types';
import { timeAgo, useDismiss } from '../ui';

const SEEN_KEY = 'edu.notifications.seen';

const KIND_ICON = {
  'material-ready': { icon: CheckCircle2, cls: 'text-emerald-300 bg-emerald-500/10' },
  'material-failed': { icon: AlertTriangle, cls: 'text-red-300 bg-red-500/10' },
  'new-program': { icon: GraduationCap, cls: 'text-aqua-300 bg-aqua-500/10' },
  certificate: { icon: Award, cls: 'text-amber-300 bg-amber-500/10' },
  'review-queue': { icon: ClipboardList, cls: 'text-violet-300 bg-violet-500/10' },
} as const;

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  useEffect(() => setSeen(readSeen()), []);

  const { data: items = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiRequest<NotificationItem[]>('/notifications'),
    refetchInterval: 60_000,
  });
  const unread = items.filter((n) => !seen.has(n.id)).length;

  function markAllRead() {
    const next = new Set(items.map((n) => n.id)); // only current ids, so the list cannot grow unbounded
    setSeen(next);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="icon-btn relative"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-aqua-400 px-1 text-[10px] font-bold text-ink-950">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:top-12 sm:right-0 sm:w-96">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            {unread > 0 && (
              <button className="text-xs text-aqua-300 hover:underline" onClick={markAllRead}>
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-ink-700/60 overflow-y-auto">
              {items.map((n) => {
                const { icon: Icon, cls } = KIND_ICON[n.kind];
                const isUnread = !seen.has(n.id);
                return (
                  <li key={n.id}>
                    <Link
                      href={n.href}
                      onClick={() => {
                        const next = new Set(seen).add(n.id);
                        setSeen(next);
                        try {
                          localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
                        } catch {
                          /* ignore */
                        }
                        setOpen(false);
                      }}
                      className="flex gap-3 px-4 py-3 transition hover:bg-ink-800"
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${cls}`}>
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${isUnread ? 'font-semibold text-white' : 'text-slate-300'}`}>{n.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-400">{n.body}</span>
                        <span className="mt-1 block text-[11px] text-slate-500">{timeAgo(n.createdAt)}</span>
                      </span>
                      {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-aqua-400" aria-label="Unread" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
