export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type ApiRequestInit = Omit<RequestInit, 'body'> & { json?: unknown; body?: BodyInit };

let inFlightRefresh: Promise<boolean> | null = null;

/** De-duplicates concurrent refreshes (one rotation per burst of 401s). */
export function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      inFlightRefresh = null;
    });
  return inFlightRefresh;
}

/**
 * Single HTTP entry point for the client. Cookies are httpOnly, so no token is
 * ever readable from JavaScript (XSS cannot exfiltrate sessions).
 */
export async function apiRequest<T>(path: string, init: ApiRequestInit = {}, allowRetry = true): Promise<T> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }

  const response = await fetch(`/api/v1${path}`, { ...init, headers, body, credentials: 'same-origin' });

  if (response.status === 401 && allowRetry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return apiRequest<T>(path, init, false);
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function toApiError(response: Response): Promise<ApiError> {
  const data = await response.json().catch(() => ({}));
  const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
  return new ApiError(response.status, message ?? response.statusText, data.issues);
}

/**
 * POSTs JSON to a server-sent-events endpoint and calls `onEvent` with each parsed
 * `data:` payload as it arrives. Resolves when the server ends the stream; aborting
 * `signal` closes the connection (the API then cancels its work).
 */
export async function apiStream<E>(
  path: string,
  json: unknown,
  onEvent: (event: E) => void,
  signal?: AbortSignal,
  allowRetry = true,
): Promise<void> {
  const response = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(json),
    credentials: 'same-origin',
    signal,
  });
  if (response.status === 401 && allowRetry) {
    if (await refreshSession()) return apiStream(path, json, onEvent, signal, false);
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!response.ok || !response.body) throw await toApiError(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      buffer = buffer.slice(end + 2);
      if (data) onEvent(JSON.parse(data) as E); // ":" lines are keep-alives
    }
  }
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? fallback;
}

/**
 * Downloads an authenticated file (PDF/CSV). Goes through fetch rather than a plain
 * link so an expired access token is refreshed instead of saving a JSON error page.
 */
export async function downloadFile(path: string, fallbackName: string, allowRetry = true): Promise<void> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (response.status === 401 && allowRetry && (await refreshSession())) {
    return downloadFile(path, fallbackName, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.message ?? 'Download failed');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
