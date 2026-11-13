import { Prisma } from '@prisma/client';
import { RoadmapMilestone } from './generation.schemas';

const MAX_MILESTONES = 12;
const BASE_READING_WPM = 220;
const TITLE_CHARS = 70;

export interface RoadmapChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

/**
 * The study roadmap without any model call: sections, reading-time estimates (token count ×
 * complexity) and a provisional title taken from each section's opening text. A model may
 * later replace titles and add summaries (`isRoadmapNamed` tells whether that happened).
 */
export function buildRoadmapSkeleton(chunks: RoadmapChunk[], complexity: number) {
  const groups = groupChunks(chunks);
  const effectiveWpm = BASE_READING_WPM * (1 - 0.45 * complexity);
  const milestones: RoadmapMilestone[] = groups.map((group, i) => {
    const words = group.reduce((sum, c) => sum + c.tokenCount * 0.75, 0);
    const readingMinutes = words / effectiveWpm;
    return {
      id: `m${i + 1}`,
      title: provisionalTitle(group[0]?.content ?? '', i),
      summary: '',
      estimatedMinutes: Math.max(5, Math.round(readingMinutes * 1.5 + 5)), // + review/practice
      chunkIndexes: group.map((c) => c.chunkIndex),
    };
  });
  return { milestones, groups };
}

export function roadmapRecord(milestones: RoadmapMilestone[]) {
  const totalMinutes = milestones.reduce((s, m) => s + m.estimatedMinutes, 0);
  return {
    milestones: milestones as unknown as Prisma.InputJsonValue,
    estimatedHours: Math.round((totalMinutes / 60) * 10) / 10,
  };
}

/** The model-facing text: the start of each section, labelled S1, S2, … */
export function roadmapSectionsPrompt(groups: RoadmapChunk[][]) {
  return groups.map((g, i) => `<chunk label="S${i + 1}">\n${g[0].content.slice(0, 600)}\n</chunk>`).join('\n\n');
}

/** A skeleton has no summaries; a model-named roadmap has at least one. */
export function isRoadmapNamed(milestones: unknown): boolean {
  return Array.isArray(milestones) && milestones.some((m) => typeof m?.summary === 'string' && m.summary.length > 0);
}

export function groupChunks<T>(chunks: T[]): T[][] {
  const groupSize = Math.max(1, Math.ceil(chunks.length / MAX_MILESTONES));
  const groups: T[][] = [];
  for (let i = 0; i < chunks.length; i += groupSize) groups.push(chunks.slice(i, i + groupSize));
  return groups;
}

/** First line of the section if it reads like a heading, else its first few words. */
function provisionalTitle(content: string, index: number): string {
  const firstLine = content.split('\n').map((l) => l.trim()).find((l) => l.length >= 3) ?? '';
  const clean = firstLine.replace(/^[#*\-•\d.)\s]+/, '').replace(/\s+/g, ' ').trim();
  if (!clean) return `Section ${index + 1}`;
  if (clean.length <= TITLE_CHARS) return clean;
  const cut = clean.slice(0, TITLE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:.\s]+$/, '')}…`;
}
