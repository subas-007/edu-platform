'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Award,
  BarChart3,
  Lock,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { BankQuestion, BankResource, ExamPaperDetail, ExamPaperStatus, Paginated } from '@/lib/types';
import { ErrorText, formatDate, PageHeader, Spinner, StatCard } from '../ui';
import { PAPER_STATUS_BADGE } from './ProgramsManagerView';

export function PaperDetailView({ paperId, basePath }: { paperId: string; basePath: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryKey = ['exam-paper', paperId];
  const { data: paper, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiRequest<ExamPaperDetail>(`/exam-papers/${paperId}`),
  });

  const [settings, setSettings] = useState({ title: '', description: '', durationMinutes: 30, maxAttempts: 1 });
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!paper) return;
    setSettings({ title: paper.title, description: paper.description, durationMinutes: paper.durationMinutes, maxAttempts: paper.maxAttempts });
    setQuestionIds(paper.questions.map((q) => q.id));
  }, [paper]);

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      apiRequest<ExamPaperDetail>(`/exam-papers/${paperId}`, { method: 'PATCH', json: patch }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ['exam-papers'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/exam-papers/${paperId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exam-papers'] });
      router.push(`${basePath}/programs`);
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !paper) return <ErrorText error={error ?? new Error('Not found')} />;

  const isDraft = paper.status === 'DRAFT';
  const questionsChanged = questionIds.join() !== paper.questions.map((q) => q.id).join();
  const settingsChanged =
    settings.title !== paper.title ||
    settings.description !== paper.description ||
    settings.durationMinutes !== paper.durationMinutes ||
    settings.maxAttempts !== paper.maxAttempts;
  const questionById = new Map(paper.questions.map((q) => [q.id, q]));
  const setStatus = (status: ExamPaperStatus) => update.mutate({ status });

  return (
    <>
      <Link href={`${basePath}/programs`} className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Exam programs
      </Link>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Exam program <span className={PAPER_STATUS_BADGE[paper.status]}>{paper.status.toLowerCase()}</span></span>}
        title={paper.title}
        subtitle={`Created by ${paper.createdBy.fullName ?? paper.createdBy.email} on ${formatDate(paper.createdAt)}${paper.publishedAt ? ` · published ${formatDate(paper.publishedAt)}` : ''}`}
        actions={
          <>
            {paper.status === 'DRAFT' && (
              <button className="btn-primary" disabled={update.isPending || questionsChanged || paper.questions.length === 0} onClick={() => setStatus('PUBLISHED')}
                title={questionsChanged ? 'Save question changes first' : undefined}>
                <Rocket className="h-4 w-4" /> Publish
              </button>
            )}
            {paper.status === 'PUBLISHED' && (
              <button className="btn-secondary" disabled={update.isPending} onClick={() => setStatus('CLOSED')}>
                <Lock className="h-4 w-4" /> Close
              </button>
            )}
            {paper.status === 'CLOSED' && (
              <button className="btn-secondary" disabled={update.isPending} onClick={() => setStatus('PUBLISHED')}>
                <RotateCcw className="h-4 w-4" /> Reopen
              </button>
            )}
            {paper.status !== 'DRAFT' && paper.stats.attemptCount === 0 && (
              <button className="btn-ghost" disabled={update.isPending} onClick={() => setStatus('DRAFT')}>
                <Undo2 className="h-4 w-4" /> Back to draft
              </button>
            )}
            {paper.stats.attemptCount === 0 && (
              <button className="btn-danger" disabled={remove.isPending} onClick={() => confirm('Delete this exam program?') && remove.mutate()}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </>
        }
      />
      {paper.requestedQuestionCount !== undefined && paper.requestedQuestionCount > paper.questions.length && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          Only {paper.questions.length} approved questions matched (you asked for {paper.requestedQuestionCount}). Approve more in the question bank or add other resources.
        </p>
      )}
      <ErrorText error={update.error ?? remove.error} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Enrolled" value={paper.stats.enrollmentCount} />
        <StatCard icon={BarChart3} label="Completed attempts" value={paper.stats.completedAttemptCount} hint={`${paper.stats.attemptCount} started`} tone="violet" />
        <StatCard icon={BarChart3} label="Average score" value={paper.stats.averageScore !== null ? `${paper.stats.averageScore}%` : '—'} tone="green" />
        <StatCard icon={Award} label="Certificates" value={paper.stats.certificatesIssued} hint="Score above 70%" tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-white">Questions ({questionIds.length})</h2>
            {isDraft ? (
              <div className="flex gap-2">
                <button className="btn-secondary btn-sm" onClick={() => setAdding((a) => !a)}><Plus className="h-3.5 w-3.5" /> Add from bank</button>
                {questionsChanged && (
                  <>
                    <button className="btn-ghost btn-sm" onClick={() => setQuestionIds(paper.questions.map((q) => q.id))}>Discard</button>
                    <button className="btn-primary btn-sm" disabled={update.isPending || questionIds.length === 0} onClick={() => update.mutate({ questionIds })}>
                      <Save className="h-3.5 w-3.5" /> Save questions
                    </button>
                  </>
                )}
              </div>
            ) : (
              <span className="text-xs text-slate-500">Move back to draft to change questions</span>
            )}
          </div>

          {adding && isDraft && (
            <AddFromBank existing={questionIds} onAdd={(q) => setQuestionIds((ids) => [...ids, q.id])} />
          )}

          <ol className="space-y-2">
            {questionIds.map((id, i) => {
              const q = questionById.get(id) ?? addedCache.get(id);
              if (!q) return null;
              return (
                <li key={id} className="panel p-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink-700 text-xs font-semibold text-slate-300">{i + 1}</span>
                    <details className="min-w-0 flex-1">
                      <summary className="cursor-pointer text-sm text-slate-200">{q.questionText}</summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {q.options.map((o) => (
                          <li key={o.id} className={o.id === q.correctAnswer ? 'text-emerald-300' : 'text-slate-400'}>
                            {o.id}. {o.text}{o.id === q.correctAnswer && ' ✓'}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-slate-500">{q.explanation}</p>
                    </details>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="badge-neutral">{q.conceptTag}</span>
                      <span className="max-w-40 truncate text-[11px] text-slate-500">{q.material.title}</span>
                      {isDraft && (
                        <button className="btn-ghost btn-sm text-slate-400 hover:text-red-300" aria-label="Remove question"
                          onClick={() => setQuestionIds((ids) => ids.filter((x) => x !== id))}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="space-y-6">
          <section className="card space-y-4">
            <h2 className="font-semibold text-white">Settings</h2>
            <label className="block">
              <span className="label">Title</span>
              <input className="input" maxLength={200} value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Instructions</span>
              <textarea className="input min-h-20" maxLength={2000} value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Minutes</span>
                <input className="input" type="number" min={5} max={300} value={settings.durationMinutes} onChange={(e) => setSettings({ ...settings, durationMinutes: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="label">Attempts</span>
                <select className="input" value={settings.maxAttempts} onChange={(e) => setSettings({ ...settings, maxAttempts: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <button className="btn-primary w-full" disabled={!settingsChanged || update.isPending}
              onClick={() => update.mutate(settings)}>
              <Save className="h-4 w-4" /> Save settings
            </button>
            <div>
              <p className="label">Resources</p>
              <div className="flex flex-wrap gap-1">
                {paper.materials.map((m) => <span key={m.id} className="badge-neutral">{m.title}</span>)}
              </div>
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="font-semibold text-white">Candidates</h2>
            {paper.candidates.length === 0 ? (
              <p className="text-sm text-slate-400">{paper.status === 'PUBLISHED' ? 'No enrollments yet.' : 'Publish the program so students can enroll.'}</p>
            ) : (
              <ul className="divide-y divide-ink-700/60">
                {paper.candidates.map((c) => (
                  <li key={c.studentId} className="flex items-center gap-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-white">{c.fullName ?? c.email}</span>
                      <span className="text-xs text-slate-500">{c.attempts} attempt{c.attempts === 1 ? '' : 's'}</span>
                    </span>
                    {c.certified && <Award className="h-4 w-4 text-amber-300" aria-label="Certified" />}
                    <span className="w-12 text-right font-semibold tabular-nums text-white">{c.bestScore !== null ? `${c.bestScore}%` : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

/** Questions picked in this session that aren't in the saved paper yet. */
const addedCache = new Map<string, BankQuestion>();

function AddFromBank({ existing, onAdd }: { existing: string[]; onAdd: (q: BankQuestion) => void }) {
  const [materialId, setMaterialId] = useState('');
  const resources = useQuery({
    queryKey: ['bank-resources'],
    queryFn: () => apiRequest<BankResource[]>('/exam-questions/resources'),
  });
  const bank = useQuery({
    queryKey: ['exam-questions', 'approved', materialId],
    queryFn: () => apiRequest<Paginated<BankQuestion>>(`/exam-questions?reviewStatus=APPROVED&pageSize=100&materialId=${materialId}`),
    enabled: Boolean(materialId),
  });
  const candidates = (bank.data?.items ?? []).filter((q) => !existing.includes(q.id));

  return (
    <div className="panel space-y-3 p-3">
      <select className="input" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
        <option value="">Choose a resource…</option>
        {(resources.data ?? []).filter((r) => r.counts.approved > 0).map((r) => (
          <option key={r.id} value={r.id}>{r.title} ({r.counts.approved})</option>
        ))}
      </select>
      {bank.isLoading && materialId && <Spinner />}
      {materialId && !bank.isLoading && candidates.length === 0 && <p className="text-sm text-slate-400">Every approved question from this resource is already in the paper.</p>}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {candidates.map((q) => (
          <li key={q.id} className="flex items-start gap-2 rounded-lg p-2 hover:bg-ink-800">
            <span className="min-w-0 flex-1 text-sm text-slate-300">{q.questionText}</span>
            <button
              className="btn-secondary btn-sm"
              onClick={() => {
                addedCache.set(q.id, q);
                onAdd(q);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
