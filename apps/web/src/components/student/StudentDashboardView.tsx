'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Award, Bot, BookOpen, ClipboardCheck, GraduationCap, Layers, PlusCircle, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api-client';
import type { AttemptSummary, Paginated, StudentProgram } from '@/lib/types';
import { isPipelineBusy, useMaterials } from '@/lib/use-materials';
import { displayName, useSessionUser } from '@/lib/use-session';
import { MaterialPipelineBadge } from '../MaterialPipeline';
import { EmptyState, formatDate, PageHeader, ProgressBar, StatCard } from '../ui';

export function StudentDashboardView() {
  const { data: user } = useSessionUser();
  const materials = useMaterials();
  const attempts = useQuery({
    queryKey: ['exam-sessions', 'history'],
    queryFn: () => apiRequest<Paginated<AttemptSummary>>('/exam-sessions?pageSize=100'),
  });
  const programs = useQuery({
    queryKey: ['exam-programs'],
    queryFn: () => apiRequest<StudentProgram[]>('/exam-papers/available'),
  });

  const items = materials.data?.items ?? [];
  const ready = items.filter((m) => m.status === 'READY');
  const processing = items.filter(isPipelineBusy);
  const flashcardCount = ready.reduce((s, m) => s + m._count.flashcards, 0);
  const completed = (attempts.data?.items ?? []).filter((a) => a.status !== 'IN_PROGRESS');
  const examScores = completed.filter((a) => a.mode === 'EXAM').map((a) => a.score ?? 0);
  const certificates = completed.filter((a) => a.certificateEligible).length;
  const openPrograms = (programs.data ?? []).filter((p) => p.status === 'PUBLISHED' && !p.enrolled);
  const enrolledPending = (programs.data ?? []).filter((p) => p.enrolled && p.attemptsUsed === 0 && p.status === 'PUBLISHED');

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title={`${greeting}${user ? `, ${displayName(user)}` : ''}`}
        subtitle="Pick up where you left off, review flashcards, practise, or ask the AI tutor about your documents."
        actions={
          <Link href="/student/materials" className="btn-primary">
            <PlusCircle className="h-4 w-4" /> Add material
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BookOpen} label="Ready materials" value={ready.length} hint={processing.length ? `${processing.length} processing` : 'All processed'} />
        <StatCard icon={Layers} label="Flashcards" value={flashcardCount} hint="Across all documents" tone="violet" />
        <StatCard
          icon={TrendingUp}
          label="Avg. exam score"
          value={examScores.length ? `${Math.round(examScores.reduce((s, x) => s + x, 0) / examScores.length)}%` : '—'}
          hint={`${completed.length} completed attempts`}
          tone="green"
        />
        <StatCard icon={Award} label="Certificates" value={certificates} hint="Exam mode above 70%" tone="amber" />
      </div>

      {(openPrograms.length > 0 || enrolledPending.length > 0) && (
        <Link href="/student/programs" className="card card-hover flex items-center gap-4 border-aqua-500/30 bg-gradient-to-r from-aqua-500/10 to-transparent">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-aqua-400 text-ink-950">
            <GraduationCap className="h-6 w-6" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-white">
              {openPrograms.length > 0
                ? `${openPrograms.length} exam program${openPrograms.length === 1 ? '' : 's'} open for enrollment`
                : `${enrolledPending.length} enrolled exam${enrolledPending.length === 1 ? '' : 's'} waiting for you`}
            </span>
            <span className="block truncate text-sm text-slate-400">
              {(openPrograms[0] ?? enrolledPending[0])?.title}
            </span>
          </span>
          <ArrowRight className="h-5 w-5 text-aqua-300" aria-hidden />
        </Link>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Continue learning</h2>
            <Link href="/student/materials" className="text-sm text-aqua-300 hover:underline">All materials</Link>
          </div>
          {items.length === 0 ? (
            <EmptyState icon={BookOpen} title="Upload your first document" action={<Link href="/student/materials" className="btn-primary">Add material</Link>}>
              Flashcards, practice questions and a study roadmap are generated automatically.
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {items.slice(0, 6).map((m) => (
                <article key={m.id} className="card card-hover flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    {m.status === 'READY' ? (
                      <Link href={`/student/materials/${m.id}`} className="line-clamp-2 font-medium text-white hover:text-aqua-300">{m.title}</Link>
                    ) : (
                      <span className="line-clamp-2 font-medium text-white">{m.title}</span>
                    )}
                    <MaterialPipelineBadge material={m} />
                  </div>
                  <p className="text-xs text-slate-500">
                    {m._count.flashcards} flashcards · {m._count.examQuestions} questions
                  </p>
                  {m.status === 'READY' && (
                    <div className="mt-auto flex flex-wrap gap-1.5">
                      <Link href={`/student/flashcards?materialId=${m.id}`} className="btn-ghost btn-sm"><Layers className="h-3.5 w-3.5" /> Cards</Link>
                      <Link href={`/student/practice?materialId=${m.id}`} className="btn-ghost btn-sm"><ClipboardCheck className="h-3.5 w-3.5" /> Practise</Link>
                      <Link href={`/student/tutor?materialIds=${m.id}`} className="btn-ghost btn-sm"><Bot className="h-3.5 w-3.5" /> Tutor</Link>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Recent attempts</h2>
            <Link href="/student/history" className="text-sm text-aqua-300 hover:underline">Results & certificates</Link>
          </div>
          <div className="card space-y-1 p-2">
            {(attempts.data?.items ?? []).length === 0 ? (
              <p className="p-4 text-sm text-slate-400">No attempts yet. Try learning mode on a ready material.</p>
            ) : (
              (attempts.data?.items ?? []).slice(0, 6).map((a) => (
                <Link key={a.id} href={`/student/exams/${a.id}`} className="flex items-center gap-3 rounded-xl p-3 transition hover:bg-ink-800">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${a.certificateEligible ? 'bg-amber-500/10 text-amber-300' : 'bg-ink-800 text-slate-400'}`}>
                    {a.certificateEligible ? <Award className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{a.title}</span>
                    <span className="text-xs text-slate-500">
                      {a.mode === 'EXAM' ? 'Exam' : 'Learning'} · {formatDate(a.completedAt ?? a.startedAt)}
                    </span>
                  </span>
                  {a.status === 'IN_PROGRESS' ? (
                    <span className="badge-amber">In progress</span>
                  ) : (
                    <span className="w-20">
                      <span className="mb-1 block text-right text-xs font-semibold text-white">{a.score ?? 0}%</span>
                      <ProgressBar value={a.score ?? 0} tone="auto" />
                    </span>
                  )}
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </>
  );
}
