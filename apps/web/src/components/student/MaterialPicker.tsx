'use client';

import { Search } from 'lucide-react';
import { useState } from 'react';
import type { StudyMaterial } from '@/lib/types';

/** Selectable list of materials (single or multi select), used by flashcards, practice and tutor. */
export function MaterialPicker({
  materials,
  selected,
  onToggle,
  multiple = false,
  metric,
  emptyText = 'No ready materials yet.',
}: {
  materials: StudyMaterial[];
  selected: string[];
  onToggle: (id: string) => void;
  multiple?: boolean;
  metric?: (m: StudyMaterial) => string;
  emptyText?: string;
}) {
  const [filter, setFilter] = useState('');
  const visible = materials.filter((m) => m.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {materials.length > 6 && (
        <label className="relative block">
          <span className="sr-only">Filter documents</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input className="input pl-9" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
      )}
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto pr-1" role={multiple ? 'group' : 'radiogroup'}>
          {visible.map((m) => {
            const isSelected = selected.includes(m.id);
            return (
              <li key={m.id}>
                <button
                  onClick={() => onToggle(m.id)}
                  role={multiple ? 'checkbox' : 'radio'}
                  aria-checked={isSelected}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    isSelected
                      ? 'border-aqua-500/50 bg-aqua-500/10 text-white'
                      : 'border-transparent text-slate-300 hover:border-ink-600 hover:bg-ink-800'
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center border ${multiple ? 'rounded' : 'rounded-full'} ${
                      isSelected ? 'border-aqua-400 bg-aqua-400' : 'border-ink-500'
                    }`}
                    aria-hidden
                  >
                    {isSelected && <span className={`bg-ink-950 ${multiple ? 'h-2 w-2 rounded-sm' : 'h-1.5 w-1.5 rounded-full'}`} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.title}</span>
                  {metric && <span className="shrink-0 text-xs text-slate-500">{metric(m)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
