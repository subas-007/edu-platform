import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  ClipboardCheck,
  Database,
  FileStack,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';

/** Layouts are server components, so nav items reference icons by name. */
export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  materials: BookOpen,
  flashcards: Layers,
  practice: ClipboardCheck,
  programs: GraduationCap,
  tutor: Bot,
  results: Award,
  analytics: BarChart3,
  bank: Database,
  papers: FileStack,
  repository: FolderOpen,
  users: Users,
  moderation: ShieldCheck,
  audit: ScrollText,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}
