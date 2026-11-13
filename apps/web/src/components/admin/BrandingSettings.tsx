'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ImageUp, Loader2, Palette as PaletteIcon, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useId, useState, type CSSProperties, type ChangeEvent, type FormEvent } from 'react';
import { apiRequest } from '@/lib/api-client';
import { themeVariables, type Branding, type BrandingOptions, type Palette, type SurfaceTheme } from '@/lib/branding';
import { useBranding, useSetBranding } from '../BrandingProvider';
import { BrandMark } from '../shell/BrandMark';
import { ErrorText, PageHeader, ProgressBar, Spinner } from '../ui';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Admin → Branding: the site's name, logo and colour theme. Colour choices are previewed in a
 * panel before saving (the API computes readable shade scales from them); saving re-themes this
 * page at once and every other page on its next load. The logo is saved as soon as it is chosen.
 */
export function BrandingSettings() {
  const branding = useBranding();
  const setBranding = useSetBranding();
  const options = useQuery({
    queryKey: ['branding-options'],
    queryFn: () => apiRequest<BrandingOptions>('/branding/options'),
    staleTime: Infinity,
  });

  const [appName, setAppName] = useState(branding.appName);
  const [accent, setAccent] = useState(branding.accentColor);
  const [surface, setSurface] = useState<SurfaceTheme>(branding.surface);
  const [saved, setSaved] = useState(false);

  const accentValid = HEX.test(accent);
  const [previewKey, setPreviewKey] = useState({ accent: branding.accentColor, surface: branding.surface });
  useEffect(() => {
    if (!accentValid) return;
    const timer = setTimeout(() => setPreviewKey({ accent: accent.toLowerCase(), surface }), 200);
    return () => clearTimeout(timer);
  }, [accent, accentValid, surface]);
  const preview = useQuery({
    queryKey: ['branding-palette', previewKey.accent, previewKey.surface],
    queryFn: () =>
      apiRequest<Palette>(
        `/branding/palette?accent=${encodeURIComponent(previewKey.accent)}&surface=${previewKey.surface}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

  const name = appName.trim();
  const dirty = name !== branding.appName || accent.toLowerCase() !== branding.accentColor || surface !== branding.surface;

  const save = useMutation({
    mutationFn: () =>
      apiRequest<Branding>('/branding', {
        method: 'PUT',
        json: { appName: name, accentColor: accent.toLowerCase(), surface },
      }),
    onSuccess: (next) => {
      setBranding(next);
      setAppName(next.appName);
      setAccent(next.accentColor);
      setSurface(next.surface);
      setSaved(true);
    },
  });

  useEffect(() => setSaved(false), [appName, accent, surface]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name && accentValid) save.mutate();
  }

  function resetToDefaults() {
    if (!options.data) return;
    setAppName(options.data.defaults.appName);
    setAccent(options.data.defaults.accentColor);
    setSurface(options.data.defaults.surface);
  }

  if (options.isLoading) return <Spinner />;
  const palette = preview.data;
  const adjusted = palette && accentValid && palette.accent['400'] !== accent.toLowerCase() ? palette.accent['400'] : null;

  return (
    <>
      <PageHeader
        title="Branding"
        subtitle="The name, logo and colours everyone sees: on every page, the sign-in page, and on certificates and other PDFs."
      />
      <ErrorText error={options.error} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <LogoCard maxBytes={options.data?.maxLogoBytes ?? 512 * 1024} />

          <form onSubmit={submit} className="card space-y-6" aria-label="Name and colours">
            <label className="block">
              <span className="label">Application name</span>
              <input
                className="input"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                maxLength={40}
                required
                aria-describedby="app-name-hint"
              />
              <span id="app-name-hint" className="mt-1 block text-xs text-slate-500">
                Shown in the sidebar, the browser tab, the sign-in page and on PDFs. {name.length}/40
              </span>
            </label>

            <AccentPicker presets={options.data?.accentPresets ?? []} value={accent} onChange={setAccent} adjusted={adjusted} />

            <SurfacePicker surfaces={options.data?.surfaces ?? []} value={surface} onChange={setSurface} />

            <ErrorText error={save.error} />
            {saved && !dirty && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Saved. Everyone sees the new look on their next page load.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary" disabled={!dirty || !name || !accentValid || save.isPending}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save changes
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setAppName(branding.appName);
                  setAccent(branding.accentColor);
                  setSurface(branding.surface);
                }}
              >
                Discard
              </button>
              <button type="button" className="btn-ghost" onClick={resetToDefaults} disabled={save.isPending}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Use default look
              </button>
            </div>
          </form>
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start" aria-label="Preview">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">
            <PaletteIcon className="h-3.5 w-3.5" aria-hidden /> Preview {dirty && '(not saved yet)'}
          </p>
          {palette ? <ThemePreview palette={palette} appName={name || branding.appName} /> : <Spinner label="Preparing preview…" />}
        </aside>
      </div>
    </>
  );
}

function LogoCard({ maxBytes }: { maxBytes: number }) {
  const branding = useBranding();
  const setBranding = useSetBranding();
  const inputId = useId();
  const [localError, setLocalError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiRequest<Branding>('/branding/logo', { method: 'PUT', body: form });
    },
    onSuccess: setBranding,
  });
  const remove = useMutation({
    mutationFn: () => apiRequest<Branding>('/branding/logo', { method: 'DELETE' }),
    onSuccess: setBranding,
  });

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // choosing the same file again still triggers a change
    if (!file) return;
    setLocalError(null);
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setLocalError('Choose a PNG or JPEG image.');
    if (file.size > maxBytes) return setLocalError(`The image is ${Math.ceil(file.size / 1024)} KB; the limit is ${maxBytes / 1024} KB.`);
    upload.mutate(file);
  }

  const busy = upload.isPending || remove.isPending;
  return (
    <section className="card space-y-4" aria-labelledby="logo-heading">
      <div>
        <h2 id="logo-heading" className="font-semibold text-white">Logo</h2>
        <p className="text-sm text-slate-400">
          PNG or JPEG, up to {maxBytes / 1024} KB. A square image with a transparent background works best. It is saved
          as soon as you choose it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-20 w-20 items-center justify-center rounded-2xl border border-ink-700 bg-ink-850">
          {branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- same-origin preview of the current logo
            <img src={branding.logoUrl} alt="Current logo" className="h-16 w-16 object-contain" />
          ) : (
            <BrandMark size="lg" />
          )}
        </span>
        <div className="flex flex-wrap gap-2">
          {/* A label styled as a button keeps the native file input (keyboard, screen readers). */}
          <label htmlFor={inputId} className={`btn-secondary cursor-pointer has-[:focus-visible]:outline-2 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImageUp className="h-4 w-4" aria-hidden />}
            {branding.logoUrl ? 'Replace logo' : 'Upload logo'}
            <input id={inputId} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={choose} disabled={busy} />
          </label>
          {branding.logoUrl && (
            <button type="button" className="btn-ghost" onClick={() => remove.mutate()} disabled={busy}>
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              Remove
            </button>
          )}
        </div>
      </div>
      {!branding.logoUrl && <p className="text-xs text-slate-500">Without a logo, the default mark is shown in your accent colour.</p>}
      {localError && <p role="alert" className="text-sm text-red-300">{localError}</p>}
      <ErrorText error={upload.error ?? remove.error} />
    </section>
  );
}

function AccentPicker({
  presets,
  value,
  onChange,
  adjusted,
}: {
  presets: BrandingOptions['accentPresets'];
  value: string;
  onChange: (v: string) => void;
  adjusted: string | null;
}) {
  const lower = value.toLowerCase();
  const isPreset = presets.some((p) => p.color === lower);
  return (
    <fieldset className="space-y-3">
      <legend className="label">Accent colour</legend>
      <p className="-mt-1 text-xs text-slate-500">Buttons, links, highlights and progress bars.</p>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <label
            key={p.color}
            title={p.label}
            className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition has-[:checked]:border-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white"
          >
            <input type="radio" name="accent" value={p.color} checked={lower === p.color} onChange={() => onChange(p.color)} className="sr-only" />
            <span className="h-6 w-6 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="sr-only">{p.label}</span>
          </label>
        ))}
        <span className="mx-1 h-6 w-px bg-ink-700" aria-hidden />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="color"
            value={HEX.test(value) ? lower : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className={`h-9 w-11 cursor-pointer rounded-lg border-2 bg-transparent p-0.5 ${!isPreset ? 'border-white' : 'border-ink-600'}`}
            aria-label="Custom colour"
          />
        </label>
        <input
          className="input w-28 font-mono text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={7}
          spellCheck={false}
          aria-label="Accent colour as hex"
          aria-invalid={!HEX.test(value)}
          aria-describedby="accent-hint"
        />
      </div>
      <p id="accent-hint" className="text-xs text-slate-500" aria-live="polite">
        {!HEX.test(value)
          ? 'Use a colour like #3ee2d2.'
          : adjusted
            ? `Shown as ${adjusted}: lightened so text on it and next to it stays readable.`
            : 'Used exactly as chosen.'}
      </p>
    </fieldset>
  );
}

