import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import type { NavSection } from '@/components/shell/nav-icons';

const SECTIONS: NavSection[] = [
  {
    heading: 'Administration',
    items: [
      { href: '/admin', label: 'Users', icon: 'users' },
      { href: '/admin/audit-logs', label: 'Audit logs', icon: 'audit' },
      { href: '/admin/branding', label: 'Branding', icon: 'branding' },
    ],
  },
  {
    heading: 'Assessment',
    items: [
      { href: '/admin/question-bank', label: 'Question bank', icon: 'bank' },
      { href: '/admin/programs', label: 'Exam programs', icon: 'papers' },
    ],
  },
  { heading: 'Content', items: [{ href: '/admin/materials', label: 'Asset moderation', icon: 'moderation' }] },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell role="ADMIN" workspaceLabel="Administration" sections={SECTIONS}>
      {children}
    </AppShell>
  );
}
