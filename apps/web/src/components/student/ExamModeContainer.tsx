'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, CheckCircle2, ChevronLeft, ChevronRight, Clock, Flag, Send, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { AnswerFeedback, ExamSessionView } from '@/lib/types';
import { useExamTimerStore } from '@/stores/exam-timer-store';
import { ErrorText, Spinner } from '../ui';
import { ExamResultsView } from './ExamResultsView';

export function ExamModeContainer({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['exam-session', sessionId];
  const { data: session, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiRequest<ExamSessionView>(`/exam-sessions/${sessionId}`),
    staleTime: Infinity,
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [learningFeedback, setLearningFeedback] = useState<Record<string, AnswerFeedback>>({});
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const { remainingSeconds, startExamTimer, tickExamTimer, stopExamTimer } = useExamTimerStore();
  const autoSubmitted = useRef(false);

  const submitExam = useMutation({
    mutationFn: () => apiRequest<ExamSessionView>(`/exam-sessions/${sessionId}/submissions`, { method: 'POST' }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ['exam-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['exam-programs'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: () => queryClient.invalidateQueries({ queryKey }), // e.g. server already expired it
  });

  const recordAnswer = useMutation({
    mutationFn: (v: { questionId: string; selectedAnswer: string }) =>
      apiRequest<{ saved: boolean; feedback?: AnswerFeedback }>(`/exam-sessions/${sessionId}/answers`, { method: 'POST', json: v }),
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

  // Server-synchronised countdown; auto-submit at zero (the server enforces the deadline regardless).
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

  if (isLoading) return <Spinner label="Loading session…" />;
  if (error || !session) return <ErrorText error={error ?? new Error('Session not found')} />;
  if (session.status !== 'IN_PROGRESS' && session.result) return <ExamResultsView session={session} />;

  const question = session.questions[currentIndex];
  const isLearning = session.mode === 'LEARNING';
  const feedback = learningFeedback[question.id] ?? question.feedback;
  const answeredCount = session.questions.filter((q) => q.selectedAnswer).length;
  const locked = isLearning && Boolean(feedback);
  const lowTime = remainingSeconds !== null && remainingSeconds < 60;

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center gap-4">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${isLearning ? 'bg-emerald-500/10 text-emerald-300' : 'bg-aqua-500/10 text-aqua-300'}`}>
          {isLearning ? <BookOpenCheck className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
            {session.kind === 'PROGRAM' ? 'Exam program' : isLearning ? 'Learning mode' : 'Exam mode'}
          </p>
          <p className="truncate font-semibold text-white">{session.title}</p>
        </div>
        {remainingSeconds !== null && (
          <p
            className={`rounded-xl border px-3 py-1.5 font-mono text-lg tabular-nums ${lowTime ? 'animate-pulse border-red-500/50 bg-red-500/10 text-red-300' : 'border-ink-600 bg-ink-850 text-white'}`}
            aria-live="polite"
            aria-label="Time remaining"
          >
            {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
          </p>
        )}
      </header>

      {/* Question navigator */}
      <nav className="card p-3" aria-label="Questions">
        <div className="flex flex-wrap gap-1.5">
          {session.questions.map((q, i) => {
            const fb = learningFeedback[q.id] ?? q.feedback;
            const state = i === currentIndex
              ? 'border-aqua-400 bg-aqua-400 text-ink-950'
              : fb
                ? fb.isCorrect ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200' : 'border-red-500/50 bg-red-500/15 text-red-200'
                : q.selectedAnswer
                  ? 'border-ink-500 bg-ink-700 text-white'
                  : 'border-ink-600 text-slate-400 hover:border-ink-500';
            return (
              <button
                key={q.id}
                onClick={() => setCurrentIndex(i)}
                className={`relative h-9 w-9 rounded-lg border text-xs font-semibold transition ${state}`}
                aria-label={`Question ${i + 1}${q.selectedAnswer ? ', answered' : ''}${flagged.has(q.id) ? ', flagged' : ''}`}
                aria-current={i === currentIndex}
              >
                {i + 1}
                {flagged.has(q.id) && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-amber-400" />}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{answeredCount} of {session.questions.length} answered</p>
      </nav>

      <section className="card space-y-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-slate-400">Question {currentIndex + 1} of {session.questions.length}</p>
          <div className="flex items-center gap-2">
            {question.questionType === 'SCENARIO' && <span className="badge-violet">Scenario</span>}
            {!isLearning && (
              <button
                className={`btn-ghost btn-sm ${flagged.has(question.id) ? 'text-amber-300' : ''}`}
                onClick={() => setFlagged((f) => { const n = new Set(f); if (n.has(question.id)) n.delete(question.id); else n.add(question.id); return n; })}
              >
                <Flag className="h-3.5 w-3.5" /> {flagged.has(question.id) ? 'Flagged' : 'Flag'}
              </button>
            )}
          </div>
        </div>
        <p className="text-base leading-relaxed whitespace-pre-wrap text-white sm:text-lg">{question.questionText}</p>
        <div className="space-y-2.5">
          {question.options.map((option) => {
            const selected = question.selectedAnswer === option.id;
            const showCorrect = feedback?.correctAnswer && option.id === feedback.correctAnswer;
            const showWrong = feedback && selected && !feedback.isCorrect;
            return (
              <button
                key={option.id}
                disabled={locked || recordAnswer.isPending}
                onClick={() => recordAnswer.mutate({ questionId: question.id, selectedAnswer: option.id })}
                className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-default ${
                  showCorrect
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                    : showWrong
                      ? 'border-red-500/60 bg-red-500/10 text-red-100'
                      : selected
                        ? 'border-aqua-400 bg-aqua-500/10 text-white'
                        : 'border-ink-600 bg-ink-850 text-slate-200 hover:border-aqua-500/50 hover:bg-ink-800'
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${selected ? 'bg-aqua-400 text-ink-950' : 'bg-ink-700 text-slate-300'}`}>
                  {option.id}
                </span>
                <span className="flex-1 pt-0.5">{option.text}</span>
                {showCorrect && <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-label="Correct answer" />}
                {showWrong && <XCircle className="h-5 w-5 text-red-400" aria-label="Your answer" />}
              </button>
            );
          })}
        </div>

        {isLearning && feedback && (
          <div className={`rounded-xl border p-4 text-sm ${feedback.isCorrect ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <p className={`font-semibold ${feedback.isCorrect ? 'text-emerald-300' : 'text-amber-300'}`}>
              {feedback.isCorrect ? 'Correct!' : `Not quite. The answer is ${feedback.correctAnswer}.`}
            </p>
            {feedback.explanation && <p className="mt-1 whitespace-pre-wrap text-slate-300">{feedback.explanation}</p>}
            {feedback.sourceExcerpt && (
              <blockquote className="mt-3 border-l-2 border-aqua-500/50 pl-3 text-xs text-slate-400">
                From the material: “{feedback.sourceExcerpt.text}…”
              </blockquote>
            )}
          </div>
        )}
        <ErrorText error={recordAnswer.error} />
      </section>

      <footer className="flex flex-wrap justify-between gap-2">
        <button className="btn-secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => i - 1)}>
          <ChevronLeft className="h-4 w-4" /> Previous
        </button>
        <div className="flex gap-2">
          {currentIndex < session.questions.length - 1 && (
            <button className="btn-secondary" onClick={() => setCurrentIndex((i) => i + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <button
            className={currentIndex === session.questions.length - 1 ? 'btn-primary' : 'btn-ghost'}
            disabled={submitExam.isPending}
            onClick={() => {
              const unanswered = session.questions.length - answeredCount;
              if (unanswered === 0 || confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) submitExam.mutate();
            }}
          >
            <Send className="h-4 w-4" /> {isLearning ? 'Finish session' : 'Submit exam'}
          </button>
        </div>
      </footer>
    </div>
  );
}
