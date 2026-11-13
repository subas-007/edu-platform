'use client';

import { Check, Circle, FileText, Loader2, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TutorAnswer } from '@/lib/types';
import { ProgressBar } from '../ui';

export type TutorStage = 'searching' | 'selecting' | 'reading' | 'writing';

export interface TutorProgressState {
  stage: TutorStage;
  startedAt: number;
  /** A background generation call is stepping aside so this question goes first. */
  waitingForBackground: boolean;
  sources: TutorAnswer['citations'];
  readingStartedAt?: number;
  estimatedReadSeconds?: number;
  promptTokens?: number;
}

/** Steps before the answer starts; once it is being written it streams in place of this panel. */
const STEPS: { key: TutorStage; label: string }[] = [
  { key: 'searching', label: 'Searching your documents' },
  { key: 'selecting', label: 'Picking the passages that answer your question' },
  { key: 'reading', label: 'AI is reading the passages' },
];
const ORDER: Record<TutorStage, number> = { searching: 0, selecting: 1, reading: 2, writing: 3 };

/** Re-renders every half second while mounted, for live timers. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function formatSeconds(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * Shows what the tutor is doing while the student waits. On a local CPU model most of the
 * wait is the model reading the prompt, so that step has a progress bar with an estimate
 * (from the API's measured reading speed); the answer then streams in below this panel.
 */
export function TutorProgress({ state, onStop }: { state: TutorProgressState; onStop: () => void }) {
  const now = useNow();
  const elapsed = (now - state.startedAt) / 1000;
  const current = ORDER[state.stage];

  let readingPercent = 0;
  let readingNote = '';
  if (state.stage === 'reading' && state.readingStartedAt && state.estimatedReadSeconds) {
    const spent = (now - state.readingStartedAt) / 1000;
    readingPercent = Math.min(95, (spent / state.estimatedReadSeconds) * 100);
    const left = state.estimatedReadSeconds - spent;
    readingNote = left > 3 ? `about ${formatSeconds(left)} left` : 'almost there…';
  }
  const materials = [...new Set(state.sources.map((s) => s.materialTitle))];

  return (
    <div role="status" aria-live="polite" className="rounded-2xl border border-aqua-500/30 bg-aqua-500/5 p-4 text-sm">
      <div className="mb-3 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-aqua-300" aria-hidden />
        <span className="flex-1 font-medium text-aqua-100">Working on your answer</span>
        <span className="text-xs tabular-nums text-slate-400">{formatSeconds(elapsed)}</span>
        <button type="button" className="btn-ghost btn-sm" onClick={onStop}>
          <Square className="h-3 w-3" aria-hidden /> Stop
        </button>
      </div>

      <ol className="space-y-2.5">
        {STEPS.map((step) => {
          const index = ORDER[step.key];
          const done = index < current;
          const active = index === current;
          return (
            <li key={step.key} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {done ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-aqua-300" />
                ) : (
                  <Circle className="h-4 w-4 text-slate-600" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={done ? 'text-slate-400' : active ? 'text-white' : 'text-slate-500'}>
                  {step.label}
                  {step.key === 'selecting' && done && state.sources.length > 0 && (
                    <span className="text-slate-500">
                      {' '}
                      · {state.sources.length} passage{state.sources.length === 1 ? '' : 's'}
                    </span>
                  )}
                </p>

                {step.key === 'selecting' && done && materials.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {materials.map((title) => (
                      <span key={title} className="badge-aqua max-w-[16rem]">
                        <FileText className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate">{title}</span>
                      </span>
                    ))}
                  </div>
                )}

                {step.key === 'reading' && active && (
                  <div className="mt-1.5 space-y-1">
                    {state.waitingForBackground && (
                      <p className="text-xs text-amber-200/90">
                        Pausing background flashcard generation so your question goes first…
                      </p>
                    )}
                    <ProgressBar value={Math.max(3, readingPercent)} />
                    <p className="text-xs text-slate-400">
                      {state.promptTokens ? `~${Math.round(state.promptTokens * 0.75).toLocaleString()} words · ` : ''}
                      {readingNote}
                    </p>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
