'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Recycle } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { StudyMaterial } from '@/lib/types';
import { isPipelineBusy, PIPELINE_POLL_MS, pipelineStage, useCanRetryMaterial } from '@/lib/use-materials';
import { GenerationNotice, MaterialPipelineBadge } from '../MaterialPipeline';
import { EmptyState, PageHeader, Spinner } from '../ui';
import { FlashcardDeck } from './FlashcardDeck';
import { GenerateAssetsPanel } from './GenerateAssetsPanel';
import { StartExamPanel } from './StartExamPanel';
import { StudyRoadmapTracker } from './StudyRoadmapTracker';

export function MaterialStudyView({ materialId }: { materialId: string }) {
  const { data: material, isLoading, error } = useQuery({
    queryKey: ['study-material', materialId],
    queryFn: () => apiRequest<StudyMaterial>(`/study-materials/${materialId}`),
    refetchInterval: (q) => (q.state.data && isPipelineBusy(q.state.data) ? PIPELINE_POLL_MS : false),
  });
  const canRetry = useCanRetryMaterial();
  const queryClient = useQueryClient();
  const flashcardRun = material?.generations?.find((g) => g.kind === 'FLASHCARDS');

  // A finished (or stopped) run may have changed the deck: fetch it once more after the last poll.
  useEffect(() => {
    if (flashcardRun?.status === 'COMPLETED' || flashcardRun?.status === 'CANCELLED') {
      void queryClient.invalidateQueries({ queryKey: ['flashcards', materialId] });
    }
  }, [flashcardRun?.status, flashcardRun?.updatedAt, materialId, queryClient]);

  if (isLoading) return <Spinner />;
  if (error || !material) {
    return (
      <EmptyState icon={ArrowLeft} title={error instanceof ApiError && error.status === 404 ? 'Material not found' : 'Could not load material'}
        action={<Link href="/student/materials" className="btn-secondary">Back to materials</Link>} />
    );
  }

  // The uploader of a student document asks for flashcards / questions with the model they pick.
  const onDemand = material.uploadedBy.role === 'STUDENT' && canRetry(material);

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
      {/* Student uploads are stored only; flashcards and questions are generated here on request. */}
      {!(onDemand && pipelineStage(material) === 'complete') && (
        <GenerationNotice
          material={material}
          what="flashcards, questions and the roadmap"
          canRetry={canRetry(material)}
          hasContent={material._count.flashcards + material._count.examQuestions > 0}
        />
      )}
      {onDemand && pipelineStage(material) === 'complete' && <GenerateAssetsPanel material={material} />}
      {material.status === 'READY' && (
        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
          <div className="space-y-6">
            {(!onDemand || material._count.flashcards > 0 || flashcardRun?.status === 'GENERATING') && (
              <FlashcardDeck materialId={material.id} title={material.title} generating={isPipelineBusy(material)} />
            )}
            {material._count.examQuestions > 0 && (
              <StartExamPanel materialId={material.id} availableQuestions={material._count.examQuestions} />
            )}
          </div>
          <StudyRoadmapTracker
            // refetch once generation finishes (a student's first run also names the sections)
            key={[pipelineStage(material), ...(material.generations ?? []).map((g) => g.status)].join('-')}
            materialId={material.id}
            generating={isPipelineBusy(material)}
          />
        </div>
      )}
    </>
  );
}
