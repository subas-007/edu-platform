import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Tighten further with per-request nonces (middleware) to drop 'unsafe-inline'.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    /**
     * The /api/v1 rewrite proxy aborts after 30 s by default. A local CPU model can need
     * minutes for a tutor answer (more while it is also generating study material), so allow
     * slightly more than the API's own TUTOR_TIMEOUT_MS (240 s) and let the API decide.
     */
    proxyTimeout: 300_000,
  },
  reactStrictMode: true,
  /**
   * The browser only ever talks to this origin. /api/v1/* is proxied to the
   * NestJS API, so auth cookies are first-party, SameSite=Strict, and visible
   * to the edge middleware for dashboard routing.
   */
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isDev
            ? []
            : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
        ],
      },
    ];
  },
};

export default nextConfig;
