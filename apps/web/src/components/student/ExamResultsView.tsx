'use client';

import { ArrowLeft, Award, CheckCircle2, FileBarChart, MinusCircle, XCircle } from 'lucide-react';
import Link from 'next/link';
import type { ExamSessionView } from '@/lib/types';
import { DownloadButton } from '../DownloadButton';
import { formatDate, ProgressBar, ScoreRing } from '../ui';

export function ExamResultsView({ session }: { session: ExamSessionView }) {
  const result = session.result!;
  const { conceptBreakdown, weakestConcepts, unansweredCount } = result.diagnostics;
  const isProgram = session.kind === 'PROGRAM';
  const missed = session.questions.filter((q) => !q.selectedAnswer || (q.feedback && !q.feedback.isCorrect));
  const backHref = isProgram ? '/student/programs' : session.materialId ? `/student/materials/${session.materialId}` : '/student/history';

  return (
    <div className="space-y-6">
      <Link href="/student/history" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Results &amp; certificates
      </Link>

      <section className="card flex flex-col gap-6 md:flex-row md:items-center">
        <ScoreRing score={result.percentage ?? 0} size={128} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] font-semibold tracking-widest text-slate-400 uppercase">
            Score card · {isProgram ? 'Exam program' : session.mode === 'EXAM' ? 'Exam mode' : 'Learning mode'}
          </p>
          <h1 className="text-2xl font-semibold text-white">{session.title}</h1>
          <p className="text-sm text-slate-400">
            {result.correctCount} of {result.totalQuestions} correct
            {unansweredCount > 0 && ` · ${unansweredCount} unanswered`}
            {' · '}
            {session.status === 'EXPIRED' ? 'Submitted automatically when time ran out' : 'Submitted'} {formatDate(result.completedAt, true)}
          </p>
          {weakestConcepts.length > 0 && (
            <p className="text-sm text-slate-300">
              Focus next on: {weakestConcepts.map((c) => <span key={c} className="badge-amber mr-1">{c}</span>)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row md:flex-col">
          <DownloadButton path={`/exam-sessions/${session.id}/scorecard`} filename="scorecard.pdf" icon={<FileBarChart className="h-4 w-4" />}>
            Score card (PDF)
          </DownloadButton>
          {result.certificateEligible && (
            <DownloadButton variant="primary" path={`/exam-sessions/${session.id}/certificate`} filename="certificate.pdf" icon={<Award className="h-4 w-4" />}>
              Certificate (PDF)
            </DownloadButton>
          )}
        </div>
      </section>

      {result.certificateEligible ? (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
          <Award className="h-6 w-6 shrink-0 text-amber-300" aria-hidden />
          <p className="text-sm text-amber-100">Congratulations! You scored above 70% in exam mode and earned a certificate.</p>
        </div>
      ) : session.mode === 'EXAM' ? (
        <p className="text-sm text-slate-400">Score above 70% in exam mode to earn a certificate.</p>
      ) : (
        <p className="text-sm text-slate-400">Learning-mode sessions are for practice. Take the exam mode to earn a certificate.</p>
      )}

      <section className="card space-y-4">
        <h2 className="font-semibold text-white">Performance by concept</h2>
        {conceptBreakdown.map((c) => (
          <div key={c.conceptTag}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-slate-200">{c.conceptTag}</span>
              <span className="text-slate-400 tabular-nums">{c.correctAnswers}/{c.totalQuestions}</span>
            </div>
            <ProgressBar value={c.accuracy * 100} tone="auto" />
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-white">Question by question</h2>
        {isProgram && (
          <p className="text-xs text-slate-500">
            Exam-program answer keys stay confidential so the questions can be reused. You can see which answers were right.
          </p>
        )}
        <ol className="space-y-2">
          {session.questions.map((q, i) => {
            const outcome = !q.selectedAnswer ? 'unanswered' : q.feedback?.isCorrect ? 'correct' : 'incorrect';
            return (
              <li key={q.id} className="panel p-3">
                <details>
                  <summary className="flex cursor-pointer items-start gap-3 text-sm">
                    {outcome === 'correct' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-label="Correct" />
                    ) : outcome === 'incorrect' ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-label="Incorrect" />
                    ) : (
                      <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-label="Unanswered" />
                    )}
                    <span className="flex-1 text-slate-200"><span className="text-slate-500">{i + 1}.</span> {q.questionText}</span>
                  </summary>
                  <div className="mt-2 space-y-1 pl-7 text-sm">
                    <p className="text-slate-400">
                      Your answer: <span className="text-white">{q.selectedAnswer ?? '—'}</span>
                      {q.feedback?.correctAnswer && <> · Correct: <span className="text-emerald-300">{q.feedback.correctAnswer}</span></>}
                    </p>
                    {q.feedback?.explanation && <p className="text-slate-300">{q.feedback.explanation}</p>}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        {missed.length === 0 && <p className="text-sm text-emerald-300">Perfect, no mistakes!</p>}
      </section>

      <Link href={backHref} className="btn-secondary">
        <ArrowLeft className="h-4 w-4" /> {isProgram ? 'Back to exam programs' : 'Back to material'}
      </Link>
    </div>
  );
}
