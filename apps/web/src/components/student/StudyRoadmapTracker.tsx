'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Map as MapIcon } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';
import type { RoadmapView } from '@/lib/types';
import { EmptyState, ProgressBar, Spinner } from '../ui';

export function StudyRoadmapTracker({ materialId, generating = true }: { materialId: string; generating?: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ['study-roadmap', materialId];
  const { data: roadmap, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => apiRequest<RoadmapView>(`/study-roadmaps/${materialId}`),
    // The roadmap is the last thing generation writes.
    refetchInterval: (q) => (q.state.status === 'error' && generating ? 10_000 : false),
    retry: false,
  });

  const toggleMilestone = useMutation({
    mutationFn: (v: { milestoneId: string; completed: boolean }) =>
      apiRequest<RoadmapView>(`/study-roadmaps/${materialId}/progress`, { method: 'PUT', json: v }),
    // Optimistic update so ticking a milestone feels instant.
    onMutate: async ({ milestoneId, completed }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<RoadmapView>(queryKey);
      if (previous) {
        queryClient.setQueryData<RoadmapView>(queryKey, {
          ...previous,
          milestones: previous.milestones.map((m) => (m.id === milestoneId ? { ...m, completed } : m)),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && queryClient.setQueryData(queryKey, ctx.previous),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  if (isLoading) return <div className="card"><Spinner label="Loading roadmap…" /></div>;
  if (isError || !roadmap) {
    return (
      <div className="card">
        {generating ? (
          <EmptyState icon={MapIcon} title="Roadmap is being generated">
            It is created after the flashcards and questions, and appears here automatically.
          </EmptyState>
        ) : (
          <EmptyState icon={MapIcon} title="No roadmap">The study roadmap was not generated for this material.</EmptyState>
        )}
      </div>
    );
  }

  const percent = Math.round(roadmap.completionRatio * 100);
  return (
    <section className="card h-fit space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-aqua-400" aria-hidden />
          <h2 className="font-semibold text-white">Study roadmap</h2>
        </div>
        <span className="text-xs text-slate-400">
          ~{roadmap.estimatedHours} h · {Math.round(roadmap.remainingMinutes)} min left
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1"><ProgressBar value={percent} /></div>
        <span className="text-sm font-semibold text-aqua-300 tabular-nums">{percent}%</span>
      </div>
      <ol className="relative space-y-1 before:absolute before:top-3 before:bottom-3 before:left-[15px] before:w-px before:bg-ink-700">
        {roadmap.milestones.map((m, i) => (
          <li key={m.id} className="relative">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 transition hover:bg-ink-800/60">
              <input
                type="checkbox"
                className="sr-only"
                checked={m.completed}
                onChange={(e) => toggleMilestone.mutate({ milestoneId: m.id, completed: e.target.checked })}
              />
              <span
                className={`relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition ${
                  m.completed ? 'border-aqua-400 bg-aqua-400 text-ink-950' : 'border-ink-500 bg-ink-900 text-slate-400'
                }`}
                aria-hidden
              >
                {m.completed ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0 pt-1">
                <span className={`block text-sm font-medium ${m.completed ? 'text-slate-500 line-through' : 'text-white'}`}>{m.title}</span>
                {m.summary && <span className="mt-0.5 block text-xs text-slate-400">{m.summary}</span>}
                <span className="mt-0.5 block text-[11px] text-slate-500">{m.estimatedMinutes} min</span>
              </span>
            </label>
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">The roadmap is a suggestion. You can take an exam at any time.</p>
    </section>
  );
}
