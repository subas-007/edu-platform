import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';

const NAV = [
  { href: '/student', label: 'My materials' },
  { href: '/student/tutor', label: 'AI tutor' },
];

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Study hub" navItems={NAV}>{children}</DashboardShell>;
}
