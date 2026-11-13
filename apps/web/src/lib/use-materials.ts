'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { useSessionUser } from './use-session';
import type { AssetKind, MaterialGeneration, Paginated, StudyMaterial } from './types';

/** Where a material is in the upload → process → generate pipeline. */
export type PipelineStage = 'queued' | 'processing' | 'generating' | 'complete' | 'failed' | 'generation-failed';

export function pipelineStage(m: Pick<StudyMaterial, 'status' | 'generationStatus'>): PipelineStage {
  if (m.status === 'QUEUED') return 'queued';
  if (m.status === 'PROCESSING') return 'processing';
  if (m.status === 'FAILED') return 'failed';
  if (m.generationStatus === 'FAILED') return 'generation-failed';
  if (m.generationStatus === 'COMPLETED') return 'complete';
  return 'generating';
}

export function isGenerationActive(run: Pick<MaterialGeneration, 'status'>) {
  return run.status === 'PENDING' || run.status === 'GENERATING';
}

/**
 * Stopped, but the worker is still cancelling its model call and counting what it kept
 * (a few seconds). A new run of this kind is refused until then.
 */
export function isRunStopping(run: Pick<MaterialGeneration, 'status' | 'added' | 'updatedAt'>) {
  return run.status === 'CANCELLED' && run.added == null && Date.now() - Date.parse(run.updatedAt) < 60_000;
}

/** The flashcard or question run the student asked for, while it is queued or running. */
export function activeRun(m: Pick<StudyMaterial, 'generations'>, kind: AssetKind) {
  return m.generations?.find((g) => g.kind === kind && isGenerationActive(g));
}

/** Still changing on the server (processing, or flashcards/questions being written), so views should poll. */
export function isPipelineBusy(m: Pick<StudyMaterial, 'status' | 'generationStatus' | 'generations'>) {
  const stage = pipelineStage(m);
  return (
    stage === 'queued' ||
    stage === 'processing' ||
    stage === 'generating' ||
    Boolean(m.generations?.some((g) => isGenerationActive(g) || isRunStopping(g)))
  );
}

/** Generation runs on a local model and can take many minutes; poll gently while it does. */
export const PIPELINE_POLL_MS = 5000;

/** All materials the user can read (newest first). Shares its cache with the material library. */
export function useMaterials() {
  return useQuery({
    queryKey: ['study-materials'],
    queryFn: () => apiRequest<Paginated<StudyMaterial>>('/study-materials?pageSize=100'),
    refetchInterval: (q) => (q.state.data?.items.some(isPipelineBusy) ? PIPELINE_POLL_MS : false),
  });
}

/** `ready`: text processed (usable by the tutor). `all`: every material, incl. ones still in progress. */
export function useReadyMaterials() {
  const query = useMaterials();
  const all = query.data?.items ?? [];
  return { ...query, all, ready: all.filter((m) => m.status === 'READY') };
}

/** Re-runs the failed stage (processing or generation) and refreshes every material view. */
export function useRetryMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (materialId: string) =>
      apiRequest<StudyMaterial>(`/study-materials/${materialId}/retries`, { method: 'POST' }),
    onSuccess: (material) => {
      void queryClient.invalidateQueries({ queryKey: ['study-materials'] });
      void queryClient.invalidateQueries({ queryKey: ['study-material', material.id] });
    },
  });
}

/** Stops a queued or running flashcard / question run. Items it already made are kept. */
export function useStopGeneration(materialId: string, kind: AssetKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<StudyMaterial>(`/study-materials/${materialId}/generations/${kind}/stop`, { method: 'POST' }),
    onSuccess: (material) => {
      queryClient.setQueryData(['study-material', materialId], material);
      void queryClient.invalidateQueries({ queryKey: ['study-materials'] });
      void queryClient.invalidateQueries({ queryKey: ['study-material', materialId] });
    },
  });
}

/** Mirrors the API rule: the uploader, or an admin (materials:moderate), may retry. */
export function useCanRetryMaterial() {
  const { data: me } = useSessionUser();
  return (m: Pick<StudyMaterial, 'uploadedBy'>) => Boolean(me && (m.uploadedBy.id === me.id || me.role === 'ADMIN'));
}
