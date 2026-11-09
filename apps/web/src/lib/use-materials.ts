'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { useSessionUser } from './use-session';
import type { Paginated, StudyMaterial } from './types';

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

/** Still changing on the server, so views showing it should poll. */
export function isPipelineBusy(m: Pick<StudyMaterial, 'status' | 'generationStatus'>) {
  const stage = pipelineStage(m);
  return stage === 'queued' || stage === 'processing' || stage === 'generating';
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

/** Mirrors the API rule: the uploader, or an admin (materials:moderate), may retry. */
export function useCanRetryMaterial() {
  const { data: me } = useSessionUser();
  return (m: Pick<StudyMaterial, 'uploadedBy'>) => Boolean(me && (m.uploadedBy.id === me.id || me.role === 'ADMIN'));
}
