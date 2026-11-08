'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { ExamSessionView } from '@/lib/types';

export function StartExamPanel({ materialId }: { materialId: string }) {
  const router = useRouter();
  const [questionCount, setQuestionCount] = useState(10);
  const start = useMutation({
    mutationFn: (mode: 'LEARNING' | 'EXAM') =>
      apiRequest<ExamSessionView>('/exam-sessions', {
        method: 'POST',
        json: { materialId, mode, questionCount },
      }),
    onSuccess: (session) => router.push(`/student/exams/${session.id}`),
  });

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Test yourself</h2>
      <label className="flex items-center gap-2 text-sm">
        Questions
        <input type="number" min={3} max={50} value={questionCount} className="input w-20"
          onChange={(e) => setQuestionCount(Number(e.target.value))} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <button className="btn-secondary text-left" disabled={start.isPending} onClick={() => start.mutate('LEARNING')}>
          <span className="block font-semibold">Learning mode</span>
          <span className="text-xs text-slate-500">Instant feedback & explanations per answer</span>
        </button>
        <button className="btn-primary text-left" disabled={start.isPending} onClick={() => start.mutate('EXAM')}>
          <span className="block font-semibold">Exam mode</span>
          <span className="text-xs text-indigo-100">Timed, no feedback until you submit</span>
        </button>
      </div>
      {start.error && (
        <p role="alert" className="text-sm text-red-600">
          {start.error instanceof ApiError ? start.error.message : 'Could not start session'}
        </p>
      )}
    </section>
  );
}
