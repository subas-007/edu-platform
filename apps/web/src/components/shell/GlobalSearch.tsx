'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { UserRole } from '@/lib/roles';
import type { Paginated, StudyMaterial } from '@/lib/types';
import { useDismiss } from '../ui';
import { NAV_ICONS, type NavSection } from './nav-icons';

interface Result {
  key: string;
  label: string;
  sublabel: string;
  href: string;
  kind: 'page' | 'material';
}

/** Searches the workspace's pages and the materials the user can read (server-side title search). */
export function GlobalSearch({ role, sections }: { role: UserRole; sections: NavSection[] }) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, open, close);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 220);
    return () => clearTimeout(t);
  }, [term]);

  // "/" or Ctrl/Cmd+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const materials = useQuery({
    queryKey: ['search-materials', debounced],
    queryFn: () =>
      apiRequest<Paginated<StudyMaterial>>(`/study-materials?pageSize=6&search=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  const results = useMemo<Result[]>(() => {
    const q = debounced.toLowerCase();
    if (!q) return [];
    const pages: Result[] = sections
      .flatMap((s) => s.items)
      .filter((i) => i.label.toLowerCase().includes(q))
      .map((i) => ({ key: `page-${i.href}`, label: i.label, sublabel: 'Go to page', href: i.href, kind: 'page' }));
    const base = role === 'STUDENT' ? '/student' : role === 'ADMIN' ? '/admin' : '/examiner';
    const docs: Result[] = (materials.data?.items ?? []).map((m) => ({
      key: `material-${m.id}`,
      label: m.title,
      sublabel: `${m.fileType} · ${m.status.toLowerCase()}`,
      href:
        role === 'STUDENT'
          ? m.status === 'READY'
            ? `/student/materials/${m.id}`
            : '/student/materials'
          : m._count.examQuestions > 0
            ? `${base}/question-bank?materialId=${m.id}`
            : `${base}/materials`,
      kind: 'material',
    }));
    return [...pages, ...docs].slice(0, 9);
  }, [debounced, sections, materials.data, role]);

  useEffect(() => setHighlight(0), [results.length]);

  function go(result: Result | undefined) {
    if (!result) return;
    setOpen(false);
    setTerm('');
    router.push(result.href);
  }

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:max-w-xl">
      <label className="relative block">
        <span className="sr-only">Search</span>
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(results[highlight]);
            }
          }}
          placeholder="Search materials and pages…"
          className="h-10 w-full rounded-xl border border-ink-700 bg-ink-900/80 pr-12 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus:border-aqua-400 focus:ring-2 focus:ring-aqua-400/25 focus:outline-none"
          role="combobox"
          aria-expanded={open && debounced.length > 0}
          aria-controls="global-search-results"
          aria-autocomplete="list"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-md border border-ink-600 px-1.5 text-[10px] text-slate-500 sm:block">
          /
        </kbd>
      </label>

      {open && debounced.length > 0 && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-12 right-0 left-0 z-50 overflow-hidden rounded-2xl border border-ink-600 bg-ink-900 shadow-2xl shadow-black/50"
        >
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              {materials.isFetching ? 'Searching…' : `No results for “${debounced}”`}
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto py-2">
              {results.map((r, i) => {
                const Icon =
                  r.kind === 'page'
                    ? NAV_ICONS[sections.flatMap((s) => s.items).find((n) => n.href === r.href)?.icon ?? 'dashboard']
                    : FileText;
                return (
                  <li key={r.key} role="option" aria-selected={i === highlight}>
                    <button
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => go(r)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === highlight ? 'bg-ink-800' : ''}`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-aqua-300">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white">{r.label}</span>
                        <span className="block truncate text-xs text-slate-500">{r.sublabel}</span>
                      </span>
                      {i === highlight && <ArrowRight className="h-4 w-4 text-slate-500" aria-hidden />}
                    </button>
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
