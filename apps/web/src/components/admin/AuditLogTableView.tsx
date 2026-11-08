'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { Paginated } from '@/lib/types';

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
  const { data } = useQuery({
    queryKey: ['audit-logs', page, action],
    queryFn: () =>
      apiRequest<Paginated<AuditLogEntry>>(
        `/audit-logs?page=${page}&pageSize=50${action ? `&action=${encodeURIComponent(action)}` : ''}`,
      ),
  });
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="card space-y-4 overflow-x-auto">
      <input className="input max-w-xs" placeholder="Filter by action prefix (e.g. auth.)" value={action}
        onChange={(e) => { setAction(e.target.value); setPage(1); }} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr><th className="py-2">Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>IP</th></tr>
        </thead>
        <tbody>
          {data?.items.map((log) => (
            <tr key={log.id} className="border-t border-slate-100 align-top">
              <td className="py-2 whitespace-nowrap text-slate-500">{new Date(log.createdAt).toLocaleString()}</td>
              <td>{log.actor?.email ?? 'system / unknown'}</td>
              <td className="font-mono text-xs">{log.action}</td>
              <td className="text-xs">{log.resourceType}{log.resourceId ? ` · ${log.resourceId.slice(0, 8)}` : ''}</td>
              <td className="text-xs text-slate-500">{log.ipAddress ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 text-sm">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <span>Page {page} / {lastPage}</span>
        <button className="btn-secondary" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>
  );
}
