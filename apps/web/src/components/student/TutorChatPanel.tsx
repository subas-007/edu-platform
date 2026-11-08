'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { TutorAnswer } from '@/lib/types';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: TutorAnswer['citations'];
  grounded?: boolean;
}

export function TutorChatPanel() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');

  const ask = useMutation({
    mutationFn: (q: string) =>
      apiRequest<TutorAnswer>('/tutor/queries', {
        method: 'POST',
        json: {
          question: q,
          history: turns.slice(-6).map(({ role, content }) => ({ role, content })),
        },
      }),
    onSuccess: (res) =>
      setTurns((t) => [...t, { role: 'assistant', content: res.answer, citations: res.citations, grounded: res.grounded }]),
    onError: () =>
      setTurns((t) => [...t, { role: 'assistant', content: 'Sorry, the tutor is unavailable right now.' }]),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || ask.isPending) return;
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setQuestion('');
    ask.mutate(q);
  }

  return (
    <section className="card flex h-[70vh] flex-col">
      <h2 className="mb-1 font-semibold">AI Tutor</h2>
      <p className="mb-4 text-xs text-slate-500">
        Answers come only from your course materials. Out-of-scope questions are declined.
      </p>
      <div className="flex-1 space-y-4 overflow-y-auto pr-2" aria-live="polite">
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2 text-left text-sm ${turn.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>
              {turn.content}
            </div>
            {turn.grounded && turn.citations && turn.citations.length > 0 && (
              <details className="mt-1 text-xs text-slate-500">
                <summary className="cursor-pointer">Sources ({turn.citations.length})</summary>
                <ul className="mt-1 space-y-1">
                  {turn.citations.map((c) => (
                    <li key={c.sourceId}>
                      <span className="font-medium">[{c.sourceId}] {c.materialTitle}</span> — “{c.excerpt}…”
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {ask.isPending && <p className="text-sm text-slate-400">Searching your materials…</p>}
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input className="input" maxLength={2000} placeholder="Ask about your course materials…"
          value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button className="btn-primary" disabled={ask.isPending || !question.trim()}>Ask</button>
      </form>
    </section>
  );
}
