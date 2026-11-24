import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { remove } = vi.hoisted(() => ({ remove: vi.fn() }));
vi.mock('firebase-admin/storage', () => ({ getStorage: () => ({ bucket: () => ({ file: () => ({ delete: remove }) }) }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn() }));
import { queueOwnedImageCleanup, runOwnedImageCleanup } from '@/lib/owned-image-cleanup';
const bucket = 'demo-cleanup.appspot.com';
let oldBucket: string | undefined;
beforeEach(() => { oldBucket = process.env.FIREBASE_STORAGE_BUCKET; process.env.FIREBASE_STORAGE_BUCKET = bucket; remove.mockReset(); });
afterEach(() => { if(oldBucket === undefined) delete process.env.FIREBASE_STORAGE_BUCKET; else process.env.FIREBASE_STORAGE_BUCKET = oldBucket; });
const url = (object: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(object)}?alt=media&token=fixture-not-a-real-token`;
function fixture(overrides = {}) {
 const update = vi.fn(); const data = { businessId: 'owner', category: 'services', object: 'businesses/owner/services/a.jpg', bucket, ...overrides };
 const chain: any = { where: () => chain, limit: () => chain, get: async () => ({ docs: [{ data: () => data, ref: { update } }] }) };
 const db: any = { collection: (name: string) => name === 'storageCleanupJobs' ? chain : { where: () => ({ select: () => ({ get: async () => ({ docs: [] }) }) }) } };
 return { db, update };
}
describe('owned image cleanup', () => {
 it('never queues foreign paths, buckets, traversal or external hosts and never stores URL tokens', () => {
  const set = vi.fn(); const tx: any = {set}; const db: any = {collection: () => ({doc: () => ({})})};
  for(const value of [url('businesses/other/services/a.jpg'),url('businesses/owner/avatars/a.jpg'),url('businesses/owner/services/../a.jpg'),'https://example.com/a.jpg',url('businesses/owner/services/a.jpg').replace(bucket,'other.appspot.com')]) queueOwnedImageCleanup(tx,db,'owner',value,'services');
  expect(set).not.toHaveBeenCalled();queueOwnedImageCleanup(tx,db,'owner',url('businesses/owner/services/a.jpg'),'services');
  expect(set).toHaveBeenCalledOnce();expect(JSON.stringify(set.mock.calls)).not.toContain('fixture-not-a-real-token');
 });
 it('retains the pending job after a provider outage and safely retries', async () => {
  const {db,update}=fixture();remove.mockRejectedValueOnce(new Error('provider unavailable'));
  expect(await runOwnedImageCleanup(db)).toEqual({deleted:0,retained:0,failed:1});expect(update).not.toHaveBeenCalled();
  remove.mockResolvedValueOnce(undefined);expect(await runOwnedImageCleanup(db)).toEqual({deleted:1,retained:0,failed:0});expect(update).toHaveBeenCalledWith(expect.objectContaining({status:'deleted'}));
 });
 it('rejects even a persisted job targeting an unrelated bucket', async () => {
  const {db}=fixture({bucket:'foreign.appspot.com'});expect((await runOwnedImageCleanup(db)).failed).toBe(1);expect(remove).not.toHaveBeenCalled();
 });
});
