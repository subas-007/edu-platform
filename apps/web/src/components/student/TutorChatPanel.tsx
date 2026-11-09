'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, FileText, Loader2, MessageSquarePlus, SendHorizontal, Sparkles, User } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { Flashcard, TutorAnswer } from '@/lib/types';
import { isPipelineBusy, useReadyMaterials } from '@/lib/use-materials';
import { EmptyState, PageHeader, Spinner } from '../ui';
import { MaterialPicker } from './MaterialPicker';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: TutorAnswer['citations'];
  grounded?: boolean;
}

const MAX_SELECTED = 20;
const SLOW_ANSWER_MS = 15_000;

function tutorErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not reach the server. Check your connection and try again.';
  if (err.status === 429) return 'You are asking questions very quickly. Please wait a moment and try again.';
  if (err.status === 503) return err.message; // model busy / not running (message from the API)
  if (err.status === 500 || err.status === 502 || err.status === 504) {
    return 'The tutor took too long to answer — the local AI model may be busy generating study material. Please try again in a minute.';
  }
  return err.message || 'Sorry, the tutor could not answer that.';
}

/**
 * The tutor answers ONLY from the documents the student selects: the selection is sent
 * as materialIds and the API restricts vector retrieval to those (already authorised) ids.
 */
export function TutorChatPanel() {
  const params = useSearchParams();
  const { ready, isLoading } = useReadyMaterials();
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

  // A different document selection is a different context: start a fresh conversation.
  const selectionKey = [...selected].sort().join(',');
  useEffect(() => setTurns([]), [selectionKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

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

  const ask = useMutation({
    mutationFn: (q: string) =>
      apiRequest<TutorAnswer>('/tutor/queries', {
        method: 'POST',
        json: {
          question: q,
          materialIds: selected,
          history: turns.slice(-6).map(({ role, content }) => ({ role, content })),
        },
      }),
    onSuccess: (res) =>
      setTurns((t) => [...t, { role: 'assistant', content: res.answer, citations: res.citations, grounded: res.grounded }]),
    onError: (err) => setTurns((t) => [...t, { role: 'assistant', content: tutorErrorMessage(err) }]),
  });

  // Local CPU inference can be slow, especially while documents are being generated.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!ask.isPending) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [ask.isPending]);
  const generationRunning = ready.some(isPipelineBusy);

  function send(q: string) {
    const text = q.trim();
    if (!text || ask.isPending || selected.length === 0) return;
    setTurns((t) => [...t, { role: 'user', content: text }]);
    setQuestion('');
    ask.mutate(text);
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
              {turns.length > 0 && (
                <button className="btn-ghost btn-sm ml-auto" onClick={() => setTurns([])}>
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
                  </div>
                </div>
              ))}

              {ask.isPending && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin text-aqua-400" aria-hidden />
                  {slow
                    ? generationRunning
                      ? 'Still thinking… the local AI model is also generating study material, so this can take a minute or two.'
                      : 'Still thinking… the local AI model can take up to a minute.'
                    : 'Reading your documents…'}
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
              <button className="btn-primary" disabled={ask.isPending || !question.trim() || selected.length === 0} aria-label="Send">
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
