import { beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { authorizeImageUpload, confirmImagePermits, imageUploadInput } from '@/lib/image-upload-permits';

// Serial, atomic local transaction model; provider/rules verification is separate.
function database() {
  const records = new Map<string, Record<string, unknown>>();
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    collection(name: string) { return { doc(id: string) { return { path: `${name}/${id}` }; } }; },
    runTransaction(body: (tx: Transaction) => Promise<unknown>) {
      const run = tail.then(async () => {
        let written = false;
        const pending = new Map<string, Record<string, unknown>>();
        const tx = {
          async get(ref: { path: string }) {
            if (written) throw new Error('Read after write');
            return { exists: records.has(ref.path), data: () => records.get(ref.path) };
          },
          set(ref: { path: string }, value: Record<string, unknown>) { written = true; pending.set(ref.path, value); },
          create(ref: { path: string }, value: Record<string, unknown>) {
            if (records.has(ref.path)) throw new Error('Already exists');
            written = true; pending.set(ref.path, value);
          },
          update(ref: { path: string }, value: Record<string, unknown>) {
            if (!records.has(ref.path)) throw new Error('Not found');
            written = true; pending.set(ref.path, { ...records.get(ref.path), ...value });
          },
        };
        const value = await body(tx as unknown as Transaction);
        for (const [path, row] of pending) records.set(path, row);
        return value;
      });
      tail = run.catch(() => undefined); return run;
    },
  };
  records.set('businesses/owner', { status: 'active', businessType: 'services' });
  return { db: db as unknown as Firestore, records };
}
const now = 3_600_100;
const input = () => imageUploadInput({ category: 'services', contentType: 'image/jpeg', byteSize: 100 });
const key = (index = 0) => `synthetic_operation_${index}`;
const receipt = (id: string) => 'bookingRateLimits/image-permit-v1_' + id;
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/demo-images/o/${encodeURIComponent(path)}?alt=media&token=synthetic`;
describe('server-owned image receipts and atomic association', () => {
  beforeEach(() => { process.env.FIREBASE_STORAGE_BUCKET = 'demo-images'; });
  it('normalizes input order and refuses caller-selected scope, MIME or oversized output', () => {
    expect(imageUploadInput({ byteSize: 100, contentType: 'image/jpeg', category: 'services' })).toEqual(input());
    for (const bad of [{ ...input(), businessId: 'other' }, { ...input(), storagePath: 'chosen' }, { ...input(), contentType: 'image/svg+xml' },
      { ...input(), contentType: ['image/jpeg'] }, { ...input(), byteSize: 0 }, { ...input(), byteSize: 2 * 1024 * 1024 + 1 }, { ...input(), byteSize: 1.5 }]) {
      expect(() => imageUploadInput(bad)).toThrow();
    }
  });
  it('issues a derived owner path and replays the same key without spending budget twice', async () => {
    const fake = database();
    const first = await authorizeImageUpload(fake.db, 'owner', key(), input(), now);
    const second = await authorizeImageUpload(fake.db, 'owner', key(), input(), now + 1);
    expect(first.storagePath).toBe(`businesses/owner/services/g_${first.permitId}.jpg`);
    expect(second).toEqual({ ...first, repeated: true });
    expect([...fake.records.values()].find(row => row.kind === 'image-upload-budget')?.count).toBe(1);
  });
  it('rejects changed payloads, expired receipts and a receipt consumed by another resource', async () => {
    const fake = database(); const first = await authorizeImageUpload(fake.db, 'owner', key(), input(), now);
    await expect(authorizeImageUpload(fake.db, 'owner', key(), { ...input(), byteSize: 101 }, now)).rejects.toMatchObject({ status: 409 });
    await expect(authorizeImageUpload(fake.db, 'owner', key(), input(), now + 600_000)).rejects.toMatchObject({ status: 410 });
    await fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath)], 'services/one', now));
    await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath)], 'services/two', now))).rejects.toMatchObject({ status: 409 });
    await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath)], 'services/one', now + 900_000))).resolves.toBeUndefined();
  });
  it('enforces the byte quota, including reservations that never finished uploading', async () => {
    const fake = database(); const large = { ...input(), byteSize: 2 * 1024 * 1024 };
    for (let i = 0; i < 32; i++) await authorizeImageUpload(fake.db, 'owner', key(i), large, now);
    await expect(authorizeImageUpload(fake.db, 'owner', key(32), input(), now)).rejects.toMatchObject({ status: 429, retryAfter: 3600 });
    expect([...fake.records.values()].filter(row => row.kind === 'image-upload-budget')).toHaveLength(1);
    await expect(authorizeImageUpload(fake.db, 'owner', key(33), input(), now + 3_600_000)).resolves.toMatchObject({ repeated: false });
  });
  it('bounds concurrent tiny receipts at 120 and isolates another owner', async () => {
    const fake = database();
    const attempts = await Promise.allSettled(Array.from({ length: 121 }, (_, i) => authorizeImageUpload(fake.db, 'owner', key(i), input(), now)));
    expect(attempts.filter(item => item.status === 'fulfilled')).toHaveLength(120);
    fake.records.set('businesses/other', { status: 'active' });
    await expect(authorizeImageUpload(fake.db, 'other', key(), input(), now)).resolves.toMatchObject({ repeated: false });
  });
  it('rejects deleted, expired paid and cross-vertical profiles, and permits active hybrid courts', async () => {
    const fake = database();
    for (const business of [{ status: 'deletion_requested' }, { status: 'active', businessType: 'spaces', membership: { type: 'trial', expiresAt: Timestamp.fromMillis(0) } }]) {
      fake.records.set('businesses/owner', business);
      await expect(authorizeImageUpload(fake.db, 'owner', key(), input(), now)).rejects.toMatchObject({ status: 403 });
    }
    fake.records.set('businesses/owner', { status: 'active', businessType: 'services' });
    await expect(authorizeImageUpload(fake.db, 'owner', key(), { ...input(), category: 'canchas' }, now)).rejects.toMatchObject({ status: 403 });
    fake.records.set('businesses/owner', { status: 'active', businessType: 'hybrid', membership: { type: 'lifetime' } });
    await expect(authorizeImageUpload(fake.db, 'owner', key(), { ...input(), category: 'canchas' }, now)).resolves.toMatchObject({ repeated: false });
  });
  it('fails closed for corrupt persisted budget state', async () => {
    const fake = database(); await authorizeImageUpload(fake.db, 'owner', key(), input(), now);
    const budget = [...fake.records.entries()].find(([, row]) => row.kind === 'image-upload-budget')!;
    fake.records.set(budget[0], { ...budget[1], count: -1 });
    await expect(authorizeImageUpload(fake.db, 'owner', key(2), input(), now)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects a valid URL mixed with an altered folder or extension for the same permit', async () => {
    const fake = database(); const first = await authorizeImageUpload(fake.db, 'owner', key(), input(), now);
    for (const altered of [first.storagePath.replace('/services/', '/logos/'), first.storagePath.replace('.jpg', '.png')]) {
      await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath), url(altered)], 'services/one', now))).rejects.toMatchObject({ status: 400 });
      expect(fake.records.get(receipt(first.permitId))?.status).toBe('pending');
    }
  });
  it('rejects other tenants, other buckets, other categories and quarantined receipts', async () => {
    const fake = database(); const first = await authorizeImageUpload(fake.db, 'owner', key(), input(), now);
    await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'other', [url(first.storagePath)], 'services/one', now))).rejects.toMatchObject({ status: 400 });
    await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath).replace('/b/demo-images/', '/b/another/')], 'services/one', now))).rejects.toMatchObject({ status: 400 });
    await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath)], 'businesses/owner', now))).rejects.toMatchObject({ status: 409 });
    fake.records.set(receipt(first.permitId), { ...fake.records.get(receipt(first.permitId)), status: 'deleting' });
    await expect(fake.db.runTransaction(tx => confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath)], 'services/one', now))).rejects.toMatchObject({ status: 409 });
  });
  it('rolls back confirmation if the resource write fails, with all reads before writes', async () => {
    const fake = database(); const first = await authorizeImageUpload(fake.db, 'owner', key(), input(), now);
    await expect(fake.db.runTransaction(async tx => {
      await confirmImagePermits(tx, fake.db, 'owner', [url(first.storagePath)], 'services/one', now);
      throw new Error('synthetic resource failure');
    })).rejects.toThrow('synthetic resource failure');
    expect(fake.records.get(receipt(first.permitId))?.status).toBe('pending');
  });
});
