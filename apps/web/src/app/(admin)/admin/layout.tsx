import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';

const NAV = [
  { href: '/admin', label: 'Users' },
  { href: '/admin/materials', label: 'Asset moderation' },
  { href: '/admin/audit-logs', label: 'Audit logs' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Administration" navItems={NAV}>{children}</DashboardShell>;
}
