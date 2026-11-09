'use client';

import { useQuery } from '@tanstack/react-query';
import { Award, BarChart3, ClipboardList, FileBarChart, Medal, Target } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { AttemptSummary, Paginated } from '@/lib/types';
import { DownloadButton } from '../DownloadButton';
import { EmptyState, formatDate, PageHeader, ProgressBar, Spinner, StatCard } from '../ui';

type Filter = 'all' | 'exam' | 'learning' | 'programs';

export function AttemptHistoryView() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['exam-sessions', 'history'],
    queryFn: () => apiRequest<Paginated<AttemptSummary>>('/exam-sessions?pageSize=100'),
  });
  const attempts = data?.items ?? [];
  const completed = attempts.filter((a) => a.status !== 'IN_PROGRESS');
  const certificates = completed.filter((a) => a.certificateEligible);
  const examScores = completed.filter((a) => a.mode === 'EXAM').map((a) => a.score ?? 0);

  const visible = useMemo(
    () =>
      attempts.filter((a) =>
        filter === 'exam' ? a.mode === 'EXAM' : filter === 'learning' ? a.mode === 'LEARNING' : filter === 'programs' ? a.kind === 'PROGRAM' : true,
      ),
    [attempts, filter],
  );

  return (
    <>
      <PageHeader
        eyebrow="Assess"
        title="Results & certificates"
        subtitle="Every attempt with its score card. Exam-mode results above 70% come with a certificate you can download."
      />

      {isLoading ? (
        <Spinner />
      ) : attempts.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No attempts yet"
          action={<Link href="/student/practice" className="btn-primary">Start practising</Link>}
        >
          Your learning and exam-mode attempts will be listed here with score cards.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={ClipboardList} label="Attempts" value={attempts.length} hint={`${completed.length} completed`} />
            <StatCard
              icon={BarChart3}
              label="Average exam score"
              value={examScores.length ? `${Math.round(examScores.reduce((s, x) => s + x, 0) / examScores.length)}%` : '—'}
              hint={`${examScores.length} exam-mode results`}
              tone="violet"
            />
            <StatCard icon={Target} label="Best exam score" value={examScores.length ? `${Math.max(...examScores)}%` : '—'} tone="green" />
            <StatCard icon={Medal} label="Certificates" value={certificates.length} hint="Exam mode, score > 70%" tone="amber" />
          </div>

          {certificates.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-white">Certificates earned</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {certificates.map((c) => (
                  <article key={c.id} className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-br from-ink-800 via-ink-900 to-ink-900 p-5">
                    <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-amber-400/10 blur-2xl" aria-hidden />
                    <Award className="h-8 w-8 text-amber-300" aria-hidden />
                    <p className="mt-3 text-[10px] font-semibold tracking-[0.2em] text-amber-300 uppercase">Certificate of achievement</p>
                    <p className="mt-1 truncate text-lg font-semibold text-white">{c.title}</p>
                    <p className="text-sm text-slate-400">
                      {c.score}% · {formatDate(c.completedAt)} · {c.kind === 'PROGRAM' ? 'Exam program' : 'Practice exam'}
                    </p>
                    <div className="mt-4">
                      <DownloadButton variant="primary" size="sm" path={`/exam-sessions/${c.id}/certificate`} filename="certificate.pdf" icon={<Award className="h-3.5 w-3.5" />}>
                        Download certificate
                      </DownloadButton>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="card overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b border-ink-700/60 p-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-white">Past attempts</h2>
              <div className="segmented overflow-x-auto" role="group" aria-label="Filter attempts">
                {(['all', 'exam', 'learning', 'programs'] as const).map((f) => (
                  <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {{ all: 'All', exam: 'Exam mode', learning: 'Learning', programs: 'Programs' }[f]}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Assessment</th>
                    <th>Mode</th>
                    <th>Date</th>
                    <th className="w-48">Score</th>
                    <th className="text-right">Downloads</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => (
                    <tr key={a.id}>
                      <td className="max-w-xs">
                        <Link href={`/student/exams/${a.id}`} className="block truncate font-medium text-white hover:text-aqua-300">{a.title}</Link>
                        <span className="text-xs text-slate-500">{a.kind === 'PROGRAM' ? 'Exam program' : 'Practice'} · {a.totalQuestions} questions</span>
                      </td>
                      <td>
                        <span className={a.mode === 'EXAM' ? 'badge-aqua' : 'badge-green'}>{a.mode === 'EXAM' ? 'Exam' : 'Learning'}</span>
                      </td>
                      <td className="text-slate-400">{formatDate(a.completedAt ?? a.startedAt, true)}</td>
                      <td>
                        {a.status === 'IN_PROGRESS' ? (
                          <Link href={`/student/exams/${a.id}`} className="badge-amber">In progress · resume</Link>
                        ) : (
                          <div className="flex items-center gap-3">
                            <span className={`w-12 text-right font-semibold tabular-nums ${(a.score ?? 0) > 70 ? 'text-aqua-300' : 'text-white'}`}>
                              {a.score ?? 0}%
                            </span>
                            <div className="flex-1"><ProgressBar value={a.score ?? 0} tone="auto" /></div>
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          {a.status !== 'IN_PROGRESS' && (
                            <DownloadButton size="sm" path={`/exam-sessions/${a.id}/scorecard`} filename="scorecard.pdf" icon={<FileBarChart className="h-3.5 w-3.5" />}>
                              Score card
                            </DownloadButton>
                          )}
                          {a.certificateEligible && (
                            <DownloadButton size="sm" variant="primary" path={`/exam-sessions/${a.id}/certificate`} filename="certificate.pdf" icon={<Award className="h-3.5 w-3.5" />}>
                              Certificate
                            </DownloadButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
