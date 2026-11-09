'use client';

import { GraduationCap, Loader2, Lock, Mail } from 'lucide-react';
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

  if (checkingSession) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin text-aqua-400" /> Checking session…
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-5 p-7">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
        <p className="text-sm text-slate-400">Sign in to continue to your workspace.</p>
      </div>
      <label className="block">
        <span className="label">E-mail</span>
        <span className="relative block">
          <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input className="input pl-9" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </span>
      </label>
      <label className="block">
        <span className="label">Password</span>
        <span className="relative block">
          <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input className="input pl-9" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button className="btn-primary w-full py-2.5" disabled={submitting}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-center text-xs text-slate-500">Accounts are provisioned by your administrator.</p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="relative hidden overflow-hidden border-r border-ink-700/60 bg-ink-900 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-aqua-500/10 blur-3xl" aria-hidden />
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-aqua-400 to-aqua-600 text-ink-950">
            <GraduationCap className="h-6 w-6" aria-hidden />
          </span>
          <span className="text-lg font-semibold text-white">Edu Platform</span>
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-4xl leading-tight font-semibold text-white">
            Study smarter with <span className="text-aqua-300">AI flashcards</span>, a grounded tutor and real exams.
          </h2>
          <p className="text-slate-400">
            Upload course material once. Get flashcards, practice in learning or exam mode, and earn certificates.
          </p>
        </div>
        <p className="text-xs text-slate-500">Runs on a local AI model: your documents never leave this machine.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
