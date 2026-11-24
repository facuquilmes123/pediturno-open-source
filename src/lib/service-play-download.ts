import 'server-only';
import { unstable_cache } from 'next/cache';
import { SERVICE_PLAY_PACKAGE, SERVICE_PLAY_URL } from '@/lib/config';

// Only controls the CTA; it never accepts the formal distribution/smoke gates.
export function isPublicServicePlayListing(status: number, finalUrl: string, html: string): boolean {
  try {
    const url = new URL(finalUrl);
    if (status !== 200 || url.origin !== 'https://play.google.com' || url.pathname !== '/store/apps/details' || url.searchParams.get('id') !== SERVICE_PLAY_PACKAGE) return false;
    const title = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1];
    return !!title?.startsWith('Pediturno: Agenda y turnos') && /(?:>\s*|aria-label=["'])(?:Instalar|Install)(?:\s*<|["'])/i.test(html);
  } catch { return false; }
}

export const isServicePlayDownloadAvailable = unstable_cache(async (): Promise<boolean> => {
  try {
    const response = await fetch(`${SERVICE_PLAY_URL}&hl=es_AR&gl=AR`, { cache: 'no-store', signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;
    return isPublicServicePlayListing(response.status, response.url, await response.text());
  } catch { return false; }
}, ['pediturno-services-public-play-download-v1'], { revalidate: 900 });
