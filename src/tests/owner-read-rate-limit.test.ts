import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { createOwnerReadLimiter, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';

// Explicitly local transaction model. Real SDK/emulator tests are separate.
function database() {
  const records = new Map<string, Record<string, unknown>>();
  let reads = 0; let writes = 0; let failed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const db = {
    collection(name: string) { return { doc(id: string) { return { key: `${name}/${id}` }; } }; },
    runTransaction(body: (tx: unknown) => Promise<unknown>) {
      const run = tail.then(async () => {
        if (failed) throw new Error('synthetic unavailable');
        return body({
          get: async (ref: { key: string }) => { reads++; return { exists: records.has(ref.key), data: () => records.get(ref.key) }; },
          set: (ref: { key: string }, value: Record<string, unknown>) => { writes++; records.set(ref.key, value); },
        });
      });
      tail = run.catch(() => undefined); return run;
    },
  };
  return { db: db as unknown as Firestore, records, totals: () => ({ reads, writes }), fail: () => { failed = true; } };
}

describe('Expensive owner reads: fixed technical admission, fresh responses', () => {
  it('admits a normal bootstrap/dashboard pair and persists one document per owner', async () => {
    const fake = database(); const limit = createOwnerReadLimiter(() => 60_100);
    expect((await limit(fake.db, 'owner')).allowed).toBe(true);
    expect((await limit(fake.db, 'owner')).allowed).toBe(true);
    expect(fake.records.size).toBe(1);
    expect([...fake.records.values()][0]).toMatchObject({ businessId: 'owner', count: 2, windowStartMs: 60_000 });
    expect(fake.totals()).toEqual({ reads: 2, writes: 2 });
  });
  it('rejects the thirteenth burst attempt before a counter read/write', async () => {
    const fake = database(); const limit = createOwnerReadLimiter(() => 60_100);
    for (let i = 0; i < 12; i++) expect((await limit(fake.db, 'owner')).allowed).toBe(true);
    const before = fake.totals(); const result = await limit(fake.db, 'owner');
    expect(result).toEqual({ allowed: false, status: 429, retryAfterSeconds: 5 });
    expect(fake.totals()).toEqual(before);
  });
  it('admits again at the exact burst boundary', async () => {
    let now = 60_100; const fake = database(); const limit = createOwnerReadLimiter(() => now);
    for (let i = 0; i < 12; i++) await limit(fake.db, 'owner');
    now += 5_000; expect((await limit(fake.db, 'owner')).allowed).toBe(true);
  });
  it('enforces the shared fixed window after a simulated process reset', async () => {
    const fake = database(); let time = 60_100; const now = () => time;
    for (let worker = 0; worker < 6; worker++) {
      const limit = createOwnerReadLimiter(now);
      for (let i = 0; i < 10; i++) expect((await limit(fake.db, 'owner')).allowed).toBe(true);
      if (worker < 5) time += 5_000;
    }
    const restarted = createOwnerReadLimiter(now);
    expect(await restarted(fake.db, 'owner')).toEqual({ allowed: false, status: 429, retryAfterSeconds: 35 });
    const before = fake.totals(); await restarted(fake.db, 'owner');
    expect(fake.totals()).toEqual(before);
    expect([...fake.records.values()][0].count).toBe(60);
  });
  it('shares the burst gate between distinct worker instances', async () => {
    const fake = database(); const clock = () => 60_100;
    for (let worker = 0; worker < 3; worker++) {
      const limit = createOwnerReadLimiter(clock);
      for (let i = 0; i < 4; i++) expect((await limit(fake.db, 'owner')).allowed).toBe(true);
    }
    const before = fake.totals();
    expect(await createOwnerReadLimiter(clock)(fake.db, 'owner')).toEqual({ allowed: false, status: 429, retryAfterSeconds: 5 });
    expect(fake.totals()).toEqual({ reads: before.reads + 1, writes: before.writes });
  });
  it('does not reset a distributed burst at a fixed-minute boundary', async () => {
    const fake = database(); let time = 119_999; const limit = createOwnerReadLimiter(() => time);
    for (let i = 0; i < 12; i++) await limit(fake.db, 'owner');
    time = 120_000;
    expect((await createOwnerReadLimiter(() => time)(fake.db, 'owner')).status).toBe(429);
    time = 124_999;
    expect((await createOwnerReadLimiter(() => time)(fake.db, 'owner')).status).toBe(200);
    expect(fake.records.size).toBe(1);
  });
  it('starts the next fixed minute without creating another document', async () => {
    const fake = database(); let now = 119_999;
    const limit = createOwnerReadLimiter(() => now); await limit(fake.db, 'owner');
    now = 120_000; await limit(fake.db, 'owner');
    expect(fake.records.size).toBe(1);
    expect([...fake.records.values()][0]).toMatchObject({ windowStartMs: 120_000, count: 1 });
  });
  it('isolates the authenticated owner even if another owner exhausts its burst', async () => {
    const fake = database(); const limit = createOwnerReadLimiter(() => 60_100);
    for (let i = 0; i < 12; i++) await limit(fake.db, 'first');
    expect((await limit(fake.db, 'first')).allowed).toBe(false);
    expect((await limit(fake.db, 'second')).allowed).toBe(true);
    expect(fake.records.size).toBe(2);
  });
  it('never consumes or overwrites the existing public booking counters', async () => {
    const fake = database(); const limit = createOwnerReadLimiter(() => 60_100);
    const legacyKey = 'bookingRateLimits/' + createHash('sha256').update('owner').digest('hex');
    const legacy = { businessId: 'owner', window: 123, count: 7 };
    fake.records.set(legacyKey, legacy);
    expect((await limit(fake.db, 'owner')).allowed).toBe(true);
    expect(fake.records.get(legacyKey)).toEqual(legacy); expect(fake.records.size).toBe(2);
  });
  it('does not reset an existing owner when the bounded memory map is full', async () => {
    const fake = database(); const limit = createOwnerReadLimiter(() => 60_100);
    await limit(fake.db, 'first');
    for (let i = 0; i < 999; i++) await limit(fake.db, `owner-${i}`);
    for (let i = 0; i < 11; i++) expect((await limit(fake.db, 'first')).allowed).toBe(true);
    expect((await limit(fake.db, 'first')).allowed).toBe(false);
  });
  it('returns explicit 503 on storage failure and limits repeated attempts locally', async () => {
    const fake = database(); fake.fail(); const limit = createOwnerReadLimiter(() => 60_100);
    for (let i = 0; i < 12; i++) expect((await limit(fake.db, 'owner')).status).toBe(503);
    expect((await limit(fake.db, 'owner')).status).toBe(429);
  });
  it('fails closed for corrupt persistent state rather than resetting it', async () => {
    const fake = database(); const limit = createOwnerReadLimiter(() => 60_100); await limit(fake.db, 'owner');
    [...fake.records.values()][0].count = -1;
    expect((await limit(fake.db, 'owner')).status).toBe(503);
  });
  it('keeps retry headers and error shape for 429 and 503, never a success payload', async () => {
    for (const status of [429, 503] as const) {
      const response = ownerReadRateLimitResponse({ allowed: false, status, retryAfterSeconds: 15 });
      expect(response.status).toBe(status); expect(response.headers.get('Retry-After')).toBe('15');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ error: expect.any(String), code: expect.any(String) });
    }
    expect(() => ownerReadRateLimitResponse({ allowed: true, status: 200, retryAfterSeconds: 0 })).toThrow();
  });
});
