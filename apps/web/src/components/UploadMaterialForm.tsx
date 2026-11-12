'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';

const ACCEPTED = '.pdf,.docx,.png,.jpg,.jpeg';
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * `onDemand` (student uploads): the document is only stored and indexed; flashcards and
 * questions are generated later from its study page. Staff uploads generate automatically.
 */
export function UploadMaterialForm({ onDemand = false }: { onDemand?: boolean }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (mode === 'url') {
        return apiRequest('/study-materials/urls', { method: 'POST', json: { title, url } });
      }
      if (!file) throw new Error('Choose a file');
      if (file.size > MAX_BYTES) throw new Error('File exceeds 20 MB');
      const form = new FormData();
      form.append('title', title);
      form.append('file', file);
      return apiRequest('/study-materials/files', { method: 'POST', body: form });
    },
    onSuccess: () => {
      setDone(
        onDemand
          ? `“${title}” is being stored. When it shows Ready, open it to generate flashcards or questions with the model you choose.`
          : `“${title}” is being processed. It appears below and you'll get a notification when it's ready.`,
      );
      setTitle('');
      setUrl('');
      setFile(null);
      setError(null);
      if (fileInput.current) fileInput.current.value = '';
      void queryClient.invalidateQueries({ queryKey: ['study-materials'] });
    },
    onError: (err) => {
      setDone(null);
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed');
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    upload.mutate();
  }

  function pickFile(f: File | undefined) {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 200));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Add study material</h2>
          <p className="text-xs text-slate-400">PDF, DOCX, PNG/JPEG (OCR) or a public web page · max 20 MB</p>
        </div>
        <div className="segmented" role="group" aria-label="Source type">
          <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>File / image</button>
          <button type="button" aria-pressed={mode === 'url'} onClick={() => setMode('url')}>Web URL</button>
        </div>
      </div>

      {mode === 'file' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
          role="button"
          tabIndex={0}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? 'border-aqua-400 bg-aqua-500/5' : 'border-ink-600 hover:border-aqua-500/50 hover:bg-ink-850'
          }`}
        >
          <UploadCloud className="h-8 w-8 text-aqua-400" aria-hidden />
          {file ? (
            <p className="text-sm text-white">
              {file.name} <span className="text-slate-500">({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
            </p>
          ) : (
            <p className="text-sm text-slate-300">
              <span className="font-medium text-aqua-300">Click to choose</span> or drag a file here
            </p>
          )}
          <input ref={fileInput} type="file" accept={ACCEPTED} className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
        </div>
      ) : (
        <label className="relative block">
          <span className="sr-only">Web page URL</span>
          <Globe className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input className="input pl-9" type="url" placeholder="https://…" required value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Title</span>
          <input className="input" placeholder="Title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button className="btn-primary" disabled={upload.isPending || (mode === 'file' && !file)}>
          {upload.isPending ? 'Uploading…' : onDemand ? 'Upload' : 'Upload & process'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {done && <p role="status" className="text-sm text-aqua-300">{done}</p>}
      <p className="text-xs text-slate-500">
        {onDemand
          ? 'Uploading only stores the document. You choose when to generate flashcards or questions, and with which model.'
          : 'Already-analysed documents are recognised automatically and reuse their existing flashcards and questions.'}
      </p>
    </form>
  );
}
