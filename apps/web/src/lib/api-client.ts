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
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
    throw new ApiError(response.status, message ?? response.statusText, data.issues);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
