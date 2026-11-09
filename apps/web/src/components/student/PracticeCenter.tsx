'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { AttemptSummary, Paginated } from '@/lib/types';
import { useCanRetryMaterial, useReadyMaterials } from '@/lib/use-materials';
import { GenerationNotice, MaterialPipelineBadge, pipelineLabel } from '../MaterialPipeline';
import { EmptyState, formatDate, PageHeader, Spinner } from '../ui';
import { MaterialPicker } from './MaterialPicker';
import { StartExamPanel } from './StartExamPanel';

/**
 * Every document is listed (newest first) — including a fresh upload whose questions are
 * still being generated — so students can see progress instead of a missing entry.
 */
export function PracticeCenter() {
  const params = useSearchParams();
  const { all, isLoading } = useReadyMaterials();
  const canRetry = useCanRetryMaterial();
  const [selected, setSelected] = useState<string | null>(params.get('materialId'));

  useEffect(() => {
    if (selected || all.length === 0) return;
    setSelected((all.find((m) => m._count.examQuestions > 0) ?? all[0]).id);
  }, [selected, all]);

  const inProgress = useQuery({
    queryKey: ['exam-sessions', 'in-progress'],
    queryFn: () => apiRequest<Paginated<AttemptSummary>>('/exam-sessions?status=in-progress&pageSize=10'),
  });
  const resumable = (inProgress.data?.items ?? []).filter((s) => s.status === 'IN_PROGRESS');
  const current = all.find((m) => m.id === selected);

  return (
    <>
      <PageHeader
        eyebrow="Assess"
        title="Learning & exam mode"
        subtitle="Practise on any of your documents. Learning mode teaches as you go; exam mode simulates the real thing under time pressure."
      />

      {resumable.length > 0 && (
        <section className="card border-amber-500/30">
          <h2 className="mb-3 text-sm font-semibold text-amber-200">Continue where you left off</h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {resumable.map((s) => (
              <li key={s.id}>
                <Link href={`/student/exams/${s.id}`} className="panel card-hover flex items-center gap-3 p-3">
                  <PlayCircle className="h-5 w-5 text-amber-300" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{s.title}</span>
                    <span className="text-xs text-slate-400">{s.mode === 'EXAM' ? 'Exam mode' : 'Learning mode'} · started {formatDate(s.startedAt, true)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No documents yet"
          action={<Link href="/student/materials" className="btn-primary">Upload a document</Link>}
        >
          Questions are generated after you upload a document, or when an examiner publishes course material.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="card h-fit lg:sticky lg:top-24">
            <h2 className="mb-3 text-sm font-semibold text-white">Choose a document</h2>
            <MaterialPicker
              materials={all}
              selected={selected ? [selected] : []}
              onToggle={setSelected}
              metric={(m) => (m._count.examQuestions > 0 ? `${m._count.examQuestions} Q` : pipelineLabel(m) || '0 Q')}
            />
          </aside>
          {current && (
            <div className="space-y-4">
              <div className="card">
                <p className="text-xs tracking-wide text-slate-400 uppercase">Selected document</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold text-white">{current.title}</p>
                  <MaterialPipelineBadge material={current} />
                </div>
                {current.status === 'READY' && (
                  <Link href={`/student/materials/${current.id}`} className="mt-1 inline-block text-sm text-aqua-300 hover:underline">
                    Open study page →
                  </Link>
                )}
              </div>
              <GenerationNotice
                material={current}
                what="practice questions"
                canRetry={canRetry(current)}
                hasContent={current._count.examQuestions > 0}
              />
              {current._count.examQuestions > 0 && (
                <StartExamPanel key={current.id} materialId={current.id} availableQuestions={current._count.examQuestions} />
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
