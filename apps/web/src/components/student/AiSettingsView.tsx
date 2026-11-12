'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cloud, Cpu, ExternalLink, KeyRound, ListRestart, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiRequest } from '@/lib/api-client';
import type { AiSettings, AiSettingsSaved } from '@/lib/types';
import { ErrorText, PageHeader, Spinner } from '../ui';

const QUERY_KEY = ['ai-settings'];

/** One line naming the model that currently answers this student. */
export function describeEngine(settings: AiSettings): string {
  if (settings.mode === 'HOSTED' && settings.provider && settings.model) {
    const provider = settings.providers.find((p) => p.id === settings.provider)?.label ?? settings.provider;
    return `${provider} · ${settings.model}`;
  }
  return `${settings.local.label} · free`;
}

export function useAiSettings() {
  return useQuery({ queryKey: QUERY_KEY, queryFn: () => apiRequest<AiSettings>('/me/ai-settings') });
}

/**
 * Lets a student choose who answers their AI requests: the platform's free local model, or a
 * hosted provider with their own API key. Saving a hosted choice makes one tiny test call
 * first (on the server), so a wrong key or model is reported here, not mid-answer.
 */
export function AiSettingsView() {
  const queryClient = useQueryClient();
  const settingsQuery = useAiSettings();
  const settings = settingsQuery.data;

  const [mode, setMode] = useState<'LOCAL' | 'HOSTED'>('LOCAL');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** What is missing when "Test & save" is pressed too early (the button is never silently disabled). */
  const [formHint, setFormHint] = useState<string | null>(null);

  // Start the form from the saved settings (a first-time choice starts with the first suggestion).
  useEffect(() => {
    if (!settings) return;
    const initialProvider = settings.provider ?? settings.providers[0]?.id ?? '';
    setMode(settings.mode);
    setProvider(initialProvider);
    setModel(
      settings.model ?? settings.providers.find((p) => p.id === initialProvider)?.suggestedModels[0]?.id ?? '',
    );
  }, [settings]);

  /** Picking another provider: its first suggested model, or the one saved for it. */
  function chooseProvider(id: string) {
    if (id === provider) return;
    setProvider(id);
    setFormHint(null);
    const info = settings?.providers.find((p) => p.id === id);
    setModel(settings?.provider === id && settings.model ? settings.model : (info?.suggestedModels[0]?.id ?? ''));
  }

  const providerInfo = settings?.providers.find((p) => p.id === provider);
  const keySavedForProvider = Boolean(settings?.keyHint && settings.provider === provider);
  // A different provider's models and key don't carry over.
  useEffect(() => setAvailableModels([]), [provider]);

  const save = useMutation({
    mutationFn: (body: object) => apiRequest<AiSettingsSaved>('/me/ai-settings', { method: 'PUT', json: body }),
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result.settings);
      setApiKey('');
      setSavedNote(
        result.test
          ? `Connected. ${result.settings.model} replied in ${(result.test.latencyMs / 1000).toFixed(1)} s. The tutor and your next uploads will use it.`
          : 'Saved. The tutor and your next uploads will use the free local model.',
      );
    },
  });

  const removeKey = useMutation({
    mutationFn: () => apiRequest<AiSettings>('/me/ai-settings/key', { method: 'DELETE' }),
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      setApiKey('');
      setSavedNote('Your API key was deleted. The free local model answers from now on.');
    },
  });

  const loadModels = useMutation({
    mutationFn: () =>
      apiRequest<{ models: string[] }>('/me/ai-settings/models', {
        method: 'POST',
        json: { provider, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) },
      }),
    onSuccess: (result) => {
      setAvailableModels(result.models);
      if (!model.trim() && result.models[0]) setModel(result.models[0]);
      setFormHint(null);
    },
  });

  const suggestions = useMemo(() => {
    const suggested = providerInfo?.suggestedModels ?? [];
    const extra = availableModels.filter((id) => !suggested.some((s) => s.id === id));
    return { suggested, extra };
  }, [providerInfo, availableModels]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSavedNote(null);
    setFormHint(null);
    if (mode === 'LOCAL') return save.mutate({ mode: 'LOCAL' });
    if (!apiKey.trim() && !keySavedForProvider) {
      return setFormHint(`Paste your ${providerInfo?.label ?? 'provider'} API key first.`);
    }
    if (!model.trim()) {
      return setFormHint('Choose a model: press "Load models from my account" and pick one, or type the model name.');
    }
    save.mutate({
      mode: 'HOSTED',
      provider,
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    });
  }

  if (settingsQuery.isLoading) return <Spinner />;
  if (!settings) return <ErrorText error={settingsQuery.error} />;

  const unchangedLocal = mode === 'LOCAL' && settings.mode === 'LOCAL';

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="AI model"
        subtitle="Choose which AI answers your tutor questions and writes flashcards and practice questions from the documents you upload."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-300">
        <span className="text-slate-400">Currently answering:</span>
        <span className={settings.mode === 'HOSTED' ? 'badge-violet' : 'badge-aqua'}>
          {settings.mode === 'HOSTED' ? <Cloud className="h-3 w-3" aria-hidden /> : <Cpu className="h-3 w-3" aria-hidden />}
          {describeEngine(settings)}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Model type</legend>
          <ModeOption
            checked={mode === 'LOCAL'}
            onSelect={() => setMode('LOCAL')}
            icon={<Cpu className="h-5 w-5" aria-hidden />}
            title="Local model"
            tag="Free"
          >
            Runs on this platform&apos;s own server ({settings.local.label}). Nothing to pay and your documents never
            leave the server. Answers take about 20–40 seconds.
          </ModeOption>
          <ModeOption
            checked={mode === 'HOSTED'}
            onSelect={() => setMode('HOSTED')}
            disabled={!settings.hostedAvailable}
            icon={<Cloud className="h-5 w-5" aria-hidden />}
            title="Hosted model"
            tag="Your API key"
          >
            {settings.hostedAvailable
              ? 'Use your own account with a provider such as Anthropic or OpenAI. Answers in seconds; the provider bills your account.'
              : 'Not enabled on this server yet. Ask your administrator.'}
          </ModeOption>
        </fieldset>

        {mode === 'HOSTED' && settings.hostedAvailable && (
          <section className="card space-y-5">
            <div>
              <span className="label">Provider</span>
              <div className="flex flex-wrap gap-2">
                {settings.providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={provider === p.id}
                    onClick={() => chooseProvider(p.id)}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${
                      provider === p.id
                        ? 'border-aqua-400 bg-aqua-500/10 text-white'
                        : 'border-ink-600 bg-ink-850 text-slate-300 hover:border-ink-500'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="ai-key">
                API key
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                  <input
                    id="ai-key"
                    className="input pl-9 font-mono"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={keySavedForProvider ? `Saved key ${settings.keyHint} (leave blank to keep it)` : 'Paste your API key'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    // With a key and no model yet, fetch the models this key can use.
                    onBlur={() => {
                      if (apiKey.trim().length >= 10 && !model.trim() && !loadModels.isPending) loadModels.mutate();
                    }}
                  />
                </div>
                {providerInfo && (
                  <a className="btn-secondary shrink-0" href={providerInfo.keysUrl} target="_blank" rel="noopener noreferrer">
                    Get a key <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Your key is encrypted before it is stored and is never shown again or shared with other users. Only you
                can use it, for your own tutor answers and uploads.
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="label mb-0" htmlFor="ai-model">
                  Model
                </label>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={loadModels.isPending || (!apiKey.trim() && !keySavedForProvider)}
                  onClick={() => loadModels.mutate()}
                >
                  {loadModels.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListRestart className="h-3.5 w-3.5" />}
                  Load models from my account
                </button>
              </div>
              <input
                id="ai-model"
                className="input font-mono"
                list="ai-model-options"
                placeholder="e.g. a model id from your provider"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
              <datalist id="ai-model-options">
                {[...suggestions.suggested.map((s) => s.id), ...suggestions.extra].map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              {suggestions.suggested.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {suggestions.suggested.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setModel(s.id)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        model === s.id ? 'border-aqua-400 text-white' : 'border-ink-600 text-slate-300 hover:border-ink-500'
                      }`}
                    >
                      <span className="font-mono">{s.id}</span> <span className="text-slate-500">· {s.note}</span>
                    </button>
                  ))}
                </div>
              )}
              {loadModels.isSuccess && (
                <p className="mt-1.5 text-xs text-slate-500">{loadModels.data.models.length} models available on your account.</p>
              )}
              <ErrorText error={loadModels.error} />
            </div>

            <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
              With a hosted model, the passages of your documents that answer each question are sent to {providerInfo?.label ?? 'the provider'}{' '}
              and handled under its terms. Usage is charged to your account.
            </p>

            {keySavedForProvider && settings.mode === 'HOSTED' && (
              <p className="flex items-center gap-1.5 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved: {providerInfo?.label} key {settings.keyHint},
                model <span className="font-mono">{settings.model}</span>
              </p>
            )}
            {settings.keyHint && (
              <button
                type="button"
                className="btn-danger btn-sm"
                disabled={removeKey.isPending}
                onClick={() => removeKey.mutate()}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete my saved key ({settings.keyHint})
              </button>
            )}
            <ErrorText error={removeKey.error} />
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={save.isPending || unchangedLocal}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === 'HOSTED' ? (save.isPending ? 'Testing connection…' : 'Test & save') : 'Use the local model'}
          </button>
          {savedNote && (
            <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> {savedNote}
            </p>
          )}
        </div>
        {formHint && (
          <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            {formHint}
          </p>
        )}
        <ErrorText error={save.error} />
      </form>
    </>
  );
}

function ModeOption({
  checked,
  onSelect,
  disabled,
  icon,
  title,
  tag,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`card flex cursor-pointer gap-3 transition ${
        checked ? 'border-aqua-400/70 bg-aqua-500/5' : 'hover:border-ink-500'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input type="radio" name="ai-mode" className="sr-only" checked={checked} disabled={disabled} onChange={onSelect} />
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${checked ? 'bg-aqua-500/15 text-aqua-300' : 'bg-ink-800 text-slate-400'}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 font-semibold text-white">
          {title} <span className="badge-neutral">{tag}</span>
        </span>
        <span className="mt-1 block text-sm text-slate-400">{children}</span>
      </span>
    </label>
  );
}
