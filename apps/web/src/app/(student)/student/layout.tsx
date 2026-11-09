import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import type { NavSection } from '@/components/shell/nav-icons';

const SECTIONS: NavSection[] = [
  { items: [{ href: '/student', label: 'Dashboard', icon: 'dashboard' }] },
  {
    heading: 'Learn',
    items: [
      { href: '/student/materials', label: 'My materials', icon: 'materials' },
      { href: '/student/flashcards', label: 'Flashcards', icon: 'flashcards' },
      { href: '/student/tutor', label: 'AI tutor', icon: 'tutor' },
    ],
  },
  {
    heading: 'Assess',
    items: [
      { href: '/student/practice', label: 'Learning & exam mode', icon: 'practice' },
      { href: '/student/programs', label: 'Exam programs', icon: 'programs' },
      { href: '/student/history', label: 'Results & certificates', icon: 'results' },
    ],
  },
];

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell role="STUDENT" workspaceLabel="Student workspace" sections={SECTIONS}>
      {children}
    </AppShell>
  );
}
