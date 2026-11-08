import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import type { NavSection } from '@/components/shell/nav-icons';

const SECTIONS: NavSection[] = [
  { items: [{ href: '/examiner', label: 'Performance analytics', icon: 'analytics' }] },
  {
    heading: 'Assessment',
    items: [
      { href: '/examiner/question-bank', label: 'Question bank', icon: 'bank' },
      { href: '/examiner/programs', label: 'Exam programs', icon: 'papers' },
    ],
  },
  { heading: 'Content', items: [{ href: '/examiner/materials', label: 'Content repository', icon: 'repository' }] },
];

export default function ExaminerLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell role="EXAMINER" workspaceLabel="Examiner workspace" sections={SECTIONS}>
      {children}
    </AppShell>
  );
}
