import { cache } from 'react';
import { DEFAULT_BRANDING, type Branding } from './branding';

const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

/**
 * Branding for the server render (title, logo, theme colours before the first paint).
 * Fetched per request so a change shows on the next page load; the API caches it. Once per
 * render, and never fatal: if the API is unreachable the built-in look is used.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const response = await fetch(`${apiInternalUrl}/api/v1/branding`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return DEFAULT_BRANDING;
    return (await response.json()) as Branding;
  } catch {
    return DEFAULT_BRANDING;
  }
});
