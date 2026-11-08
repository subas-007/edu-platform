'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { AnswerFeedback, ExamSessionView } from '@/lib/types';
import { useExamTimerStore } from '@/stores/exam-timer-store';
import { ExamResultsView } from './ExamResultsView';

export function ExamModeContainer({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['exam-session', sessionId];
  const { data: session, isLoading } = useQuery({
    queryKey,
    queryFn: () => apiRequest<ExamSessionView>(`/exam-sessions/${sessionId}`),
    staleTime: Infinity,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [learningFeedback, setLearningFeedback] = useState<Record<string, AnswerFeedback>>({});
  const { remainingSeconds, startExamTimer, tickExamTimer, stopExamTimer } = useExamTimerStore();
  const autoSubmitted = useRef(false);

  const submitExam = useMutation({
    mutationFn: () =>
      apiRequest<ExamSessionView>(`/exam-sessions/${sessionId}/submissions`, { method: 'POST' }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onError: () => queryClient.invalidateQueries({ queryKey }), // e.g. server already expired it
  });

  const recordAnswer = useMutation({
    mutationFn: (v: { questionId: string; selectedAnswer: string }) =>
      apiRequest<{ saved: boolean; feedback?: AnswerFeedback }>(`/exam-sessions/${sessionId}/answers`, {
        method: 'POST',
        json: v,
      }),
    onSuccess: (res, v) => {
      if (res.feedback) setLearningFeedback((f) => ({ ...f, [v.questionId]: res.feedback! }));
      queryClient.setQueryData<ExamSessionView>(queryKey, (prev) =>
        prev && {
          ...prev,
          questions: prev.questions.map((q) =>
            // Learning mode locks the first answer; the server echoes which one counted.
            q.id === v.questionId ? { ...q, selectedAnswer: res.feedback?.selectedAnswer ?? v.selectedAnswer } : q,
          ),
        },
      );
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) void queryClient.invalidateQueries({ queryKey });
    },
  });

  // Server-synchronised countdown; auto-submit at zero (server enforces the deadline regardless).
  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return stopExamTimer();
    startExamTimer(session.expiresAt, session.serverTime);
    const interval = setInterval(tickExamTimer, 1000);
    return () => clearInterval(interval);
  }, [session, startExamTimer, tickExamTimer, stopExamTimer]);

  useEffect(() => {
    if (remainingSeconds === 0 && session?.status === 'IN_PROGRESS' && !autoSubmitted.current) {
      autoSubmitted.current = true;
      submitExam.mutate();
    }
  }, [remainingSeconds, session?.status, submitExam]);

  if (isLoading || !session) return <p className="text-sm text-slate-500">Loading session…</p>;
  if (session.status !== 'IN_PROGRESS' && session.result) return <ExamResultsView session={session} />;

  const question = session.questions[currentIndex];
  const isLearning = session.mode === 'LEARNING';
  const feedback = learningFeedback[question.id] ?? question.feedback;
  const answeredCount = session.questions.filter((q) => q.selectedAnswer).length;
  const locked = isLearning && Boolean(feedback);

  return (
    <div className="space-y-4">
      <header className="card flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{isLearning ? 'Learning mode' : 'Exam mode'}</p>
          <p className="font-semibold">Question {currentIndex + 1} of {session.questions.length}</p>
        </div>
        {remainingSeconds !== null && (
          <p className={`font-mono text-lg ${remainingSeconds < 60 ? 'text-red-600' : ''}`} aria-live="polite">
            {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
          </p>
        )}
        <span className="text-xs text-slate-500">{answeredCount} answered</span>
      </header>

      <section className="card space-y-4">
        {question.questionType === 'SCENARIO' && (
          <span className="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-700">Scenario</span>
        )}
        <p className="whitespace-pre-wrap text-base">{question.questionText}</p>
        <div className="space-y-2">
          {question.options.map((option) => {
            const selected = question.selectedAnswer === option.id;
            const showCorrect = feedback && option.id === feedback.correctAnswer;
            const showWrong = feedback && selected && !feedback.isCorrect;
            return (
              <button key={option.id} disabled={locked || recordAnswer.isPending}
                onClick={() => recordAnswer.mutate({ questionId: question.id, selectedAnswer: option.id })}
                className={`flex w-full gap-3 rounded-lg border px-4 py-3 text-left text-sm transition
                  ${showCorrect ? 'border-emerald-500 bg-emerald-50' : showWrong ? 'border-red-500 bg-red-50' : selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                <span className="font-semibold">{option.id}.</span>
                <span>{option.text}</span>
              </button>
            );
          })}
        </div>

        {isLearning && feedback && (
          <div className={`rounded-lg p-4 text-sm ${feedback.isCorrect ? 'bg-emerald-50' : 'bg-amber-50'}`}>
            <p className="font-semibold">{feedback.isCorrect ? 'Correct!' : `Not quite — the answer is ${feedback.correctAnswer}.`}</p>
            <p className="mt-1 whitespace-pre-wrap">{feedback.explanation}</p>
            {feedback.sourceExcerpt && (
              <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs text-slate-600">
                From the material: “{feedback.sourceExcerpt.text}…”
              </blockquote>
            )}
          </div>
        )}
      </section>

      <footer className="flex justify-between">
        <button className="btn-secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => i - 1)}>
          Previous
        </button>
        {currentIndex < session.questions.length - 1 ? (
          <button className="btn-secondary" onClick={() => setCurrentIndex((i) => i + 1)}>Next</button>
        ) : (
          <button className="btn-primary" disabled={submitExam.isPending}
            onClick={() => {
              const unanswered = session.questions.length - answeredCount;
              if (unanswered === 0 || confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) submitExam.mutate();
            }}>
            {isLearning ? 'Finish session' : 'Submit exam'}
          </button>
        )}
      </footer>
    </div>
  );
}
