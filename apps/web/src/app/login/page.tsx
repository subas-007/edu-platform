'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { apiRequest, ApiError, refreshSession } from '@/lib/api-client';
import { sanitiseNextPath } from '@/lib/roles';
import type { SessionUser } from '@/lib/types';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const redirectToDashboard = (user: SessionUser) =>
    router.replace(sanitiseNextPath(searchParams.get('next'), user.role));

  // Silent refresh: an expired access token with a valid refresh token skips the form.
  useEffect(() => {
    refreshSession()
      .then(async (ok) => {
        if (ok) redirectToDashboard((await apiRequest<{ user: SessionUser }>('/auth/me')).user);
      })
      .finally(() => setCheckingSession(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { user } = await apiRequest<{ user: SessionUser }>('/auth/sessions', {
        method: 'POST',
        json: { email, password },
      });
      redirectToDashboard(user);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Please wait a minute.'
          : 'Invalid e-mail or password.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) return <p className="text-center text-sm text-slate-500">Checking session…</p>;

  return (
    <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <label className="block space-y-1 text-sm">
        <span>E-mail</span>
        <input className="input" type="email" autoComplete="username" required value={email}
          onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Password</span>
        <input className="input" type="password" autoComplete="current-password" required value={password}
          onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary w-full" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-xs text-slate-500">Accounts are provisioned by your administrator.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
