'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, CheckCircle2, Clock, GraduationCap, ListChecks, PlayCircle, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { ExamSessionView, StudentProgram } from '@/lib/types';
import { DownloadButton } from '../DownloadButton';
import { EmptyState, ErrorText, formatDate, PageHeader, Spinner } from '../ui';

export function ProgramsView() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'all' | 'enrolled'>('all');
  const { data: programs = [], isLoading } = useQuery({
    queryKey: ['exam-programs'],
    queryFn: () => apiRequest<StudentProgram[]>('/exam-papers/available'),
  });

  const enroll = useMutation({
    mutationFn: (id: string) => apiRequest<StudentProgram>(`/exam-papers/${id}/enrollments`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exam-programs'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const start = useMutation({
    mutationFn: (id: string) => apiRequest<ExamSessionView>(`/exam-papers/${id}/sessions`, { method: 'POST' }),
    onSuccess: (session) => router.push(`/student/exams/${session.id}`),
  });

  const visible = tab === 'enrolled' ? programs.filter((p) => p.enrolled) : programs;

  return (
    <>
      <PageHeader
        eyebrow="Assess"
        title="Exam programs"
        subtitle="Formal exams prepared by your examiners. Enroll in a program, then sit the timed exam. Scoring above 70% earns a downloadable certificate."
        actions={
          <div className="segmented" role="group" aria-label="Filter programs">
            <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>All ({programs.length})</button>
            <button aria-pressed={tab === 'enrolled'} onClick={() => setTab('enrolled')}>
              Enrolled ({programs.filter((p) => p.enrolled).length})
            </button>
          </div>
        }
      />
      <ErrorText error={enroll.error ?? start.error} />

      {isLoading ? (
        <Spinner />
      ) : visible.length === 0 ? (
        <EmptyState icon={GraduationCap} title={tab === 'enrolled' ? 'You are not enrolled in any program' : 'No exam programs are open right now'}>
          When an examiner publishes an exam program it appears here, and you&apos;ll get a notification.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => {
            const attemptsLeft = p.maxAttempts - p.attemptsUsed;
            const closed = p.status === 'CLOSED';
            return (
              <article key={p.id} className="card flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-aqua-500/10 text-aqua-300">
                    <GraduationCap className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {closed && <span className="badge-neutral">Closed</span>}
                    {p.enrolled ? <span className="badge-green"><CheckCircle2 className="h-3 w-3" /> Enrolled</span> : <span className="badge-aqua">Open</span>}
                    {p.certificateSessionId && <span className="badge-amber"><Award className="h-3 w-3" /> Certified</span>}
                  </div>
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white">{p.title}</h2>
                  {p.description && <p className="mt-1 line-clamp-3 text-sm text-slate-400">{p.description}</p>}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="panel px-2 py-2">
                    <dt className="text-[10px] tracking-wide text-slate-500 uppercase">Questions</dt>
                    <dd className="flex items-center justify-center gap-1 font-semibold text-white"><ListChecks className="h-3.5 w-3.5 text-slate-500" />{p.questionCount}</dd>
                  </div>
                  <div className="panel px-2 py-2">
                    <dt className="text-[10px] tracking-wide text-slate-500 uppercase">Duration</dt>
                    <dd className="flex items-center justify-center gap-1 font-semibold text-white"><Clock className="h-3.5 w-3.5 text-slate-500" />{p.durationMinutes}m</dd>
                  </div>
                  <div className="panel px-2 py-2">
                    <dt className="text-[10px] tracking-wide text-slate-500 uppercase">Attempts</dt>
                    <dd className="font-semibold text-white">{p.attemptsUsed}/{p.maxAttempts}</dd>
                  </div>
                </dl>
                {p.bestScore !== null && (
                  <p className="text-sm text-slate-400">
                    Best score: <span className={`font-semibold ${p.bestScore > 70 ? 'text-aqua-300' : 'text-white'}`}>{p.bestScore}%</span>
                    {p.bestSessionId && (
                      <Link className="ml-2 text-aqua-300 hover:underline" href={`/student/exams/${p.bestSessionId}`}>View report</Link>
                    )}
                  </p>
                )}

                <div className="mt-auto flex flex-wrap gap-2">
                  {!p.enrolled ? (
                    <button className="btn-primary flex-1" disabled={enroll.isPending || closed} onClick={() => enroll.mutate(p.id)}>
                      Enroll
                    </button>
                  ) : p.activeSessionId ? (
                    <Link className="btn-primary flex-1" href={`/student/exams/${p.activeSessionId}`}>
                      <PlayCircle className="h-4 w-4" /> Resume exam
                    </Link>
                  ) : attemptsLeft > 0 && !closed ? (
                    <button
                      className="btn-primary flex-1"
                      disabled={start.isPending}
                      onClick={() => {
                        if (confirm(`Start “${p.title}” now? The ${p.durationMinutes}-minute timer begins immediately.`)) start.mutate(p.id);
                      }}
                    >
                      {p.attemptsUsed > 0 ? <RotateCcw className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                      {p.attemptsUsed > 0 ? 'Retake exam' : 'Start exam'}
                    </button>
                  ) : (
                    <span className="flex-1 self-center text-sm text-slate-500">
                      {closed ? 'This program is closed.' : 'No attempts left.'}
                    </span>
                  )}
                  {p.certificateSessionId && (
                    <DownloadButton path={`/exam-sessions/${p.certificateSessionId}/certificate`} filename="certificate.pdf" icon={<Award className="h-4 w-4" />}>
                      Certificate
                    </DownloadButton>
                  )}
                </div>
                {p.enrolledAt && <p className="text-[11px] text-slate-500">Enrolled {formatDate(p.enrolledAt)}</p>}
              </article>
            );
          })}
        </div>
      )}
      {start.error instanceof ApiError && start.error.status === 409 && (
        <p className="text-sm text-slate-400">Refresh the page to see the latest status of this program.</p>
      )}
    </>
  );
}