function SurfacePicker({
  surfaces,
  value,
  onChange,
}: {
  surfaces: BrandingOptions['surfaces'];
  value: SurfaceTheme;
  onChange: (v: SurfaceTheme) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="label">Background</legend>
      <p className="-mt-1 text-xs text-slate-500">The tone of pages, panels and the sidebar.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {surfaces.map((s) => (
          <label
            key={s.id}
            className="cursor-pointer rounded-xl border border-ink-600 p-2 transition hover:border-aqua-500/40 has-[:checked]:border-aqua-400 has-[:checked]:bg-aqua-500/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-aqua-400"
          >
            <input type="radio" name="surface" value={s.id} checked={value === s.id} onChange={() => onChange(s.id)} className="sr-only" />
            <span className="flex h-8 overflow-hidden rounded-lg" aria-hidden>
              {(['950', '800', '600'] as const).map((shade) => (
                <span key={shade} className="flex-1" style={{ backgroundColor: s.swatch[shade] }} />
              ))}
            </span>
            <span className="mt-1.5 block text-sm text-slate-200">{s.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A small mock of the app, themed by `palette` through scoped CSS variables. */
function ThemePreview({ palette, appName }: { palette: Palette; appName: string }) {
  const style = themeVariables(palette) as CSSProperties;
  return (
    <div style={style} className="overflow-hidden rounded-2xl border border-ink-700 bg-ink-950 text-slate-200" aria-hidden>
      <div className="flex items-center gap-3 border-b border-ink-700/60 bg-ink-900 px-4 py-3">
        <BrandMark />
        <span className="leading-tight">
          <span className="block truncate text-sm font-semibold text-white">{appName}</span>
          <span className="block text-[11px] text-slate-400">Student</span>
        </span>
      </div>
      <div className="grid grid-cols-[110px_1fr]">
        <div className="space-y-1 border-r border-ink-700/60 bg-ink-900/60 p-2 text-xs">
          <div className="rounded-lg bg-aqua-500/10 px-2 py-1.5 text-aqua-300">Dashboard</div>
          <div className="px-2 py-1.5 text-slate-400">Materials</div>
          <div className="px-2 py-1.5 text-slate-400">Practice</div>
        </div>
        <div className="space-y-3 p-3">
          <div className="space-y-2 rounded-xl border border-ink-700/70 bg-ink-900/80 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Photosynthesis</span>
              <span className="badge-aqua">Ready</span>
            </div>
            <p className="text-xs text-slate-400">
              12 flashcards · <span className="text-aqua-300">Ask the tutor</span>
            </p>
            <ProgressBar value={64} tone="aqua" />
            <div className="flex gap-2 pt-1">
              <span className="btn-primary px-3 py-1 text-xs">Start practice</span>
              <span className="btn-secondary px-3 py-1 text-xs">Flashcards</span>
            </div>
          </div>
          <div className="rounded-xl border border-ink-700/60 bg-ink-850/80 p-3 text-xs text-slate-400">
            Score <span className="text-lg font-semibold text-aqua-300">86%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
