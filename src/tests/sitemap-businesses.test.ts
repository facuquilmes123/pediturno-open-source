// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const firestore = vi.hoisted(() => ({ get: vi.fn(), select: vi.fn(), where: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => ({ collection: (name: string) => {
  expect(name).toBe('businesses');
  const query = { where: firestore.where, select: firestore.select, get: firestore.get };
  firestore.where.mockReturnValue(query); firestore.select.mockReturnValue(query); return query;
} }) }));
import { createSitemapBusinessReader } from '@/lib/sitemap-businesses';
const nowBase = Date.parse('2030-01-01T00:00:00Z');
const service = (slug: string, extra = {}) => ({ slug, businessType: 'services', status: 'active', ...extra });
afterEach(() => vi.restoreAllMocks());

describe('public sitemap read protection', () => {
  it('coalesces concurrent hosts and retains every eligible business above a typical page size', async () => {
    const rows = [...Array.from({ length: 1301 }, (_, i) => service(`business-${i}`)),
      service('court', { businessType: 'sports_facility', membership: { type: 'lifetime' } }),
      service('space', { businessType: 'spaces', membership: { type: 'lifetime' } })];
    const load = vi.fn().mockResolvedValue(rows); const read = createSitemapBusinessReader(load, () => nowBase);
    const all = await Promise.all(Array.from({ length: 100 }, (_, i) => read(i % 2 ? 'services' : 'sports_facility')));
    expect(load).toHaveBeenCalledTimes(1);
    expect(all[1]).toHaveLength(1301); expect(new Set(all[1].map(x => x.url)).size).toBe(1301);
    expect(all[0].map(x => x.url)).toEqual(['https://canchas.pediturno.com/court']);
    expect((await read('spaces')).map(x => x.url)).toEqual(['https://espacios.pediturno.com/space']);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('keeps Services Gratis and expired paid Services operational without relaxing other verticals', async () => {
    const read = createSitemapBusinessReader(async () => [service('free'), service('expired-service', {membership:{type:'pro',expiresAt:Timestamp.fromMillis(nowBase-1)}}),
      service('expired-court', {businessType:'sports_facility',membership:{type:'trial',expiresAt:Timestamp.fromMillis(nowBase-1)}}),
      service('unpaid-space', {businessType:'spaces'})], () => nowBase);
    expect((await read('services')).map(x=>x.url)).toEqual(['https://pediturno.com/free','https://pediturno.com/expired-service']);
    expect(await read('sports_facility')).toEqual([]); expect(await read('spaces')).toEqual([]);
  });
  it('excludes QA, inactive, malformed and ambiguous public slugs without leaking private fields', async () => {
    const read = createSitemapBusinessReader(async () => [service('real', {email:'MUST_NOT_LEAK',mercadopago:{accessToken:'MUST_NOT_LEAK'},lastModified:Timestamp.fromMillis(nowBase)}),
      service('qa', {qaFixture:true}), service('prueba'), service('../private'), service('x?redirect=private'), service('inactive',{status:'deletion_requested'}), service('same'), service('same')], () => nowBase);
    const result=await read('services'); expect(result).toHaveLength(1);
    expect(result[0]).toEqual({url:'https://pediturno.com/real',lastModified:new Date(nowBase),changeFrequency:'weekly',priority:0.9});
    expect(JSON.stringify(result)).not.toContain('MUST_NOT_LEAK');
  });
  it('drops a non-services membership at its deadline even while the snapshot is still fresh', async () => {
    let now=nowBase; const load=vi.fn().mockResolvedValue([service('trial',{businessType:'spaces',membership:{type:'trial',expiresAt:Timestamp.fromMillis(nowBase+1000)}})]);
    const read=createSitemapBusinessReader(load,()=>now); expect(await read('spaces')).toHaveLength(1);
    now+=1000; expect(await read('spaces')).toEqual([]); expect(load).toHaveBeenCalledTimes(1);
  });
  it('refreshes additions and removals at five minutes and does not expose cached mutable objects', async () => {
    let now=nowBase; const load=vi.fn().mockResolvedValueOnce([service('old',{lastModified:Timestamp.fromMillis(nowBase)})]).mockResolvedValueOnce([service('new')]);
    const read=createSitemapBusinessReader(load,()=>now); const first=await read('services');first[0].url='https://evil.invalid';(first[0].lastModified as Date).setTime(0);
    now+=299999;expect((await read('services'))[0]).toMatchObject({url:'https://pediturno.com/old',lastModified:new Date(nowBase)});
    now+=1;expect((await read('services')).map(x=>x.url)).toEqual(['https://pediturno.com/new']);expect(load).toHaveBeenCalledTimes(2);
  });
  it('fails closed after expiry, coalesces provider failures and backs off before retrying', async () => {
    vi.spyOn(console,'error').mockImplementation(()=>{});let now=nowBase;
    const load=vi.fn().mockResolvedValueOnce([service('old')]).mockRejectedValueOnce(Error('PRIVATE_PROVIDER_ERROR')).mockResolvedValueOnce([service('recovered')]);
    const read=createSitemapBusinessReader(load,()=>now);expect(await read('services')).toHaveLength(1);now+=300000;
    const outage=await Promise.all(Array.from({length:50},()=>read('services')));expect(outage.every(x=>x.length===0)).toBe(true);expect(load).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('Failed to refresh the public sitemap index');
    now+=4999;expect(await read('services')).toEqual([]);expect(load).toHaveBeenCalledTimes(2);
    now++;expect((await read('services'))[0].url).toBe('https://pediturno.com/recovered');expect(load).toHaveBeenCalledTimes(3);
  });
  it('does not extend the cache indefinitely when the wall clock moves backwards', async () => {
    let now=nowBase;const load=vi.fn().mockResolvedValue([service('public')]);const read=createSitemapBusinessReader(load,()=>now);
    await read('services');now--;await read('services');expect(load).toHaveBeenCalledTimes(2);
  });
  it('requests only the seven fields required for public eligibility and route metadata', async () => {
    firestore.get.mockResolvedValue({docs:[{data:()=>service('public')}]});const read=createSitemapBusinessReader(undefined,()=>nowBase);
    expect(await read('services')).toHaveLength(1);expect(firestore.where).toHaveBeenCalledWith('status','==','active');
    expect(firestore.select).toHaveBeenCalledExactlyOnceWith('status','slug','businessType','qaFixture','lastModified','membership.type','membership.expiresAt');
  });
});
