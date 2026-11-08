'use client';

import { GraduationCap, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { UserRole } from '@/lib/roles';
import { GlobalSearch } from './GlobalSearch';
import { NAV_ICONS, type NavSection } from './nav-icons';
import { NotificationsMenu } from './NotificationsMenu';
import { ProfileMenu } from './ProfileMenu';

const COLLAPSE_KEY = 'edu.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell({
  role,
  workspaceLabel,
  sections,
  children,
}: {
  role: UserRole;
  workspaceLabel: string;
  sections: NavSection[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const home = sections[0]?.items[0]?.href ?? '/';

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => setMobileOpen(false), [pathname]); // close the drawer after navigating

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable: keep in-memory state */
      }
      return !c;
    });
  }

  const isActive = (href: string) => pathname === href || (href !== home && pathname.startsWith(href + '/'));

  const sidebar = (compact: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`flex h-16 items-center gap-3 border-b border-ink-700/60 ${compact ? 'justify-center px-2' : 'px-5'}`}>
        <Link href={home} className="flex items-center gap-3" aria-label="Edu Platform home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-aqua-400 to-aqua-600 text-ink-950 shadow-lg shadow-aqua-500/30">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          {!compact && (
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-white">Edu Platform</span>
              <span className="block text-[11px] text-slate-400">{workspaceLabel}</span>
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label="Main">
        {sections.map((section, i) => (
          <div key={section.heading ?? i}>
            {section.heading && !compact && (
              <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                {section.heading}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={compact ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex items-center gap-3 rounded-xl py-2.5 text-sm transition ${compact ? 'justify-center px-2' : 'px-3'} ${
                        active
                          ? 'bg-aqua-500/10 font-medium text-aqua-300'
                          : 'text-slate-400 hover:bg-ink-800 hover:text-white'
                      }`}
                    >
                      {active && <span className="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-aqua-400" aria-hidden />}
                      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                      {!compact && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={`border-t border-ink-700/60 p-3 ${compact ? 'flex justify-center' : ''}`}>
        <button
          onClick={toggleCollapsed}
          className={`hidden items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-ink-800 hover:text-white lg:flex ${compact ? '' : 'w-full'}`}
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {compact ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          {!compact && 'Collapse'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-ink-700/60 bg-ink-900/95 backdrop-blur transition-[width] duration-200 lg:block ${collapsed ? 'w-[76px]' : 'w-64'}`}
      >
        {sidebar(collapsed)}
      </aside>

      {/* Mobile drawer */}
      <div className={`fixed inset-0 z-40 lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`} aria-hidden={!mobileOpen}>
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity ${mobileOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-ink-700/60 bg-ink-900 shadow-2xl transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <button onClick={() => setMobileOpen(false)} className="icon-btn absolute top-3 right-3" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
          {sidebar(false)}
        </aside>
      </div>

      <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-ink-700/60 bg-ink-950/80 px-3 backdrop-blur-xl sm:gap-3 sm:px-6">
          <button className="icon-btn lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <GlobalSearch role={role} sections={sections} />
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <NotificationsMenu />
            <ProfileMenu role={role} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
