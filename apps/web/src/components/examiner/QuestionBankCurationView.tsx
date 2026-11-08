'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Paginated, QuestionOption } from '@/lib/types';

type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface CuratedQuestion {
  id: string;
  questionType: string;
  questionText: string;
  options: QuestionOption[];
  correctAnswer: string;
  explanation: string;
  conceptTag: string;
  reviewStatus: ReviewStatus;
  material: { title: string };
}

export function QuestionBankCurationView() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReviewStatus>('PENDING');
  const { data, isLoading } = useQuery({
    queryKey: ['exam-questions', status],
    queryFn: () => apiRequest<Paginated<CuratedQuestion>>(`/exam-questions?reviewStatus=${status}&pageSize=50`),
  });

  const review = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; reviewStatus?: ReviewStatus; correctAnswer?: string }) =>
      apiRequest(`/exam-questions/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exam-questions'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={s === status ? 'btn-primary' : 'btn-secondary'}>{s}</button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {data?.items.length === 0 && <p className="text-sm text-slate-500">Nothing in this queue.</p>}
      {data?.items.map((q) => (
        <article key={q.id} className="card space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>{q.material.title} · {q.questionType} · <strong>{q.conceptTag}</strong></span>
          </div>
          <p className="font-medium">{q.questionText}</p>
          <ul className="space-y-1 text-sm">
            {q.options.map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <input type="radio" name={`correct-${q.id}`} checked={o.id === q.correctAnswer}
                  onChange={() => review.mutate({ id: q.id, correctAnswer: o.id })} aria-label={`Mark ${o.id} correct`} />
                <span className={o.id === q.correctAnswer ? 'font-semibold text-emerald-700' : ''}>{o.id}. {o.text}</span>
              </li>
            ))}
          </ul>
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-600">{q.explanation}</p>
          <div className="flex gap-2">
            {q.reviewStatus !== 'APPROVED' && (
              <button className="btn-primary" onClick={() => review.mutate({ id: q.id, reviewStatus: 'APPROVED' })}>Approve</button>
            )}
            {q.reviewStatus !== 'REJECTED' && (
              <button className="btn-secondary" onClick={() => review.mutate({ id: q.id, reviewStatus: 'REJECTED' })}>Reject</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
