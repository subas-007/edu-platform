'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Cloud, Cpu, FileText, MessageSquarePlus, SendHorizontal, Sparkles, Square, User } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest, apiStream, ApiError } from '@/lib/api-client';
import type { Flashcard, TutorAnswer, TutorStreamEvent } from '@/lib/types';
import { useReadyMaterials } from '@/lib/use-materials';
import { EmptyState, PageHeader, Spinner } from '../ui';
import { describeEngine, useAiSettings } from './AiSettingsView';
import { MaterialPicker } from './MaterialPicker';
import { TutorProgress, type TutorProgressState } from './TutorProgress';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: TutorAnswer['citations'];
  grounded?: boolean;
  /** How long the answer took, shown under it. */
  seconds?: number;
  stopped?: boolean;
}

const MAX_SELECTED = 20;

function tutorErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not reach the server. Check your connection and try again.';
  if (err.status === 429) return 'You are asking questions very quickly. Please wait a moment and try again.';
  if (err.status === 503) return err.message; // model busy / not running (message from the API)
  if (err.status === 500 || err.status === 502 || err.status === 504) {
    return 'The tutor took too long to answer — the local AI model may be busy generating study material. Please try again in a minute.';
  }
  return err.message || 'Sorry, the tutor could not answer that.';
}

function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * The tutor answers ONLY from the documents the student selects: the selection is sent
 * as materialIds and the API restricts vector retrieval to those (already authorised) ids.
 */
