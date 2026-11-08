'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';

const ACCEPTED = '.pdf,.docx,.png,.jpg,.jpeg';
const MAX_BYTES = 20 * 1024 * 1024;

export function UploadMaterialForm() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setTitle('');
      setUrl('');
      setFile(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['study-materials'] });
    },
    onError: (err) => setError(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed'),
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    upload.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Add study material</h2>
        <div className="flex gap-1 text-xs">
          {(['file', 'url'] as const).map((m) => (
            <button type="button" key={m} onClick={() => setMode(m)}
              className={`rounded px-2 py-1 ${mode === m ? 'bg-indigo-600 text-white' : 'bg-slate-100'}`}>
              {m === 'file' ? 'File / image' : 'Web URL'}
            </button>
          ))}
        </div>
      </div>
      <input className="input" placeholder="Title" required maxLength={200} value={title}
        onChange={(e) => setTitle(e.target.value)} />
      {mode === 'file' ? (
        <input className="input" type="file" accept={ACCEPTED} required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      ) : (
        <input className="input" type="url" placeholder="https://…" required value={url}
          onChange={(e) => setUrl(e.target.value)} />
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary" disabled={upload.isPending}>
        {upload.isPending ? 'Uploading…' : 'Upload & process'}
      </button>
      <p className="text-xs text-slate-500">PDF, DOCX, PNG/JPEG (OCR) or a public web page. Max 20 MB.</p>
    </form>
  );
}
