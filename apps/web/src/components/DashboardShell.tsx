'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiRequest } from '@/lib/api-client';

export interface NavItem {
  href: string;
  label: string;
}

export function DashboardShell({
  title,
  navItems,
  children,
}: {
  title: string;
  navItems: NavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();

  async function handleLogout() {
    await apiRequest('/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-6 text-lg font-semibold text-indigo-700">{title}</p>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm ${active ? 'bg-indigo-50 font-medium text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={handleLogout} className="btn-secondary mt-8 w-full">Sign out</button>
      </aside>
      <main className="flex-1 space-y-6 p-8">{children}</main>
    </div>
  );
}
