'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import type { SessionUser } from './types';

/** Current user's profile (name, e-mail, role) for the shell and personalised pages. */
export function useSessionUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await apiRequest<{ user: SessionUser }>('/auth/me')).user,
    staleTime: 5 * 60_000,
  });
}

export function displayName(user: SessionUser | undefined) {
  if (!user) return '';
  return user.fullName?.trim() || user.email.split('@')[0];
}

export function initials(user: SessionUser | undefined) {
  const name = displayName(user);
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
