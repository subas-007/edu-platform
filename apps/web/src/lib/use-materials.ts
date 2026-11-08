'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { Paginated, StudyMaterial } from './types';

/** All materials the user can read. Shares its cache with the material library. */
export function useMaterials() {
  return useQuery({
    queryKey: ['study-materials'],
    queryFn: () => apiRequest<Paginated<StudyMaterial>>('/study-materials?pageSize=100'),
    refetchInterval: (q) =>
      q.state.data?.items.some((m) => m.status === 'QUEUED' || m.status === 'PROCESSING') ? 4000 : false,
  });
}

export function useReadyMaterials() {
  const query = useMaterials();
  return { ...query, ready: (query.data?.items ?? []).filter((m) => m.status === 'READY') };
}
