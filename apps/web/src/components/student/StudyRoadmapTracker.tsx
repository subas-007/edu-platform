'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { RoadmapView } from '@/lib/types';

export function StudyRoadmapTracker({ materialId }: { materialId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['study-roadmap', materialId];
  const { data: roadmap, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => apiRequest<RoadmapView>(`/study-roadmaps/${materialId}`),
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

  if (isLoading) return <p className="text-sm text-slate-500">Loading roadmap…</p>;
  if (isError || !roadmap) return <p className="text-sm text-slate-500">Roadmap is being generated…</p>;

  const percent = Math.round(roadmap.completionRatio * 100);
  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Study roadmap</h2>
        <span className="text-xs text-slate-500">
          ~{roadmap.estimatedHours} h total · {Math.round(roadmap.remainingMinutes)} min remaining
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-indigo-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
      <ol className="space-y-2">
        {roadmap.milestones.map((m) => (
          <li key={m.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
            <input type="checkbox" className="mt-1" checked={m.completed}
              onChange={(e) => toggleMilestone.mutate({ milestoneId: m.id, completed: e.target.checked })} />
            <div>
              <p className={`text-sm font-medium ${m.completed ? 'text-slate-400 line-through' : ''}`}>{m.title}</p>
              {m.summary && <p className="text-xs text-slate-500">{m.summary}</p>}
              <p className="text-xs text-slate-400">{m.estimatedMinutes} min</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">The roadmap is a suggestion — you can take an exam at any time.</p>
    </section>
  );
}
