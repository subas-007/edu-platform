'use client';

import { Award, ChevronDown, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { UserRole } from '@/lib/roles';
import { displayName, initials, useSessionUser } from '@/lib/use-session';
import { useDismiss } from '../ui';

const ROLE_LABEL: Record<UserRole, string> = { STUDENT: 'Student', EXAMINER: 'Examiner', ADMIN: 'Administrator' };

export function ProfileMenu({ role }: { role: UserRole }) {
  const { data: user } = useSessionUser();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  async function signOut() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl py-1 pr-2 pl-1 transition hover:bg-ink-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-aqua-400 to-ink-500 text-xs font-bold text-ink-950">
          {initials(user)}
        </span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-36 truncate text-sm font-medium text-white">{displayName(user) || '…'}</span>
          <span className="block text-[11px] text-slate-400">{ROLE_LABEL[role]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-500 md:block" aria-hidden />
      </button>

      {open && (
        <div role="menu" className="absolute top-12 right-0 z-50 w-64 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-2xl shadow-black/50">
          <div className="border-b border-ink-700 px-4 py-3">
            <p className="truncate text-sm font-semibold text-white">{displayName(user)}</p>
            <p className="truncate text-xs text-slate-400">{user?.email}</p>
            <span className="badge-aqua mt-2">{ROLE_LABEL[role]}</span>
          </div>
          <div className="p-1.5">
            {role === 'STUDENT' && (
              <Link href="/student/history" role="menuitem" onClick={close}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-ink-800 hover:text-white">
                <Award className="h-4 w-4" aria-hidden /> Results &amp; certificates
              </Link>
            )}
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-slate-500">
              <UserRound className="h-4 w-4" aria-hidden /> Profile details are managed by your administrator
            </div>
            <button onClick={signOut} role="menuitem"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
