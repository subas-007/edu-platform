'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { BankResource, ExamPaperDetail } from '@/lib/types';
import { EmptyState, ErrorText, PageHeader, Spinner } from '../ui';

/** Ad-hoc question paper: choose resources (and optionally concepts); questions come from the bank. */
export function PaperBuilderView({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>(() => params.get('materialIds')?.split(',').filter(Boolean) ?? []);
  const [concepts, setConcepts] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(20);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [maxAttempts, setMaxAttempts] = useState(1);

  const resources = useQuery({
    queryKey: ['bank-resources'],
    queryFn: () => apiRequest<BankResource[]>('/exam-questions/resources'),
  });
  const usable = (resources.data ?? []).filter((r) => r.counts.approved > 0);
  const chosen = usable.filter((r) => selected.includes(r.id));

  const conceptOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of chosen) for (const c of r.concepts) map.set(c.conceptTag, (map.get(c.conceptTag) ?? 0) + c.approved);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [chosen]);

  const available = concepts.length
    ? conceptOptions.filter(([tag]) => concepts.includes(tag)).reduce((s, [, n]) => s + n, 0)
    : chosen.reduce((s, r) => s + r.counts.approved, 0);

  const create = useMutation({
    mutationFn: () =>
      apiRequest<ExamPaperDetail>('/exam-papers', {
        method: 'POST',
        json: {
          title,
          description,
          materialIds: selected,
          questionCount,
          durationMinutes,
          maxAttempts,
          ...(concepts.length ? { conceptTags: concepts } : {}),
        },
      }),
    onSuccess: (paper) => router.push(`${basePath}/programs/${paper.id}`),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <>
      <Link href={`${basePath}/programs`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Exam programs
      </Link>
      <PageHeader
        eyebrow="New exam program"
        title="Assemble a question paper"
        subtitle="Questions are drawn from the approved question bank, balanced across the selected resources. You can review and adjust the paper before publishing."
      />

      {resources.isLoading ? (
        <Spinner />
      ) : usable.length === 0 ? (
        <EmptyState icon={Sparkles} title="No approved questions yet" action={<Link href={`${basePath}/question-bank`} className="btn-primary">Open question bank</Link>}>
          Approve AI-generated questions in the question bank first. They become available for exam programs immediately.
        </EmptyState>
      ) : (
        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-6">
            <section className="card space-y-4">
              <h2 className="font-semibold text-white">1. Details</h2>
              <label className="block">
                <span className="label">Title</span>
                <input className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Module 3 final assessment" />
              </label>
              <label className="block">
                <span className="label">Instructions for candidates (optional)</span>
                <textarea className="input min-h-24" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
            </section>

            <section className="card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white">2. Resources</h2>
                <span className="text-xs text-slate-500">{selected.length} selected</span>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {usable.map((r) => {
                  const on = selected.includes(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(selected, setSelected, r.id)}
                        className={`flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left text-sm transition ${on ? 'border-aqua-500/60 bg-aqua-500/10' : 'border-ink-700 hover:border-ink-500'}`}
                      >
                        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-aqua-400 bg-aqua-400' : 'border-ink-500'}`} aria-hidden>
                          {on && <span className="h-2 w-2 rounded-sm bg-ink-950" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-white">{r.title}</span>
                          <span className="text-xs text-emerald-300">{r.counts.approved} approved questions</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {conceptOptions.length > 0 && (
              <section className="card space-y-3">
                <h2 className="font-semibold text-white">3. Focus concepts <span className="text-sm font-normal text-slate-500">(optional)</span></h2>
                <p className="text-xs text-slate-500">Leave empty to cover every concept in the selected resources.</p>
                <div className="flex flex-wrap gap-2">
                  {conceptOptions.map(([tag, n]) => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => toggle(concepts, setConcepts, tag)}
                      className={concepts.includes(tag) ? 'badge-aqua px-3 py-1 text-xs' : 'badge-neutral px-3 py-1 text-xs hover:border-ink-500'}
                    >
                      {tag} · {n}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="card h-fit space-y-5 lg:sticky lg:top-24">
            <h2 className="font-semibold text-white">Paper settings</h2>
            <label className="block">
              <span className="label">Questions: <span className="text-aqua-300">{Math.min(questionCount, Math.max(available, 1))}</span> of {available} available</span>
              <input type="range" min={1} max={Math.max(1, Math.min(100, available))} value={Math.min(questionCount, Math.max(available, 1))}
                onChange={(e) => setQuestionCount(Number(e.target.value))} className="w-full accent-[var(--color-aqua-400)]" disabled={available === 0} />
            </label>
            <label className="block">
              <span className="label">Duration (minutes)</span>
              <input className="input" type="number" min={5} max={300} value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} />
            </label>
            <label className="block">
              <span className="label">Attempts allowed per student</span>
              <select className="input" value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="panel space-y-1 p-3 text-xs text-slate-400">
              <p>• Certificates are issued for scores above 70%.</p>
              <p>• Answer keys stay hidden from candidates, so questions can be reused.</p>
              <p>• The paper starts as a draft; publish it when ready.</p>
            </div>
            <ErrorText error={create.error} />
            <button className="btn-primary w-full" disabled={create.isPending || selected.length === 0 || !title.trim() || available === 0}>
              <Sparkles className="h-4 w-4" /> {create.isPending ? 'Assembling…' : 'Assemble paper'}
            </button>
          </aside>
        </form>
      )}
    </>
  );
}
