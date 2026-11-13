'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Cloud,
  Cpu,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { AssetKind, GenerationEngine, GenerationRequestMode, MaterialGeneration, StudyMaterial } from '@/lib/types';
import { isGenerationActive, isRunStopping } from '@/lib/use-materials';
import { StopGenerationButton } from '../MaterialPipeline';
import { ErrorText, ProgressBar } from '../ui';
import { useAiSettings } from './AiSettingsView';

const KIND = {
  FLASHCARDS: { title: 'Flashcards', noun: 'flashcards', icon: Layers, count: (m: StudyMaterial) => m._count.flashcards },
  QUESTIONS: { title: 'Practice questions', noun: 'questions', icon: ClipboardCheck, count: (m: StudyMaterial) => m._count.examQuestions },
} satisfies Record<AssetKind, unknown>;

/**
 * Student uploads are only stored and indexed. This panel is where the student asks for
 * flashcards or questions — choosing the model for each run — and later for more of them or
 * a fresh set.
 */
export function GenerateAssetsPanel({ material }: { material: StudyMaterial }) {
  return (
    <section className="grid gap-4 md:grid-cols-2" aria-label="Generate study aids">
      <GenerateCard material={material} kind="FLASHCARDS" />
      <GenerateCard material={material} kind="QUESTIONS" />
    </section>
  );
}

