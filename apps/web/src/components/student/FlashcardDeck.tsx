'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText, LayoutGrid, Layers, RotateCcw, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Flashcard } from '@/lib/types';
import { DownloadButton } from '../DownloadButton';
import { EmptyState, ProgressBar, Spinner } from '../ui';

export function FlashcardDeck({
  materialId,
  title,
  generating = false,
}: {
  materialId: string;
  title?: string;
  /** Cards are still being written (batch by batch): keep fetching new ones. */
  generating?: boolean;
}) {
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['flashcards', materialId],
    queryFn: () => apiRequest<Flashcard[]>(`/study-materials/${materialId}/flashcards`),
    refetchInterval: generating ? 10_000 : false,
  });
  const [order, setOrder] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [view, setView] = useState<'deck' | 'list'>('deck');
  const [known, setKnown] = useState<Set<string>>(new Set());

  // New cards arriving during generation are appended without losing the student's place.
  useEffect(() => {
    setOrder((prev) =>
      prev.length === 0 || prev.length > cards.length
        ? cards.map((_, i) => i)
        : [...prev, ...cards.slice(prev.length).map((_, i) => prev.length + i)],
    );
  }, [cards]);
  useEffect(() => {
    setIndex(0);
    setRevealed(false);
    setKnown(new Set());
  }, [materialId]);

  const ordered = useMemo(() => order.map((i) => cards[i]).filter(Boolean), [order, cards]);

  // Keyboard: ←/→ to move, space to flip (deck view only)
  useEffect(() => {
    if (view !== 'deck' || ordered.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') {
        e.preventDefault();
        setRevealed((r) => !r);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (isLoading) return <div className="card"><Spinner label="Loading flashcards…" /></div>;
  if (cards.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={Layers} title={generating ? 'Flashcards are being generated' : 'No flashcards'}>
          {generating
            ? 'The local AI model is writing cards for this material. They appear here automatically.'
            : 'No flashcards were generated for this material.'}
        </EmptyState>
      </div>
    );
  }

  const card = ordered[index] ?? cards[0];
  function go(delta: number) {
    setRevealed(false);
    setIndex((i) => (i + delta + ordered.length) % ordered.length);
  }
  function shuffle() {
    const next = [...order];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    setOrder(next);
    setIndex(0);
    setRevealed(false);
  }
  const stem = (title ?? 'flashcards').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'flashcards';

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-aqua-400" aria-hidden />
          <h2 className="font-semibold text-white">Flashcards</h2>
          <span className="badge-neutral">{cards.length} cards</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="segmented" role="group" aria-label="View">
            <button aria-pressed={view === 'deck'} onClick={() => setView('deck')} title="Study one card at a time">
              <Layers className="mr-1 inline h-3.5 w-3.5" aria-hidden />Deck
            </button>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')} title="See all cards">
              <LayoutGrid className="mr-1 inline h-3.5 w-3.5" aria-hidden />List
            </button>
          </div>
          <DownloadButton size="sm" path={`/study-materials/${materialId}/flashcards/export?format=pdf`} filename={`${stem}-flashcards.pdf`} icon={<FileText className="h-3.5 w-3.5" />}>
            PDF
          </DownloadButton>
          <DownloadButton size="sm" path={`/study-materials/${materialId}/flashcards/export?format=csv`} filename={`${stem}-flashcards.csv`} icon={<FileSpreadsheet className="h-3.5 w-3.5" />}>
            CSV
          </DownloadButton>
        </div>
      </div>

      {view === 'deck' ? (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="tabular-nums">{index + 1} / {ordered.length}</span>
            <div className="flex-1"><ProgressBar value={((index + 1) / ordered.length) * 100} /></div>
            <span className="tabular-nums text-emerald-300">{known.size} known</span>
          </div>

          <button
            onClick={() => setRevealed((r) => !r)}
            className="group w-full [perspective:1200px]"
            aria-label={revealed ? 'Show question' : 'Show answer'}
          >
            <div
              className={`relative min-h-56 w-full rounded-2xl transition-transform duration-500 [transform-style:preserve-3d] ${revealed ? '[transform:rotateY(180deg)]' : ''}`}
            >
              {/* Rendered as text nodes; React escapes model output (no dangerouslySetInnerHTML). */}
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-aqua-500/30 bg-gradient-to-br from-ink-800 to-ink-850 p-6 text-center [backface-visibility:hidden]">
                <span className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-aqua-400 uppercase">Question</span>
                <span className="text-lg font-medium text-white">{card.frontText}</span>
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-ink-800 to-ink-900 p-6 text-center [transform:rotateY(180deg)] [backface-visibility:hidden]">
                <span className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-emerald-300 uppercase">Answer</span>
                <span className="text-slate-200">{card.backText}</span>
              </div>
            </div>
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button className="btn-secondary" onClick={() => go(-1)} aria-label="Previous card">
              <ChevronLeft className="h-4 w-4" /> <span className="hidden sm:inline">Previous</span>
            </button>
            <div className="flex gap-2">
              <button className="btn-ghost btn-sm" onClick={shuffle} title="Shuffle"><Shuffle className="h-4 w-4" /> Shuffle</button>
              <button
                className={`btn-sm ${known.has(card.id) ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setKnown((k) => { const n = new Set(k); if (n.has(card.id)) n.delete(card.id); else n.add(card.id); return n; })}
              >
                {known.has(card.id) ? 'Known ✓' : 'Mark known'}
              </button>
              {known.size > 0 && (
                <button className="btn-ghost btn-sm" onClick={() => setKnown(new Set())} title="Reset progress"><RotateCcw className="h-4 w-4" /></button>
              )}
            </div>
            <button className="btn-secondary" onClick={() => go(1)} aria-label="Next card">
              <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <p className="text-center text-xs text-slate-500">Click the card or press space to flip · ← → to navigate</p>
        </>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2">
          {cards.map((c, i) => (
            <li key={c.id} className="panel p-4">
              <p className="text-[10px] font-semibold tracking-widest text-aqua-400 uppercase">Q{i + 1}</p>
              <p className="mt-1 font-medium text-white">{c.frontText}</p>
              <p className="mt-2 border-t border-ink-700 pt-2 text-sm text-slate-300">{c.backText}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
