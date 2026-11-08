export type UserRole = 'ADMIN' | 'EXAMINER' | 'STUDENT';

export const ROLE_HOME: Record<UserRole, string> = {
  ADMIN: '/admin',
  EXAMINER: '/examiner',
  STUDENT: '/student',
};

/** Prevents open redirects: only same-origin absolute paths are accepted. */
export function sanitiseNextPath(next: string | null, role: UserRole): string {
  const home = ROLE_HOME[role];
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return home;
  return next.startsWith(home) ? next : home;
}
