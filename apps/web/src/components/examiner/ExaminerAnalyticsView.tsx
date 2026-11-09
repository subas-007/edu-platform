'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, BookOpen, Brain } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import { EmptyState, PageHeader, ProgressBar, Spinner } from '../ui';

interface MissedQuestion {
  questionId: string;
  questionText: string;
  conceptTag: string;
  correctAnswer: string;
  materialTitle: string;
  attemptCount: number;
  incorrectCount: number;
  errorRate: number;
  mostCommonWrongAnswer: string | null;
}
interface ConceptWeakness { conceptTag: string; attemptCount: number; accuracy: number }
interface MaterialPerformance { materialId: string; materialTitle: string; averageScore: number; completedExams: number }

export function ExaminerAnalyticsView() {
  const missed = useQuery({
    queryKey: ['analytics', 'missed'],
    queryFn: () => apiRequest<MissedQuestion[]>('/analytics/frequently-missed-questions?limit=15'),
  });
  const concepts = useQuery({
    queryKey: ['analytics', 'concepts'],
    queryFn: () => apiRequest<ConceptWeakness[]>('/analytics/concept-weaknesses?limit=10'),
  });
  const materials = useQuery({
    queryKey: ['analytics', 'materials'],
    queryFn: () => apiRequest<MaterialPerformance[]>('/analytics/material-performance'),
  });

  return (
    <>
      <PageHeader
        eyebrow="Insights"
        title="Student performance"
        subtitle="Cohort-level results across practice exams, so you can see which materials and concepts need reinforcement."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-aqua-400" aria-hidden />
            <h2 className="font-semibold text-white">Average exam score by material</h2>
          </div>
          {materials.isLoading ? <Spinner /> : materials.data?.length ? materials.data.map((m) => (
            <div key={m.materialId}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span className="truncate text-slate-200">{m.materialTitle}</span>
                <span className="shrink-0 text-slate-400 tabular-nums">{m.averageScore}% · {m.completedExams} exams</span>
              </div>
              <ProgressBar value={m.averageScore} tone="auto" />
            </div>
          )) : <p className="text-sm text-slate-400">No completed exams yet.</p>}
        </section>

        <section className="card space-y-4">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-violet-300" aria-hidden />
            <h2 className="font-semibold text-white">Weakest concepts (cohort)</h2>
          </div>
          {concepts.isLoading ? <Spinner /> : concepts.data?.length ? concepts.data.map((c) => (
            <div key={c.conceptTag}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-slate-200">{c.conceptTag}</span>
                <span className="text-slate-400 tabular-nums">{Math.round(c.accuracy * 100)}% · {c.attemptCount} answers</span>
              </div>
              <ProgressBar value={c.accuracy * 100} tone="auto" />
            </div>
          )) : <p className="text-sm text-slate-400">No answers recorded yet.</p>}
        </section>

        <section className="card overflow-hidden p-0 lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-ink-700/60 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden />
            <h2 className="font-semibold text-white">Most frequently missed questions</h2>
          </div>
          {missed.isLoading ? (
            <div className="p-4"><Spinner /></div>
          ) : !missed.data?.length ? (
            <div className="p-4"><EmptyState icon={BarChart3} title="Nothing to analyse yet">Data appears once students answer questions.</EmptyState></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[720px]">
                <thead>
                  <tr><th>Question</th><th>Concept</th><th>Error rate</th><th>Common wrong</th><th>Correct</th></tr>
                </thead>
                <tbody>
                  {missed.data.map((q) => (
                    <tr key={q.questionId} className="align-top">
                      <td className="max-w-md">
                        <p className="text-slate-200">{q.questionText}</p>
                        <p className="text-xs text-slate-500">{q.materialTitle}</p>
                      </td>
                      <td><span className="badge-neutral">{q.conceptTag}</span></td>
                      <td className="whitespace-nowrap">
                        <span className="font-semibold text-white">{Math.round(q.errorRate * 100)}%</span>{' '}
                        <span className="text-xs text-slate-500">({q.incorrectCount}/{q.attemptCount})</span>
                      </td>
                      <td className="font-semibold text-red-300">{q.mostCommonWrongAnswer ?? '—'}</td>
                      <td className="font-semibold text-emerald-300">{q.correctAnswer}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
