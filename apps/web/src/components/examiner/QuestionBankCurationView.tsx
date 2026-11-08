'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Database, FilePlus2, FileText, Recycle, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { BankQuestion, BankResource, Paginated, ReviewStatus } from '@/lib/types';
import { EmptyState, ErrorText, PageHeader, Spinner } from '../ui';

const STATUS_TABS: Array<{ value: ReviewStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: 'Pending review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

/**
 * The question bank, categorised by source resource. Approved questions are reused
 * by practice sessions and by exam programs without any further AI computation.
 */
export function QuestionBankCurationView({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [materialId, setMaterialId] = useState<string | null>(params.get('materialId'));
  const [status, setStatus] = useState<ReviewStatus | 'ALL'>('PENDING');
  const [concept, setConcept] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setConcept(''), [materialId]);

  const resources = useQuery({
    queryKey: ['bank-resources'],
    queryFn: () => apiRequest<BankResource[]>('/exam-questions/resources'),
  });

  const qs = new URLSearchParams({ pageSize: '50' });
  if (materialId) qs.set('materialId', materialId);
  if (status !== 'ALL') qs.set('reviewStatus', status);
  if (concept) qs.set('conceptTag', concept);
  if (debouncedSearch) qs.set('search', debouncedSearch);
  const questions = useQuery({
    queryKey: ['exam-questions', qs.toString()],
    queryFn: () => apiRequest<Paginated<BankQuestion>>(`/exam-questions?${qs}`),
  });

  const review = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; reviewStatus?: ReviewStatus; correctAnswer?: string }) =>
      apiRequest(`/exam-questions/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exam-questions'] });
      void queryClient.invalidateQueries({ queryKey: ['bank-resources'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const allResources = resources.data ?? [];
  const totals = allResources.reduce(
    (t, r) => ({ approved: t.approved + r.counts.approved, pending: t.pending + r.counts.pending, total: t.total + r.counts.total }),
    { approved: 0, pending: 0, total: 0 },
  );
  const current = allResources.find((r) => r.id === materialId);
  const visibleResources = allResources.filter((r) => r.title.toLowerCase().includes(resourceFilter.toLowerCase()));

  function selectResource(id: string | null) {
    setMaterialId(id);
    const next = new URLSearchParams(params.toString());
    if (id) next.set('materialId', id);
    else next.delete('materialId');
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        eyebrow="Assessment"
        title="Question bank"
        subtitle="AI-generated questions grouped by source resource. Approve questions to use them in practice and exam programs. Re-uploaded documents reuse their bank entries automatically."
        actions={
          <Link
            href={`${basePath}/programs/new${materialId ? `?materialIds=${materialId}` : ''}`}
            className="btn-primary"
          >
            <FilePlus2 className="h-4 w-4" /> New exam program
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="card h-fit space-y-3 p-3 lg:sticky lg:top-24">
          <div className="px-2 pt-1">
            <p className="text-sm font-semibold text-white">Resources</p>
            <p className="text-xs text-slate-500">{totals.total} questions · {totals.approved} approved · {totals.pending} pending</p>
          </div>
          {allResources.length > 6 && (
            <input className="input" placeholder="Filter resources…" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} />
          )}
          <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
            <li>
              <button
                onClick={() => selectResource(null)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${!materialId ? 'bg-aqua-500/10 text-aqua-200' : 'text-slate-300 hover:bg-ink-800'}`}
              >
                <Database className="h-4 w-4 shrink-0" aria-hidden />
                <span className="flex-1">All resources</span>
                <span className="text-xs text-slate-500">{totals.total}</span>
              </button>
            </li>
            {visibleResources.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => selectResource(r.id)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${materialId === r.id ? 'bg-aqua-500/10 text-aqua-200' : 'text-slate-300 hover:bg-ink-800'}`}
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      <span className="text-[11px] text-emerald-300">{r.counts.approved} approved</span>
                      {r.counts.pending > 0 && <span className="text-[11px] text-amber-300">· {r.counts.pending} pending</span>}
                      {r.reusedFromId && <Recycle className="h-3 w-3 text-aqua-400" aria-label="reused" />}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {resources.isLoading && <Spinner />}
        </aside>

        <section className="min-w-0 space-y-4">
          {current && (
            <div className="card flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs tracking-wide text-slate-400 uppercase">Resource</p>
                <p className="truncate text-lg font-semibold text-white">{current.title}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {current.concepts.slice(0, 12).map((c) => (
                    <button
                      key={c.conceptTag}
                      onClick={() => setConcept(concept === c.conceptTag ? '' : c.conceptTag)}
                      className={concept === c.conceptTag ? 'badge-aqua' : 'badge-neutral hover:border-ink-500'}
                    >
                      {c.conceptTag} · {c.approved}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="panel px-3 py-2"><p className="text-lg font-semibold text-emerald-300">{current.counts.approved}</p><p className="text-[10px] text-slate-500 uppercase">Approved</p></div>
                <div className="panel px-3 py-2"><p className="text-lg font-semibold text-amber-300">{current.counts.pending}</p><p className="text-[10px] text-slate-500 uppercase">Pending</p></div>
                <div className="panel px-3 py-2"><p className="text-lg font-semibold text-slate-300">{current.counts.rejected}</p><p className="text-[10px] text-slate-500 uppercase">Rejected</p></div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="segmented overflow-x-auto" role="group" aria-label="Review status">
              {STATUS_TABS.map((t) => (
                <button key={t.value} aria-pressed={status === t.value} onClick={() => setStatus(t.value)}>{t.label}</button>
              ))}
            </div>
            <label className="relative flex-1">
              <span className="sr-only">Search questions</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
              <input className="input pl-9" placeholder="Search question text…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
          <ErrorText error={review.error} />

          {questions.isLoading ? (
            <Spinner />
          ) : !questions.data?.items.length ? (
            <EmptyState icon={Database} title="No questions match">
              {status === 'PENDING' ? 'Nothing is waiting for review here.' : 'Try another resource, status or search.'}
            </EmptyState>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Showing {questions.data.items.length} of {questions.data.total}
              </p>
              {questions.data.items.map((q) => (
                <article key={q.id} className="card space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={q.reviewStatus === 'APPROVED' ? 'badge-green' : q.reviewStatus === 'PENDING' ? 'badge-amber' : 'badge-red'}>
                      {q.reviewStatus.toLowerCase()}
                    </span>
                    {q.questionType === 'SCENARIO' && <span className="badge-violet">Scenario</span>}
                    <span className="badge-neutral">{q.conceptTag}</span>
                    {!materialId && <span className="truncate text-slate-500">· {q.material.title}</span>}
                  </div>
                  <p className="font-medium text-white">{q.questionText}</p>
                  <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                    {q.options.map((o) => (
                      <li key={o.id}>
                        <label className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition ${o.id === q.correctAnswer ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100' : 'border-ink-700 text-slate-300 hover:border-ink-500'}`}>
                          <input
                            type="radio"
                            className="mt-1 accent-[var(--color-aqua-400)]"
                            name={`correct-${q.id}`}
                            checked={o.id === q.correctAnswer}
                            onChange={() => review.mutate({ id: q.id, correctAnswer: o.id })}
                            aria-label={`Mark ${o.id} as the correct answer`}
                          />
                          <span><span className="font-semibold">{o.id}.</span> {o.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="rounded-lg bg-ink-850 p-3 text-sm text-slate-400">{q.explanation}</p>
                  <div className="flex gap-2">
                    {q.reviewStatus !== 'APPROVED' && (
                      <button className="btn-primary btn-sm" disabled={review.isPending} onClick={() => review.mutate({ id: q.id, reviewStatus: 'APPROVED' })}>
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                    )}
                    {q.reviewStatus !== 'REJECTED' && (
                      <button className="btn-secondary btn-sm" disabled={review.isPending} onClick={() => review.mutate({ id: q.id, reviewStatus: 'REJECTED' })}>
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}
