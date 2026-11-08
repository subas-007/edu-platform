import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';

const NAV = [
  { href: '/examiner', label: 'Performance analytics' },
  { href: '/examiner/question-bank', label: 'Question bank' },
  { href: '/examiner/materials', label: 'Content repository' },
];

export default function ExaminerLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Examiner" navItems={NAV}>{children}</DashboardShell>;
}
