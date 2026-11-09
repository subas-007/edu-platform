'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { downloadFile } from '@/lib/api-client';

export function DownloadButton({
  path,
  filename,
  children,
  variant = 'secondary',
  size,
  icon,
}: {
  path: string;
  filename: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm';
  icon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(path, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={`btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : (icon ?? <Download className="h-4 w-4" aria-hidden />)}
        {children}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-red-300">{error}</span>}
    </span>
  );
}
