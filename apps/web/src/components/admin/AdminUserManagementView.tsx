'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { UserRole } from '@/lib/roles';
import type { ManagedUser, Paginated } from '@/lib/types';

const ROLES: UserRole[] = ['STUDENT', 'EXAMINER', 'ADMIN'];

export function AdminUserManagementView() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data } = useQuery({
    queryKey: ['users', search],
    queryFn: () =>
      apiRequest<Paginated<ManagedUser>>(`/users?pageSize=100${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const [form, setForm] = useState({ email: '', role: 'STUDENT' as UserRole, initialPassword: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const provision = useMutation({
    mutationFn: () => apiRequest('/users', { method: 'POST', json: form }),
    onSuccess: () => {
      setForm({ email: '', role: 'STUDENT', initialPassword: '' });
      setFormError(null);
      void invalidate();
    },
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.issues?.map((i) => i.message).join(' ') || err.message : 'Failed'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; role?: UserRole; isActive?: boolean }) =>
      apiRequest(`/users/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: invalidate,
    onError: (err) => alert(err instanceof ApiError ? err.message : 'Update failed'),
  });

  function handleProvision(event: FormEvent) {
    event.preventDefault();
    provision.mutate();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleProvision} className="card grid gap-3 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">Provision user</h2>
        <input className="input" type="email" placeholder="E-mail" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input className="input" type="password" placeholder="Initial password (12+ chars)" required autoComplete="new-password"
          value={form.initialPassword} onChange={(e) => setForm({ ...form, initialPassword: e.target.value })} />
        <button className="btn-primary" disabled={provision.isPending}>Create</button>
        {formError && <p role="alert" className="text-sm text-red-600 md:col-span-4">{formError}</p>}
      </form>

      <div className="card overflow-x-auto p-0">
        <div className="p-4">
          <input className="input max-w-xs" placeholder="Search e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-3">E-mail</th><th>Role</th><th>Status</th><th>Created</th><th /></tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{u.email}</td>
                <td>
                  <select className="rounded border border-slate-200 px-2 py-1 text-xs" value={u.role}
                    onChange={(e) => updateUser.mutate({ id: u.id, role: e.target.value as UserRole })}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td>{u.isActive ? 'Active' : <span className="text-red-600">Deactivated</span>}</td>
                <td className="text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="pr-4 text-right">
                  <button className="btn-secondary text-xs"
                    onClick={() => updateUser.mutate({ id: u.id, isActive: !u.isActive })}>
                    {u.isActive ? 'Deprovision' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
