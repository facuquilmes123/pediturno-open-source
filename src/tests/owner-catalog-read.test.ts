import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: { currentUser: null as any }, fetch: vi.fn(), token: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: mock.auth }));
import { readOwnerCatalog } from '@/lib/owner-catalog-read';
const row = (id: string) => ({ id, businessId: 'owner', name: id, unavailableDates: ['2030-06-03T03:00:00.000Z'], workingHours: { 1: { slots: [{ start: '09:00', end: '18:00' }], isAlternating: true } } });
const page = (items: any[], nextCursor: string | null = null) => ({ ok: true, status: 200, json: async () => ({ items, nextCursor }) });
describe('web catalogs: complete, isolated and bounded reads', () => {
 beforeEach(() => { mock.auth.currentUser = { uid: 'owner', getIdToken: mock.token }; mock.token.mockResolvedValue('synthetic'); vi.stubGlobal('fetch', mock.fetch); });
 afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
 for (const kind of ['services', 'canchas', 'spaces'] as const) {
  it(`${kind}: reads all pages and preserves dates and editor fields`, async () => {
   mock.fetch.mockResolvedValueOnce(page(Array.from({length:100},(_,i)=>row(`r${i}`)),'r99')).mockResolvedValueOnce(page([{...row('r100'),price:'1234.50',duration:'90',sport:'padel',category:'quincho',packages:[{durationMinutes:240,price:'4000'}],photos:['https://example.test/photo'],preparationMinutes:30,cleanupMinutes:20,bookingBufferMinutes:null}]));
   const result=await readOwnerCatalog('owner',kind); expect(result).toHaveLength(101); expect(result[100]).toMatchObject({price:'1234.50',duration:'90',sport:'padel',packages:[{durationMinutes:240,price:'4000'}],preparationMinutes:30,cleanupMinutes:20,bookingBufferMinutes:null});
   expect(result[0].unavailableDates).toEqual([new Date('2030-06-03T03:00:00Z')]); expect(result[0].workingHours?.[1].isAlternating).toBe(true);
   expect(mock.fetch.mock.calls[1][0]).toBe(`/api/owner/catalog?kind=${kind}&limit=100&cursor=r99`);
  });
 }
 it('fails rather than returning a partial catalog',async()=>{mock.fetch.mockResolvedValueOnce(page([row('a')],'a')).mockResolvedValueOnce({status:503,ok:false});await expect(readOwnerCatalog('owner','services')).rejects.toThrow(/completo/);});
 it('rejects cross-account reads and discards an old session even with the same UID',async()=>{await expect(readOwnerCatalog('neighbor','spaces')).rejects.toThrow(/sesión/);expect(mock.fetch).not.toHaveBeenCalled();mock.fetch.mockImplementation(async()=>{mock.auth.currentUser={uid:'owner'};return page([row('a')]);});await expect(readOwnerCatalog('owner','spaces')).rejects.toThrow(/sesión/);});
 it('checks session changes while reading JSON',async()=>{mock.fetch.mockResolvedValueOnce({ok:true,status:200,json:async()=>{mock.auth.currentUser=null;return {items:[row('a')],nextCursor:null};}});await expect(readOwnerCatalog('owner','services')).rejects.toThrow(/sesión/);});
 it('rejects foreign rows, malformed dates, duplicates and repeating cursors',async()=>{
  for(const value of [{...row('a'),businessId:'neighbor'},{...row('a'),unavailableDates:['bad']},{...row('a'),unavailableDates:[null]}]){mock.fetch.mockResolvedValueOnce(page([value]));await expect(readOwnerCatalog('owner','canchas')).rejects.toThrow(/inválida/);}
  mock.fetch.mockResolvedValueOnce(page([row('a')],'a')).mockResolvedValueOnce(page([row('a')]));await expect(readOwnerCatalog('owner','canchas')).rejects.toThrow(/inválida/);
  mock.fetch.mockResolvedValueOnce(page([row('a')],'a')).mockResolvedValueOnce(page([row('b')],'a'));await expect(readOwnerCatalog('owner','canchas')).rejects.toThrow(/Paginación/);
 });
 it('retries only bounded 429 on the identical page',async()=>{vi.useFakeTimers();const cancel=vi.fn();mock.fetch.mockResolvedValueOnce({status:429,headers:new Headers({'Retry-After':'1'}),body:{cancel}}).mockResolvedValueOnce(page([row('a')]));const pending=readOwnerCatalog('owner','services');await vi.runAllTimersAsync();expect(await pending).toHaveLength(1);expect(cancel).toHaveBeenCalled();expect(mock.fetch.mock.calls[0][0]).toBe(mock.fetch.mock.calls[1][0]);});
 it('caps retries and never retries network failures',async()=>{mock.fetch.mockResolvedValueOnce({status:429,headers:new Headers({'Retry-After':'61'})});await expect(readOwnerCatalog('owner','services')).rejects.toThrow(/ocupado/);expect(mock.fetch).toHaveBeenCalledTimes(1);mock.fetch.mockRejectedValueOnce(Error('network'));await expect(readOwnerCatalog('owner','services')).rejects.toThrow('network');expect(mock.fetch).toHaveBeenCalledTimes(2);});
});
