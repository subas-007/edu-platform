'use client';

import { Layers } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isPipelineBusy, useCanRetryMaterial, useReadyMaterials } from '@/lib/use-materials';
import { GenerationNotice, pipelineLabel } from '../MaterialPipeline';
import { EmptyState, PageHeader, Spinner } from '../ui';
import { FlashcardDeck } from './FlashcardDeck';
import { MaterialPicker } from './MaterialPicker';

/**
 * Every document is listed (newest first), including ones still being processed or
 * generated, so a fresh upload is visible immediately with its progress.
 */
export function FlashcardStudio() {
  const params = useSearchParams();
  const { all, isLoading } = useReadyMaterials();
  const canRetry = useCanRetryMaterial();
  const [selected, setSelected] = useState<string | null>(params.get('materialId'));

  useEffect(() => {
    if (selected || all.length === 0) return;
    setSelected((all.find((m) => m._count.flashcards > 0) ?? all[0]).id);
  }, [selected, all]);

  const current = all.find((m) => m.id === selected);

  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="Flashcards"
        subtitle="AI-generated flashcards for each of your documents. Study them here or download them as a printable PDF or a CSV you can import into Anki, Quizlet or Excel."
      />
      {isLoading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No documents yet"
          action={<Link href="/student/materials" className="btn-primary">Upload a document</Link>}
        >
          Upload a document under My materials. Its flashcards appear here as the AI writes them.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="card h-fit lg:sticky lg:top-24">
            <h2 className="mb-3 text-sm font-semibold text-white">Decks</h2>
            <MaterialPicker
              materials={all}
              selected={selected ? [selected] : []}
              onToggle={setSelected}
              metric={(m) => (m._count.flashcards > 0 ? `${m._count.flashcards}` : pipelineLabel(m) || '0')}
            />
          </aside>
          {current && (
            <div className="space-y-4">
              <GenerationNotice
                material={current}
                what="flashcards"
                kind="FLASHCARDS"
                canRetry={canRetry(current)}
                hasContent={current._count.flashcards > 0}
              />
              {current._count.flashcards > 0 && (
                <FlashcardDeck
                  key={current.id}
                  materialId={current.id}
                  title={current.title}
                  generating={isPipelineBusy(current)}
                />
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
