import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BrandingProvider } from '@/components/BrandingProvider';
import { getBranding } from '@/lib/branding-server';
import { QueryProvider } from '@/lib/query-provider';
import './globals.css';

/** Name and logo come from the administrator's branding settings. */
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: branding.appName,
    description: 'AI-assisted study, tutoring and assessment',
    ...(branding.logoUrl ? { icons: { icon: branding.logoUrl } } : {}),
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const branding = await getBranding();
  return (
    <html lang="en">
      <body>
        <BrandingProvider initial={branding}>
          <QueryProvider>{children}</QueryProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
