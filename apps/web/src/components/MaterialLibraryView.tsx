'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Eye, EyeOff, FileText, Globe, Image as ImageIcon, Recycle, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Paginated, StudyMaterial } from '@/lib/types';
import { useSessionUser } from '@/lib/use-session';
import { EmptyState, ErrorText, formatDate, MaterialStatusBadge, Spinner } from './ui';

const TYPE_ICON = { URL: Globe, PDF: FileText, DOCX: FileText, PNG: ImageIcon, JPEG: ImageIcon } as const;

export function MaterialLibraryView({
  studyLinkBase,
  canPublish = false,
  canDelete = false,
  bankLinkBase,
}: {
  studyLinkBase?: string;
  canPublish?: boolean;
  /** 'own' = only materials the user uploaded; 'any' = moderators. */
  canDelete?: false | 'own' | 'any';
  /** Staff: link a material's question count to the question bank filtered by it. */
  bankLinkBase?: string;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useSessionUser();
  const [filter, setFilter] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['study-materials'],
    queryFn: () => apiRequest<Paginated<StudyMaterial>>('/study-materials?pageSize=100'),
    // Poll while anything is still being processed by the workers.
    refetchInterval: (q) =>
      q.state.data?.items.some((m) => m.status === 'QUEUED' || m.status === 'PROCESSING') ? 4000 : false,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['study-materials'] });

  const toggleVisibility = useMutation({
    mutationFn: (m: StudyMaterial) =>
      apiRequest(`/study-materials/${m.id}/visibility`, {
        method: 'PATCH',
        json: { visibility: m.visibility === 'PUBLISHED' ? 'PRIVATE' : 'PUBLISHED' },
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (m: StudyMaterial) => apiRequest(`/study-materials/${m.id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  if (isLoading) return <Spinner label="Loading materials…" />;
  if (!data?.items.length) {
    return (
      <EmptyState icon={BookOpen} title="No materials yet">
        Upload a PDF, Word document, image or web page to generate flashcards, practice questions and a study roadmap.
      </EmptyState>
    );
  }

  const items = data.items.filter((m) => m.title.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section className="card overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-ink-700/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold text-white">
          Library <span className="ml-1 text-sm font-normal text-slate-500">{data.total}</span>
        </h2>
        <input className="input sm:max-w-xs" placeholder="Filter by title…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <ErrorText error={toggleVisibility.error ?? remove.error} />
      <div className="overflow-x-auto">
        <table className="table min-w-[640px]">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th className="hidden md:table-cell">Visibility</th>
              <th className="text-right">Flashcards</th>
              <th className="text-right">Questions</th>
              <th className="hidden lg:table-cell">Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => {
              const Icon = TYPE_ICON[m.fileType];
              const ready = m.status === 'READY';
              return (
                <tr key={m.id}>
                  <td className="max-w-xs">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-aqua-300">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        {studyLinkBase && ready ? (
                          <Link className="block truncate font-medium text-white hover:text-aqua-300" href={`${studyLinkBase}/${m.id}`}>
                            {m.title}
                          </Link>
                        ) : (
                          <span className="block truncate font-medium text-white">{m.title}</span>
                        )}
                        <span className="flex items-center gap-2 text-xs text-slate-500">
                          {m.fileType}
                          {m.reusedFromId && (
                            <span className="inline-flex items-center gap-1 text-aqua-400" title="Identical to an existing document: its AI assets were reused">
                              <Recycle className="h-3 w-3" aria-hidden /> reused
                            </span>
                          )}
                        </span>
                        {m.failureReason && <p className="text-xs text-red-300">{m.failureReason}</p>}
                      </div>
                    </div>
                  </td>
                  <td><MaterialStatusBadge status={m.status} /></td>
                  <td className="hidden md:table-cell">
                    <span className={m.visibility === 'PUBLISHED' ? 'badge-aqua' : 'badge-neutral'}>
                      {m.visibility === 'PUBLISHED' ? 'Published' : 'Private'}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{m._count.flashcards}</td>
                  <td className="text-right tabular-nums">
                    {bankLinkBase && m._count.examQuestions > 0 ? (
                      <Link className="text-aqua-300 hover:underline" href={`${bankLinkBase}?materialId=${m.id}`}>
                        {m._count.examQuestions}
                      </Link>
                    ) : (
                      m._count.examQuestions
                    )}
                  </td>
                  <td className="hidden text-slate-400 lg:table-cell">{formatDate(m.createdAt)}</td>
                  <td>
                    <div className="flex justify-end gap-2">
                      {canPublish && ready && (
                        <button className="btn-secondary btn-sm" onClick={() => toggleVisibility.mutate(m)} disabled={toggleVisibility.isPending}>
                          {m.visibility === 'PUBLISHED' ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          {m.visibility === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                        </button>
                      )}
                      {(canDelete === 'any' || (canDelete === 'own' && m.uploadedBy.id === me?.id)) && (
                        <button
                          className="btn-ghost btn-sm text-slate-400 hover:text-red-300"
                          aria-label={`Delete ${m.title}`}
                          disabled={remove.isPending}
                          onClick={() => {
                            if (confirm(`Delete “${m.title}” and everything generated from it?`)) remove.mutate(m);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
