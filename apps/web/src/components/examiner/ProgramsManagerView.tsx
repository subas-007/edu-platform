'use client';

import { useQuery } from '@tanstack/react-query';
import { Clock, FilePlus2, FileStack, ListChecks, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { ExamPaperStatus, ExamPaperSummary, Paginated } from '@/lib/types';
import { EmptyState, formatDate, PageHeader, Spinner } from '../ui';

export const PAPER_STATUS_BADGE: Record<ExamPaperStatus, string> = {
  DRAFT: 'badge-neutral',
  PUBLISHED: 'badge-green',
  CLOSED: 'badge-red',
};

export function ProgramsManagerView({ basePath }: { basePath: string }) {
  const [status, setStatus] = useState<ExamPaperStatus | 'ALL'>('ALL');
  const { data, isLoading } = useQuery({
    queryKey: ['exam-papers', status],
    queryFn: () => apiRequest<Paginated<ExamPaperSummary>>(`/exam-papers?pageSize=100${status === 'ALL' ? '' : `&status=${status}`}`),
  });

  return (
    <>
      <PageHeader
        eyebrow="Assessment"
        title="Exam programs"
        subtitle="Assemble ad-hoc question papers from the question bank (no extra AI computation), publish them, and let students enroll and sit the exam."
        actions={<Link href={`${basePath}/programs/new`} className="btn-primary"><FilePlus2 className="h-4 w-4" /> New exam program</Link>}
      />
      <div className="segmented" role="group" aria-label="Status">
        {(['ALL', 'DRAFT', 'PUBLISHED', 'CLOSED'] as const).map((s) => (
          <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState icon={FileStack} title="No exam programs yet" action={<Link href={`${basePath}/programs/new`} className="btn-primary">Create one</Link>}>
          Pick resources from the question bank and the platform assembles a balanced question paper.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((p) => (
            <Link key={p.id} href={`${basePath}/programs/${p.id}`} className="card card-hover flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="line-clamp-2 font-semibold text-white">{p.title}</h2>
                <span className={PAPER_STATUS_BADGE[p.status]}>{p.status.toLowerCase()}</span>
              </div>
              {p.description && <p className="line-clamp-2 text-sm text-slate-400">{p.description}</p>}
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" /> {p.questionCount} questions</span>
                <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {p.durationMinutes} min</span>
                <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {p.enrollmentCount} enrolled</span>
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-ink-700/60 pt-3 text-xs text-slate-500">
                <span>{p.completedAttemptCount} attempts{p.averageScore !== null ? ` · avg ${p.averageScore}%` : ''}</span>
                <span>{formatDate(p.publishedAt ?? p.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
