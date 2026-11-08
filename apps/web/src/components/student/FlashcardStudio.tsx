'use client';

import { Layers } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useReadyMaterials } from '@/lib/use-materials';
import { EmptyState, PageHeader, Spinner } from '../ui';
import { FlashcardDeck } from './FlashcardDeck';
import { MaterialPicker } from './MaterialPicker';

export function FlashcardStudio() {
  const params = useSearchParams();
  const { ready, isLoading } = useReadyMaterials();
  const [selected, setSelected] = useState<string | null>(params.get('materialId'));
  const withCards = ready.filter((m) => m._count.flashcards > 0);

  useEffect(() => {
    if (!selected && withCards[0]) setSelected(withCards[0].id);
  }, [selected, withCards]);

  const current = ready.find((m) => m.id === selected);

  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="Flashcards"
        subtitle="AI-generated flashcards for each of your documents. Study them here or download them as a printable PDF or a CSV you can import into Anki, Quizlet or Excel."
      />
      {isLoading ? (
        <Spinner />
      ) : withCards.length === 0 ? (
        <EmptyState icon={Layers} title="No flashcards yet">
          Upload a document under My materials. Flashcards appear here once the AI has processed it.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="card h-fit lg:sticky lg:top-24">
            <h2 className="mb-3 text-sm font-semibold text-white">Decks</h2>
            <MaterialPicker
              materials={withCards}
              selected={selected ? [selected] : []}
              onToggle={setSelected}
              metric={(m) => `${m._count.flashcards}`}
            />
          </aside>
          {current && <FlashcardDeck key={current.id} materialId={current.id} title={current.title} />}
        </div>
      )}
    </>
  );
}
