'use client';

import { useMutation } from '@tanstack/react-query';
import { BookOpenCheck, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { ExamSessionView } from '@/lib/types';

const SECONDS_PER_QUESTION = 90;

/** Starts a practice session on one material in Learning or Exam mode. */
export function StartExamPanel({ materialId, availableQuestions }: { materialId: string; availableQuestions?: number }) {
  const router = useRouter();
  const max = Math.max(3, Math.min(50, availableQuestions ?? 50));
  const [questionCount, setQuestionCount] = useState(Math.min(10, max));
  const start = useMutation({
    mutationFn: (mode: 'LEARNING' | 'EXAM') =>
      apiRequest<ExamSessionView>('/exam-sessions', { method: 'POST', json: { materialId, mode, questionCount } }),
    onSuccess: (session) => router.push(`/student/exams/${session.id}`),
  });

  const noQuestions = availableQuestions === 0;

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-white">Test yourself</h2>
        {availableQuestions !== undefined && <span className="badge-neutral">{availableQuestions} questions available</span>}
      </div>

      <label className="block">
        <span className="label">Number of questions: <span className="text-aqua-300">{questionCount}</span></span>
        <input
          type="range" min={3} max={max} value={Math.min(questionCount, max)} disabled={noQuestions}
          onChange={(e) => setQuestionCount(Number(e.target.value))}
          className="w-full accent-[var(--color-aqua-400)]"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="panel card-hover group p-4 text-left disabled:opacity-50"
          disabled={start.isPending || noQuestions}
          onClick={() => start.mutate('LEARNING')}
        >
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
            <BookOpenCheck className="h-5 w-5" aria-hidden />
          </span>
          <span className="block font-semibold text-white">Learning mode</span>
          <span className="mt-1 block text-xs text-slate-400">
            Untimed. Instant feedback with an explanation and the source passage after every answer.
          </span>
        </button>
        <button
          className="panel card-hover group border-aqua-500/30 p-4 text-left disabled:opacity-50"
          disabled={start.isPending || noQuestions}
          onClick={() => start.mutate('EXAM')}
        >
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-aqua-500/10 text-aqua-300">
            <Timer className="h-5 w-5" aria-hidden />
          </span>
          <span className="block font-semibold text-white">Exam mode</span>
          <span className="mt-1 block text-xs text-slate-400">
            Timed ({Math.round((questionCount * SECONDS_PER_QUESTION) / 60)} min), no feedback until you submit. Score
            above 70% earns a certificate.
          </span>
        </button>
      </div>
      {noQuestions && (
        <p className="text-sm text-amber-300">
          No approved questions yet. Generation may still be running, or an examiner hasn&apos;t approved them yet.
        </p>
      )}
      {start.error && (
        <p role="alert" className="text-sm text-red-300">
          {start.error instanceof ApiError ? start.error.message : 'Could not start session'}
        </p>
      )}
    </section>
  );
}
