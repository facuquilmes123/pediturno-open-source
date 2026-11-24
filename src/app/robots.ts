
import type { MetadataRoute } from 'next'
import { headers } from 'next/headers';
import { getVerticalFromHost, getVerticalOrigin } from '@/lib/verticals';
 
export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = getVerticalOrigin(getVerticalFromHost((await headers()).get('host')));
  const sitemap = `${baseUrl}/sitemap.xml`;
  
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Crawlers must be able to see the dashboard X-Robots-Tag noindex.
        disallow: ['/cancel/', '/api/'],
      },
    ],
    sitemap,
  }
}
