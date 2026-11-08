'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiRequest } from '@/lib/api-client';
import type { Paginated, StudyMaterial } from '@/lib/types';

const STATUS_STYLE: Record<StudyMaterial['status'], string> = {
  QUEUED: 'bg-slate-100 text-slate-600',
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
};

export function MaterialLibraryView({
  studyLinkBase,
  canPublish = false,
}: {
  studyLinkBase?: string;
  canPublish?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['study-materials'],
    queryFn: () => apiRequest<Paginated<StudyMaterial>>('/study-materials?pageSize=50'),
    // Poll while anything is still being processed by the workers.
    refetchInterval: (q) =>
      q.state.data?.items.some((m) => m.status === 'QUEUED' || m.status === 'PROCESSING') ? 4000 : false,
  });

  const toggleVisibility = useMutation({
    mutationFn: (m: StudyMaterial) =>
      apiRequest(`/study-materials/${m.id}/visibility`, {
        method: 'PATCH',
        json: { visibility: m.visibility === 'PUBLISHED' ? 'PRIVATE' : 'PUBLISHED' },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['study-materials'] }),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading materials…</p>;
  if (!data?.items.length) return <p className="text-sm text-slate-500">No materials yet.</p>;

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Title</th><th>Type</th><th>Status</th><th>Visibility</th>
            <th>Flashcards</th><th>Questions</th><th />
          </tr>
        </thead>
        <tbody>
          {data.items.map((m) => (
            <tr key={m.id} className="border-t border-slate-100">
              <td className="px-4 py-3 font-medium">
                {studyLinkBase && m.status === 'READY' ? (
                  <Link className="text-indigo-700 hover:underline" href={`${studyLinkBase}/${m.id}`}>{m.title}</Link>
                ) : m.title}
                {m.failureReason && <p className="text-xs text-red-600">{m.failureReason}</p>}
              </td>
              <td>{m.fileType}</td>
              <td><span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[m.status]}`}>{m.status}</span></td>
              <td>{m.visibility}</td>
              <td>{m._count.flashcards}</td>
              <td>{m._count.examQuestions}</td>
              <td className="pr-4 text-right">
                {canPublish && m.status === 'READY' && (
                  <button className="btn-secondary text-xs" onClick={() => toggleVisibility.mutate(m)}>
                    {m.visibility === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
