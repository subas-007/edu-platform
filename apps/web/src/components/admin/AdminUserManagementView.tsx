'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { UserRole } from '@/lib/roles';
import type { ManagedUser, Paginated } from '@/lib/types';
import { ErrorText, formatDate, PageHeader } from '../ui';

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

  const [form, setForm] = useState({ email: '', fullName: '', role: 'STUDENT' as UserRole, initialPassword: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const provision = useMutation({
    mutationFn: () =>
      apiRequest('/users', {
        method: 'POST',
        json: { email: form.email, role: form.role, initialPassword: form.initialPassword, ...(form.fullName.trim() ? { fullName: form.fullName } : {}) },
      }),
    onSuccess: () => {
      setForm({ email: '', fullName: '', role: 'STUDENT', initialPassword: '' });
      setFormError(null);
      void invalidate();
    },
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.issues?.map((i) => i.message).join(' ') || err.message : 'Failed'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; role?: UserRole; isActive?: boolean; fullName?: string | null }) =>
      apiRequest(`/users/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: invalidate,
  });

  function handleProvision(event: FormEvent) {
    event.preventDefault();
    provision.mutate();
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        subtitle="Provision accounts, change roles and deprovision access. Changes take effect immediately. The full name is printed on certificates."
      />

      <form onSubmit={handleProvision} className="card grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <h2 className="flex items-center gap-2 font-semibold text-white md:col-span-2 xl:col-span-5">
          <UserPlus className="h-5 w-5 text-aqua-400" aria-hidden /> Provision user
        </h2>
        <input className="input" placeholder="Full name (optional)" maxLength={120} value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <input className="input" type="email" placeholder="E-mail" required value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
        <input className="input" type="password" placeholder="Initial password (12+ chars)" required autoComplete="new-password"
          value={form.initialPassword} onChange={(e) => setForm({ ...form, initialPassword: e.target.value })} />
        <button className="btn-primary" disabled={provision.isPending}>Create</button>
        {formError && <p role="alert" className="text-sm text-red-300 md:col-span-2 xl:col-span-5">{formError}</p>}
      </form>

      <section className="card overflow-hidden p-0">
        <div className="border-b border-ink-700/60 p-4">
          <label className="relative block max-w-sm">
            <span className="sr-only">Search users</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
            <input className="input pl-9" placeholder="Search name or e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>
        <ErrorText error={updateUser.error} />
        <div className="overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {data?.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <input
                      className="w-full max-w-60 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-white hover:border-ink-600 focus:border-aqua-400 focus:outline-none"
                      defaultValue={u.fullName ?? ''}
                      placeholder="Add name…"
                      aria-label={`Full name for ${u.email}`}
                      maxLength={120}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value !== (u.fullName ?? '')) updateUser.mutate({ id: u.id, fullName: value || null });
                      }}
                    />
                    <span className="block px-2 text-xs text-slate-500">{u.email}</span>
                  </td>
                  <td>
                    <select className="rounded-lg border border-ink-600 bg-ink-850 px-2 py-1 text-xs text-slate-200" value={u.role}
                      onChange={(e) => updateUser.mutate({ id: u.id, role: e.target.value as UserRole })}>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>{u.isActive ? <span className="badge-green">Active</span> : <span className="badge-red">Deactivated</span>}</td>
                  <td className="text-slate-400">{formatDate(u.createdAt)}</td>
                  <td className="text-right">
                    <button className={u.isActive ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
                      onClick={() => updateUser.mutate({ id: u.id, isActive: !u.isActive })}>
                      {u.isActive ? 'Deprovision' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
