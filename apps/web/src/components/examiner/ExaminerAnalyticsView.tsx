'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

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
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-3">
        <h2 className="font-semibold">Average exam score by material</h2>
        {materials.data?.length ? materials.data.map((m) => (
          <div key={m.materialId} className="flex justify-between text-sm">
            <span>{m.materialTitle}</span>
            <span className="text-slate-500">{m.averageScore}% · {m.completedExams} exams</span>
          </div>
        )) : <p className="text-sm text-slate-500">No completed exams yet.</p>}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Weakest concepts (cohort)</h2>
        {concepts.data?.map((c) => (
          <div key={c.conceptTag}>
            <div className="flex justify-between text-sm">
              <span>{c.conceptTag}</span>
              <span className="text-slate-500">{Math.round(c.accuracy * 100)}% · {c.attemptCount} answers</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.round(c.accuracy * 100)}%` }} />
            </div>
          </div>
        ))}
      </section>

      <section className="card space-y-3 lg:col-span-2">
        <h2 className="font-semibold">Most frequently missed questions</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-2">Question</th><th>Concept</th><th>Error rate</th><th>Common wrong</th><th>Correct</th></tr>
          </thead>
          <tbody>
            {missed.data?.map((q) => (
              <tr key={q.questionId} className="border-t border-slate-100 align-top">
                <td className="py-2 pr-4">
                  <p>{q.questionText}</p>
                  <p className="text-xs text-slate-400">{q.materialTitle}</p>
                </td>
                <td className="text-xs">{q.conceptTag}</td>
                <td>{Math.round(q.errorRate * 100)}% <span className="text-xs text-slate-400">({q.incorrectCount}/{q.attemptCount})</span></td>
                <td className="font-semibold text-red-600">{q.mostCommonWrongAnswer ?? '—'}</td>
                <td className="font-semibold text-emerald-600">{q.correctAnswer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
