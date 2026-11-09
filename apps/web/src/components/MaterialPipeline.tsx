'use client';

import { AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import type { StudyMaterial } from '@/lib/types';
import { pipelineStage, useRetryMaterial } from '@/lib/use-materials';
import { ProgressBar } from './ui';

type PipelineMaterial = Pick<
  StudyMaterial,
  'id' | 'status' | 'generationStatus' | 'generationProgress' | 'generationError' | 'failureReason' | 'uploadedBy'
>;

/** One badge for the whole pipeline: Queued → Processing → Generating n% → Ready / Failed. */
export function MaterialPipelineBadge({ material }: { material: PipelineMaterial }) {
  switch (pipelineStage(material)) {
    case 'queued':
      return <span className="badge-neutral"><Clock className="h-3 w-3" aria-hidden /> Queued</span>;
    case 'processing':
      return <span className="badge-amber"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Reading document</span>;
    case 'generating':
      return (
        <span className="badge-aqua">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Generating {material.generationProgress}%
        </span>
      );
    case 'complete':
      return <span className="badge-green"><CheckCircle2 className="h-3 w-3" aria-hidden /> Ready</span>;
    case 'generation-failed':
      return <span className="badge-red"><AlertTriangle className="h-3 w-3" aria-hidden /> Generation failed</span>;
    case 'failed':
      return <span className="badge-red"><AlertTriangle className="h-3 w-3" aria-hidden /> Failed</span>;
  }
}

/** Short text for compact lists (material pickers). */
export function pipelineLabel(material: PipelineMaterial): string {
  switch (pipelineStage(material)) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Reading…';
    case 'generating':
      return `${material.generationProgress}%`;
    case 'generation-failed':
    case 'failed':
      return 'Failed';
    case 'complete':
      return '';
  }
}

export function RetryMaterialButton({ materialId, className = 'btn-secondary btn-sm' }: { materialId: string; className?: string }) {
  const retry = useRetryMaterial();
  return (
    <span className="inline-flex flex-col gap-1">
      <button className={className} onClick={() => retry.mutate(materialId)} disabled={retry.isPending}>
        {retry.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
        Retry
      </button>
      {retry.error && (
        <span role="alert" className="text-xs text-red-300">
          {retry.error instanceof ApiError ? retry.error.message : 'Could not retry'}
        </span>
      )}
    </span>
  );
}

/**
 * Explains why a material has no flashcards / questions / roadmap yet, with live progress
 * while the local model works and a Retry button when something failed.
 * `canRetry`: only the uploader (or a moderator) can re-run the pipeline.
 */
export function GenerationNotice({
  material,
  what,
  canRetry,
  hasContent = false,
}: {
  material: PipelineMaterial;
  /** e.g. "flashcards", "practice questions" */
  what: string;
  canRetry: boolean;
  /** Some items already exist (generation saves batch by batch). */
  hasContent?: boolean;
}) {
  const stage = pipelineStage(material);

  if (stage === 'failed' || stage === 'generation-failed') {
    const reason =
      stage === 'failed'
        ? material.failureReason ?? 'The document could not be processed.'
        : material.generationError ?? 'Generation did not finish.';
    return (
      <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-red-200">
            {stage === 'failed' ? 'This document could not be processed' : `Generating ${what} failed`}
          </p>
          <p className="mt-0.5 text-red-200/80">{reason}</p>
          {!canRetry && <p className="mt-1 text-xs text-slate-400">Ask the person who uploaded it to retry.</p>}
        </div>
        {canRetry && <RetryMaterialButton materialId={material.id} />}
      </div>
    );
  }

  if (stage === 'complete') {
    if (hasContent) return null;
    return (
      <div role="status" className="rounded-xl border border-ink-600 bg-ink-800/60 p-4 text-sm text-slate-300">
        No {what} are available for this document
        {material.uploadedBy.role !== 'STUDENT' ? ' yet — they appear once an examiner approves them.' : '.'}
      </div>
    );
  }

  const label =
    stage === 'queued'
      ? 'Waiting for the worker to pick up this document…'
      : stage === 'processing'
        ? 'Reading and indexing the document…'
        : hasContent
          ? `More ${what} are on the way — new ones appear here automatically.`
          : `The local AI model is writing ${what}. The first ones usually appear within a few minutes.`;
  return (
    <div role="status" className="space-y-2 rounded-xl border border-aqua-500/30 bg-aqua-500/5 p-4">
      <div className="flex items-center gap-2 text-sm text-aqua-100">
        <Sparkles className="h-4 w-4 shrink-0 text-aqua-300" aria-hidden />
        <span className="flex-1">{label}</span>
        {stage === 'generating' && <span className="text-xs text-aqua-200">{material.generationProgress}%</span>}
      </div>
      {stage === 'generating' && <ProgressBar value={Math.max(3, material.generationProgress)} />}
    </div>
  );
}
