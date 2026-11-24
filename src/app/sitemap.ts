import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';
import { ESTETICA_GUIDE_PATH } from '@/lib/public-analytics';
import { getSitemapBusinessRoutes } from '@/lib/sitemap-businesses';
import { getVerticalFromHost, getVerticalOrigin } from '@/lib/verticals';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const vertical = getVerticalFromHost((await headers()).get('host'));
  const origin = getVerticalOrigin(vertical);
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: origin },
    ...(vertical === 'services'
      ? ['/faq', '/privacy-policy', '/terminos', ESTETICA_GUIDE_PATH].map(path => ({ url: origin + path }))
      : []),
  ];
  return [...staticRoutes, ...await getSitemapBusinessRoutes(vertical)];
}
