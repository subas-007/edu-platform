'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, Recycle } from 'lucide-react';
import Link from 'next/link';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { StudyMaterial } from '@/lib/types';
import { isPipelineBusy, PIPELINE_POLL_MS, pipelineStage, useCanRetryMaterial } from '@/lib/use-materials';
import { GenerationNotice, MaterialPipelineBadge } from '../MaterialPipeline';
import { EmptyState, PageHeader, Spinner } from '../ui';
import { FlashcardDeck } from './FlashcardDeck';
import { StartExamPanel } from './StartExamPanel';
import { StudyRoadmapTracker } from './StudyRoadmapTracker';

export function MaterialStudyView({ materialId }: { materialId: string }) {
  const { data: material, isLoading, error } = useQuery({
    queryKey: ['study-material', materialId],
    queryFn: () => apiRequest<StudyMaterial>(`/study-materials/${materialId}`),
    refetchInterval: (q) => (q.state.data && isPipelineBusy(q.state.data) ? PIPELINE_POLL_MS : false),
  });
  const canRetry = useCanRetryMaterial();

  if (isLoading) return <Spinner />;
  if (error || !material) {
    return (
      <EmptyState icon={ArrowLeft} title={error instanceof ApiError && error.status === 404 ? 'Material not found' : 'Could not load material'}
        action={<Link href="/student/materials" className="btn-secondary">Back to materials</Link>} />
    );
  }

  return (
    <>
      <Link href="/student/materials" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> My materials
      </Link>
      <PageHeader
        title={material.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <MaterialPipelineBadge material={material} />
            <span className="badge-neutral">{material.fileType}</span>
            {material.reusedFromId && (
              <span className="badge-aqua"><Recycle className="h-3 w-3" /> Reused existing analysis</span>
            )}
          </span>
        }
        actions={
          <Link href={`/student/tutor?materialIds=${material.id}`} className="btn-secondary">
            <Bot className="h-4 w-4" /> Ask the tutor
          </Link>
        }
      />
      <GenerationNotice
        material={material}
        what="flashcards, questions and the roadmap"
        canRetry={canRetry(material)}
        hasContent={material._count.flashcards + material._count.examQuestions > 0}
      />
      {material.status === 'READY' && (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            <FlashcardDeck materialId={material.id} title={material.title} generating={isPipelineBusy(material)} />
            {material._count.examQuestions > 0 && (
              <StartExamPanel materialId={material.id} availableQuestions={material._count.examQuestions} />
            )}
          </div>
          <StudyRoadmapTracker
            key={pipelineStage(material)} // refetch once generation finishes
            materialId={material.id}
            generating={isPipelineBusy(material)}
          />
        </div>
      )}
    </>
  );
}
