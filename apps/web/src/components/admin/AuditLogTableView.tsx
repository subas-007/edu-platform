'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Paginated } from '@/lib/types';
import { PageHeader, Spinner } from '../ui';

interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { email: string; role: string } | null;
}

export function AuditLogTableView() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, action],
    queryFn: () =>
      apiRequest<Paginated<AuditLogEntry>>(
        `/audit-logs?page=${page}&pageSize=50${action ? `&action=${encodeURIComponent(action)}` : ''}`,
      ),
  });
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit logs" subtitle="Authentication events, provisioning, publishing, deletion, curation and exam program changes." />
      <section className="card overflow-hidden p-0">
        <div className="border-b border-ink-700/60 p-4">
          <label className="relative block max-w-sm">
            <span className="sr-only">Filter by action</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
            <input className="input pl-9" placeholder="Filter by action prefix (e.g. auth.)" value={action}
              onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          </label>
        </div>
        {isLoading ? (
          <div className="p-4"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead>
                <tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>IP</th></tr>
              </thead>
              <tbody>
                {data?.items.map((log) => (
                  <tr key={log.id} className="align-top">
                    <td className="whitespace-nowrap text-slate-400">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="text-slate-200">{log.actor?.email ?? 'system / unknown'}</td>
                    <td><code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-aqua-300">{log.action}</code></td>
                    <td className="text-xs text-slate-400">{log.resourceType}{log.resourceId ? ` · ${log.resourceId.slice(0, 8)}` : ''}</td>
                    <td className="text-xs text-slate-500">{log.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-ink-700/60 p-4 text-sm text-slate-400">
          <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /> Prev</button>
          <span>Page {page} / {lastPage}</span>
          <button className="btn-secondary btn-sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Next <ChevronRight className="h-4 w-4" /></button>
        </div>
      </section>
    </>
  );
}