function GenerateCard({ material, kind }: { material: StudyMaterial; kind: AssetKind }) {
  const { title, noun, icon: Icon, count } = KIND[kind];
  const existing = count(material);
  const run = material.generations?.find((g) => g.kind === kind);
  const active = run ? isGenerationActive(run) || isRunStopping(run) : false;
  const [choosing, setChoosing] = useState<GenerationRequestMode | null>(null);
  const autoRunning = material.generationStatus === 'PENDING' || material.generationStatus === 'GENERATING';

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-aqua-400" aria-hidden />
        <h2 className="flex-1 font-semibold text-white">{title}</h2>
        <span className="badge-neutral">{existing} {noun}</span>
      </div>

      {run && <RunStatus materialId={material.id} run={run} noun={noun} />}

      {choosing ? (
        <EngineChooser
          materialId={material.id}
          kind={kind}
          mode={choosing}
          existing={existing}
          noun={noun}
          lastEngine={run?.engine}
          onClose={() => setChoosing(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {existing === 0 ? (
            <button className="btn-primary btn-sm" disabled={active || autoRunning} onClick={() => setChoosing('REPLACE')}>
              <Sparkles className="h-4 w-4" aria-hidden /> Generate {noun}
            </button>
          ) : (
            <>
              <button className="btn-primary btn-sm" disabled={active || autoRunning} onClick={() => setChoosing('MORE')}>
                <Plus className="h-4 w-4" aria-hidden /> More {noun}
              </button>
              <button className="btn-secondary btn-sm" disabled={active || autoRunning} onClick={() => setChoosing('REPLACE')}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Regenerate
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RunStatus({ materialId, run, noun }: { materialId: string; run: MaterialGeneration; noun: string }) {
  if (isGenerationActive(run)) {
    const verb = run.mode === 'MORE' ? `Adding ${noun}` : `Generating ${noun}`;
    return (
      <div role="status" className="space-y-2 rounded-xl border border-aqua-500/30 bg-aqua-500/5 p-3">
        <div className="flex items-center gap-2 text-sm text-aqua-100">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-aqua-300" aria-hidden />
          <span className="flex-1">
            {run.status === 'PENDING' ? `Waiting to start (${run.engineLabel})…` : `${verb} with ${run.engineLabel}`}
          </span>
          <span className="text-xs text-aqua-200">{run.progress}%</span>
          <StopGenerationButton materialId={materialId} kind={run.kind} noun={noun} />
        </div>
        <ProgressBar value={Math.max(3, run.progress)} />
        <p className="text-xs text-slate-400">
          New {noun} appear as each part of the document is done
          {run.engine === 'LOCAL' ? '; the local model takes about a minute per part.' : '.'}
        </p>
      </div>
    );
  }
  if (run.status === 'CANCELLED') {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-slate-400">
        {isRunStopping(run) ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Stopping…
          </>
        ) : (
          <>
            <Square className="h-3 w-3 text-slate-400" aria-hidden />
            {run.added
              ? `Stopped. Kept the ${run.added} new ${noun} made before you stopped; nothing was removed.`
              : `Stopped before any new ${noun} were made; nothing was removed.`}
          </>
        )}
      </p>
    );
  }
  if (run.status === 'FAILED') {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
        <span className="text-red-200">{run.error ?? `Generating ${noun} did not finish.`}</span>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-slate-400">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
      {run.added === 0
        ? `No new ${noun}: the model only repeated ones you already have.`
        : `${run.mode === 'MORE' ? 'Added' : 'Generated'} ${run.added ?? ''} ${noun} with ${run.engineLabel}.`}
    </p>
  );
}

/** Asks which model to use for this run: the free local one, or the student's hosted one. */
function EngineChooser({
  materialId,
  kind,
  mode,
  existing,
  noun,
  lastEngine,
  onClose,
}: {
  materialId: string;
  kind: AssetKind;
  mode: GenerationRequestMode;
  existing: number;
  noun: string;
  lastEngine?: GenerationEngine;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useAiSettings();
  const hosted =
    settings?.hostedAvailable && settings.provider && settings.model && settings.keyHint
      ? `${settings.providers.find((p) => p.id === settings.provider)?.label ?? settings.provider} · ${settings.model}`
      : null;
  const [engine, setEngine] = useState<GenerationEngine>('LOCAL');

  // Preselect what the student used last for this kind, else their default in AI model settings.
  useEffect(() => {
    if (!settings) return;
    const preferred = lastEngine ?? settings.mode;
    setEngine(preferred === 'HOSTED' && hosted ? 'HOSTED' : 'LOCAL');
  }, [settings, lastEngine, hosted]);

  const start = useMutation({
    mutationFn: () =>
      apiRequest<StudyMaterial>(`/study-materials/${materialId}/generations`, {
        method: 'POST',
        json: { kind, engine, mode },
      }),
    onSuccess: (material) => {
      queryClient.setQueryData(['study-material', materialId], material);
      void queryClient.invalidateQueries({ queryKey: ['study-materials'] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    start.mutate();
  }

  const action = mode === 'MORE' ? `Add more ${noun}` : existing > 0 ? `Regenerate ${noun}` : `Generate ${noun}`;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-ink-600 bg-ink-850 p-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-white">Which model should write them?</legend>
        <EngineOption
          checked={engine === 'LOCAL'}
          onSelect={() => setEngine('LOCAL')}
          icon={Cpu}
          title={`Local · ${settings?.local.label ?? 'server model'}`}
          note="Free. Runs on this server; a few minutes for a typical document."
        />
        <EngineOption
          checked={engine === 'HOSTED'}
          onSelect={() => setEngine('HOSTED')}
          disabled={!hosted}
          icon={Cloud}
          title={hosted ? `Hosted · ${hosted}` : 'Hosted model'}
          note={
            hosted
              ? 'Faster. Uses your API key; your provider bills you and receives the document text.'
              : settings && !settings.hostedAvailable
                ? 'Not enabled on this server.'
                : undefined
          }
        >
          {!hosted && settings?.hostedAvailable && (
            <Link href="/student/ai-settings" className="text-aqua-300 hover:underline">
              Add your API key under Settings → AI model
            </Link>
          )}
        </EngineOption>
      </fieldset>

      {mode === 'REPLACE' && existing > 0 && (
        <p className="text-xs text-amber-200">
          Your current {existing} {noun} are replaced once the new set is ready
          {kind === 'QUESTIONS' ? ' (questions you have already answered are kept)' : ''}. If you stop it partway, nothing is removed.
        </p>
      )}
      {mode === 'MORE' && (
        <p className="text-xs text-slate-400">New {noun} focus on parts of the document you have the fewest for, and skip ones you already have.</p>
      )}

      <ErrorText error={start.error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary btn-sm" disabled={start.isPending || isLoading}>
          {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {action}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={start.isPending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EngineOption({
  checked,
  onSelect,
  disabled = false,
  icon: Icon,
  title,
  note,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  icon: typeof Cpu;
  title: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition ${
        disabled
          ? 'cursor-not-allowed border-ink-700 opacity-70'
          : checked
            ? 'cursor-pointer border-aqua-500/60 bg-aqua-500/10'
            : 'cursor-pointer border-ink-600 hover:border-aqua-500/40'
      }`}
    >
      <input
        type="radio"
        name="engine"
        className="mt-1 accent-[var(--color-aqua-400)]"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
      />
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-aqua-300" aria-hidden />
      <span className="min-w-0">
        <span className="block font-medium text-white">{title}</span>
        {note && <span className="block text-xs text-slate-400">{note}</span>}
        {children && <span className="block text-xs">{children}</span>}
      </span>
    </label>
  );
}
