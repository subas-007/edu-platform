import Link from 'next/link';
import type { ExamSessionView } from '@/lib/types';

export function ExamResultsView({ session }: { session: ExamSessionView }) {
  const result = session.result!;
  const { conceptBreakdown, weakestConcepts, unansweredCount } = result.diagnostics;
  const missed = session.questions.filter((q) => !q.selectedAnswer || (q.feedback && !q.feedback.isCorrect));

  return (
    <div className="space-y-6">
      <section className="card flex items-center gap-8">
        <div className="text-center">
          <p className="text-5xl font-bold text-indigo-700">{result.percentage}%</p>
          <p className="text-xs text-slate-500">{session.status === 'EXPIRED' ? 'Time expired' : 'Submitted'}</p>
        </div>
        <div className="text-sm text-slate-600">
          <p>{result.correctCount} of {result.totalQuestions} correct</p>
          {unansweredCount > 0 && <p>{unansweredCount} unanswered</p>}
          {weakestConcepts.length > 0 && (
            <p className="mt-2">Focus next on: <strong>{weakestConcepts.join(', ')}</strong></p>
          )}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Diagnostic breakdown by concept</h2>
        {conceptBreakdown.map((c) => (
          <div key={c.conceptTag}>
            <div className="flex justify-between text-sm">
              <span>{c.conceptTag}</span>
              <span className="text-slate-500">{c.correctAnswers}/{c.totalQuestions}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className={`h-2 rounded-full ${c.accuracy < 0.5 ? 'bg-red-500' : c.accuracy < 0.7 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.round(c.accuracy * 100)}%` }} />
            </div>
          </div>
        ))}
      </section>

      {missed.length > 0 && (
        <section className="card space-y-4">
          <h2 className="font-semibold">Review missed questions</h2>
          {missed.map((q) => (
            <div key={q.id} className="border-t border-slate-100 pt-3 text-sm">
              <p className="font-medium">{q.questionText}</p>
              <p className="text-slate-500">
                Your answer: {q.selectedAnswer ?? '—'} · Correct: {q.feedback?.correctAnswer ?? 'see explanation'}
              </p>
              {q.feedback && <p className="mt-1 text-slate-700">{q.feedback.explanation}</p>}
            </div>
          ))}
        </section>
      )}

      <Link href={`/student/materials/${session.materialId}`} className="btn-secondary inline-block">
        Back to material
      </Link>
    </div>
  );
}
