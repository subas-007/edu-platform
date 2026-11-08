'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Flashcard } from '@/lib/types';

export function FlashcardDeck({ materialId }: { materialId: string }) {
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['flashcards', materialId],
    queryFn: () => apiRequest<Flashcard[]>(`/study-materials/${materialId}/flashcards`),
  });
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  if (isLoading) return <p className="text-sm text-slate-500">Loading flashcards…</p>;
  if (cards.length === 0) return <p className="text-sm text-slate-500">Flashcards are being generated…</p>;

  const card = cards[index];
  const go = (delta: number) => {
    setRevealed(false);
    setIndex((i) => (i + delta + cards.length) % cards.length);
  };

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Flashcards</h2>
        <span className="text-xs text-slate-500">{index + 1} / {cards.length}</span>
      </div>
      <button onClick={() => setRevealed((r) => !r)}
        className="flex min-h-40 w-full items-center justify-center rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-6 text-center">
        {/* Rendered as text nodes — React escapes model output, no dangerouslySetInnerHTML. */}
        <span className={revealed ? 'text-slate-700' : 'text-lg font-medium'}>
          {revealed ? card.backText : card.frontText}
        </span>
      </button>
      <div className="flex justify-between">
        <button className="btn-secondary" onClick={() => go(-1)}>Previous</button>
        <span className="self-center text-xs text-slate-500">Click the card to flip</span>
        <button className="btn-secondary" onClick={() => go(1)}>Next</button>
      </div>
    </section>
  );
}