export function TutorChatPanel() {
  const params = useSearchParams();
  const { ready, isLoading } = useReadyMaterials();
  const aiSettings = useAiSettings();
  const [selected, setSelected] = useState<string[]>(() => {
    const raw = params.get('materialIds') ?? params.get('materialId');
    return raw ? raw.split(',').filter(Boolean).slice(0, MAX_SELECTED) : [];
  });
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Drop ids that aren't readable/ready (e.g. stale links).
  useEffect(() => {
    if (!isLoading) setSelected((s) => s.filter((id) => ready.some((m) => m.id === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, ready.length]);

  // The answer in progress: what the tutor is doing, then the text as it is written.
  const [progress, setProgress] = useState<TutorProgressState | null>(null);
  const [streamText, setStreamText] = useState<string | null>(null);
  const answerRef = useRef<{ controller: AbortController; discard: boolean } | null>(null);
  const busy = progress !== null || streamText !== null;

  /** Stops the answer in progress (the API cancels the model request); `discard` drops partial text. */
  function stop(discard = false) {
    if (!answerRef.current) return;
    answerRef.current.discard = discard;
    answerRef.current.controller.abort();
  }
  useEffect(() => {
    // A local model left idle is slow to answer the first question: start loading it now,
    // while the student picks documents and types.
    apiRequest('/tutor/warmup', { method: 'POST' }).catch(() => undefined);
    return () => stop(true); // leaving the page cancels the model work
  }, []);

  // A different document selection is a different context: start a fresh conversation.
  const selectionKey = [...selected].sort().join(',');
  useEffect(() => {
    stop(true);
    setTurns([]);
  }, [selectionKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, streamText, progress?.stage]);

  const selectedMaterials = ready.filter((m) => selected.includes(m.id));

  // Suggested starter questions come from the first selected document's flashcards (no LLM call).
  const firstWithCards = selectedMaterials.find((m) => m._count.flashcards > 0);
  const suggestionsQuery = useQuery({
    queryKey: ['flashcards', firstWithCards?.id],
    queryFn: () => apiRequest<Flashcard[]>(`/study-materials/${firstWithCards!.id}/flashcards`),
    enabled: Boolean(firstWithCards),
  });
  const suggestions = useMemo(
    () =>
      (suggestionsQuery.data ?? [])
        .map((c) => c.frontText)
        .filter((t) => t.length < 140)
        .slice(0, 3)
        .map((t) => (t.endsWith('?') ? t : `Explain: ${t}`)),
    [suggestionsQuery.data],
  );

  async function send(q: string) {
    const text = q.trim();
    if (!text || busy || selected.length === 0) return;
    const history = turns.slice(-6).map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setQuestion('');

    const current = { controller: new AbortController(), discard: false };
    answerRef.current = current;
    setProgress({ stage: 'searching', startedAt: Date.now(), waitingForBackground: false, sources: [] });
    let written = '';
    let finished = false;
    const finish = (turn: Omit<ChatTurn, 'role'>) => {
      finished = true;
      if (!current.discard) setTurns((t) => [...t, { role: 'assistant', ...turn }]);
    };

    const onEvent = (event: TutorStreamEvent) => {
      switch (event.type) {
        case 'stage':
          if (event.stage === 'waiting') {
            setProgress((p) => p && { ...p, waitingForBackground: true });
          } else if (event.stage === 'reading') {
            const { estimatedSeconds, promptTokens } = event;
            setProgress(
              (p) =>
                p && {
                  ...p,
                  stage: 'reading',
                  readingStartedAt: Date.now(),
                  estimatedReadSeconds: estimatedSeconds,
                  promptTokens,
                },
            );
          } else if (event.stage === 'writing') {
            setProgress(null);
            setStreamText('');
          } else {
            const stage = event.stage;
            setProgress((p) => p && { ...p, stage });
          }
          break;
        case 'sources': {
          const sources = event.citations;
          setProgress((p) => p && { ...p, sources });
          break;
        }
        case 'text':
          written += event.text;
          setStreamText(written);
          break;
        case 'done':
          finish({ content: event.answer, citations: event.citations, grounded: event.grounded, seconds: event.seconds });
          break;
        case 'error': {
          const message = event.status === 429 ? tutorErrorMessage(new ApiError(429, event.message)) : event.message;
          finish({ content: written ? `${written}\n\n(${message})` : message });
          break;
        }
      }
    };

    try {
      await apiStream<TutorStreamEvent>(
        '/tutor/queries/stream',
        { question: text, materialIds: selected, history },
        onEvent,
        current.controller.signal,
      );
      if (!finished) finish({ content: written || 'The connection to the tutor was lost. Please ask again.' });
    } catch (err) {
      if (current.controller.signal.aborted) {
        finish({ content: written ? `${written}…` : 'Stopped before the answer started.', stopped: true });
      } else {
        finish({ content: written ? `${written}…\n\n(${tutorErrorMessage(err)})` : tutorErrorMessage(err) });
      }
    } finally {
      if (answerRef.current === current) {
        answerRef.current = null;
        setProgress(null);
        setStreamText(null);
      }
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send(question);
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= MAX_SELECTED ? s : [...s, id]));
  }

  const picker = (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Documents</h2>
        <div className="flex gap-1">
          <button className="btn-ghost btn-sm" onClick={() => setSelected(ready.slice(0, MAX_SELECTED).map((m) => m.id))}>All</button>
          <button className="btn-ghost btn-sm" onClick={() => setSelected([])}>None</button>
        </div>
      </div>
      <MaterialPicker multiple materials={ready} selected={selected} onToggle={toggle} emptyText="Upload a document to start." />
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Learn"
        title="AI tutor"
        subtitle="Choose the documents to study. The tutor answers only from those documents, cites the passages it used, and declines anything they don't cover."
      />

      {isLoading ? (
        <Spinner />
      ) : ready.length === 0 ? (
        <EmptyState icon={Bot} title="No documents to tutor from">
          Upload a document under My materials. Once it&apos;s processed you can chat with the tutor about it.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="card hidden h-fit lg:sticky lg:top-24 lg:block">{picker}</aside>
          <details className="card lg:hidden">
            <summary className="cursor-pointer text-sm font-semibold text-white">
              Documents ({selected.length} selected)
            </summary>
            <div className="mt-3">{picker}</div>
          </details>

          <section className="card flex h-[calc(100vh-15rem)] min-h-[480px] flex-col p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-700/60 px-4 py-3">
              <span className="text-xs text-slate-400">Answering from:</span>
              {selectedMaterials.length === 0 ? (
                <span className="text-xs text-amber-300">no documents selected</span>
              ) : (
                selectedMaterials.map((m) => (
                  <span key={m.id} className="badge-aqua max-w-[14rem]">
                    <FileText className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{m.title}</span>
                  </span>
                ))
              )}
              {aiSettings.data && (
                <Link
                  href="/student/ai-settings"
                  title="Change the AI model"
                  className={`ml-auto ${aiSettings.data.mode === 'HOSTED' ? 'badge-violet' : 'badge-neutral'} hover:border-aqua-400/60`}
                >
                  {aiSettings.data.mode === 'HOSTED' ? <Cloud className="h-3 w-3" aria-hidden /> : <Cpu className="h-3 w-3" aria-hidden />}
                  {describeEngine(aiSettings.data)}
                  <span className="text-aqua-300">· change</span>
                </Link>
              )}
              {turns.length > 0 && (
                <button
                  className={`btn-ghost btn-sm ${aiSettings.data ? '' : 'ml-auto'}`}
                  onClick={() => {
                    stop(true);
                    setTurns([]);
                  }}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" /> New chat
                </button>
              )}
            </div>

            <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-5" aria-live="polite">
              {turns.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-aqua-500/10 text-aqua-300">
                    <Sparkles className="h-7 w-7" aria-hidden />
                  </span>
                  <p className="font-medium text-white">
                    {selected.length ? 'Ask anything about the selected documents' : 'Select at least one document to begin'}
                  </p>
                  {selected.length > 0 && suggestions.length > 0 && (
                    <div className="mt-4 flex max-w-xl flex-wrap justify-center gap-2">
                      {suggestions.map((s) => (
                        <button key={s} onClick={() => send(s)} className="rounded-full border border-ink-600 bg-ink-850 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-aqua-500/50 hover:text-white">
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {turns.map((turn, i) => (
                <div key={i} className={`flex gap-3 ${turn.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      turn.role === 'user' ? 'bg-ink-700 text-slate-200' : 'bg-aqua-500/15 text-aqua-300'
                    }`}
                    aria-hidden
                  >
                    {turn.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </span>
                  <div className={`max-w-[85%] ${turn.role === 'user' ? 'text-right' : ''}`}>
                    <div
                      className={`inline-block rounded-2xl px-4 py-2.5 text-left text-sm whitespace-pre-wrap ${
                        turn.role === 'user'
                          ? 'rounded-tr-sm bg-aqua-400 text-ink-950'
                          : 'rounded-tl-sm border border-ink-700 bg-ink-850 text-slate-200'
                      }`}
                    >
                      {turn.content}
                    </div>
                    {turn.grounded && turn.citations && turn.citations.length > 0 && (
                      <details className="mt-2 text-xs text-slate-400">
                        <summary className="cursor-pointer text-aqua-300/80 hover:text-aqua-300">
                          {turn.citations.length} source{turn.citations.length === 1 ? '' : 's'}
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {turn.citations.map((c) => (
                            <li key={c.sourceId} className="panel p-2.5">
                              <span className="font-medium text-slate-200">[{c.sourceId}] {c.materialTitle}</span>
                              <span className="mt-1 block text-slate-400">“{c.excerpt}…”</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {turn.grounded === false && (
                      <p className="mt-1 text-xs text-slate-500">Not covered by the selected documents. Try selecting more.</p>
                    )}
                    {turn.stopped && <p className="mt-1 text-xs text-slate-500">Stopped.</p>}
                    {turn.seconds !== undefined && turn.grounded !== false && (
                      <p className="mt-1 text-[11px] text-slate-500">Answered in {formatDuration(turn.seconds)}</p>
                    )}
                  </div>
                </div>
              ))}

              {progress && <TutorProgress state={progress} onStop={() => stop()} />}

              {streamText !== null && (
                <div className="flex gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-aqua-500/15 text-aqua-300" aria-hidden>
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="max-w-[85%]">
                    <div className="inline-block rounded-2xl rounded-tl-sm border border-ink-700 bg-ink-850 px-4 py-2.5 text-left text-sm whitespace-pre-wrap text-slate-200">
                      {streamText}
                      <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-aqua-300" aria-hidden />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>Writing…</span>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => stop()}>
                        <Square className="h-3 w-3" aria-hidden /> Stop
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2 border-t border-ink-700/60 p-3">
              <label className="flex-1">
                <span className="sr-only">Your question</span>
                <input
                  className="input"
                  maxLength={2000}
                  placeholder={selected.length ? 'Ask about the selected documents…' : 'Select documents first'}
                  disabled={selected.length === 0}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </label>
              <button className="btn-primary" disabled={busy || !question.trim() || selected.length === 0} aria-label="Send">
                <SendHorizontal className="h-4 w-4" />
                <span className="hidden sm:inline">Ask</span>
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
