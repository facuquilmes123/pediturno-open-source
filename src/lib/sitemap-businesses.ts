import 'server-only';
import type { MetadataRoute } from 'next';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { entitlementMillis, isServicesBusiness } from '@/lib/membership-entitlement';
import { getEffectiveMembership } from '@/lib/membership-entitlement';
import { isBusinessOperational } from '@/lib/server-membership';
import { getVerticalFromBusinessType, getVerticalOrigin, type ProductVertical } from '@/lib/verticals';

const CACHE_MILLIS = 5 * 60_000;
const FAILURE_RETRY_MILLIS = 5_000;

// Never fetch/cache email addresses, credentials, billing IDs or full profiles here.
const PUBLIC_INDEX_FIELDS = [
  'status', 'slug', 'businessType', 'qaFixture', 'lastModified',
  'membership.type', 'membership.expiresAt',
];

type BusinessIndexSource = Record<string, unknown>;
type IndexEntry = {
  slug: string;
  vertical: ProductVertical;
  lastModified: number | null;
  visibleUntil: number | null;
};

async function readBusinessIndex(): Promise<BusinessIndexSource[]> {
  const snapshot = await getAdminFirestore().collection('businesses')
    .where('status', '==', 'active').select(...PUBLIC_INDEX_FIELDS).get();
  // Preserve every eligible business; do not introduce a silent query limit.
  return snapshot.docs.map(doc => doc.data());
}

function projectBusinessIndex(source: BusinessIndexSource[], now: number): IndexEntry[] {
  const slugs = new Map<string, number>();
  for (const row of source) if (typeof row.slug === 'string') slugs.set(row.slug, (slugs.get(row.slug) || 0) + 1);
  return source.flatMap(row => {
    const slug = row.slug;
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)
      || slug === 'prueba' || row.qaFixture === true || slugs.get(slug) !== 1
      || !isBusinessOperational(row, now)) return [];
    const membership = isServicesBusiness(row) ? null : getEffectiveMembership(row, now);
    const visibleUntil = membership && membership.type !== 'lifetime' ? entitlementMillis(membership.expiresAt) : null;
    const modified = entitlementMillis(row.lastModified);
    return [{ slug, vertical: getVerticalFromBusinessType(row.businessType),
      lastModified: Number.isFinite(modified) ? modified : null, visibleUntil }];
  });
}

/** One bounded-lifetime snapshot per process; concurrent hosts share the same refresh. */
export function createSitemapBusinessReader(load = readBusinessIndex, clock = Date.now) {
  let cached: { entries: IndexEntry[]; loadedAt: number; until: number } | null = null;
  let pending: Promise<IndexEntry[]> | null = null;
  return async (vertical: ProductVertical): Promise<MetadataRoute.Sitemap> => {
    const now = clock();
    let entries: IndexEntry[];
    if (cached && now >= cached.loadedAt && now < cached.until) entries = cached.entries;
    else {
      if (!pending) {
        pending = (async () => {
          try {
            const source = await load();
            const loadedAt = clock();
            const fresh = projectBusinessIndex(source, loadedAt);
            cached = { entries: fresh, loadedAt, until: loadedAt + CACHE_MILLIS };
          } catch {
            // Fail closed after expiry, and do not turn a provider outage into a read storm.
            const loadedAt = clock();
            cached = { entries: [], loadedAt, until: loadedAt + FAILURE_RETRY_MILLIS };
            console.error('Failed to refresh the public sitemap index');
          }
          return cached.entries;
        })().finally(() => { pending = null; });
      }
      entries = await pending;
    }
    const visibleAt = clock();
    const origin = getVerticalOrigin(vertical);
    return entries.filter(row => row.vertical === vertical
      && (row.visibleUntil === null || row.visibleUntil > visibleAt))
      .map(row => ({ url: `${origin}/${row.slug}`,
        lastModified: row.lastModified === null ? undefined : new Date(row.lastModified),
        changeFrequency: 'weekly', priority: 0.9 }));
  };
}

export const getSitemapBusinessRoutes = createSitemapBusinessReader();
