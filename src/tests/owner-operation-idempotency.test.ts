import { describe, expect, it } from 'vitest';
import { clearOwnerOperation, OwnerOperationStorageError, prepareOwnerOperation } from '@/lib/owner-operation-idempotency';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  dump() { return [...this.values.values()].join('\n'); }
}

const payload = { client: 'Ana Cliente', clientEmail: 'ana@example.test', clientPhone: '+54 11 1234-5678', serviceId: 'service-1', dateKey: '2026-11-01', time: '10:00' };

describe('owner operation idempotency', () => {
  it('reuses a pending key after a lost response, including after a fresh module import', async () => {
    const storage = new MemoryStorage();
    const first = await prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-appointment-create', payload, storage, now: 1_000 });
    await vi.resetModules();
    const reloaded = await import('@/lib/owner-operation-idempotency');
    const retry = await reloaded.prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-appointment-create', payload: { ...payload }, storage, now: 2_000 });
    expect(retry).toEqual(first);
  });

  it('separates accounts and canonicalizes equivalent payload key order', async () => {
    const storage = new MemoryStorage();
    const first = await prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-service-create', payload: { name: 'Corte', duration: '30', price: '1000' }, storage, now: 1_000 });
    const reordered = await prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-service-create', payload: { price: '1000', name: 'Corte', duration: '30' }, storage, now: 2_000 });
    const otherAccount = await prepareOwnerOperation({ uid: 'owner-b', operation: 'owner-service-create', payload: { name: 'Corte', duration: '30', price: '1000' }, storage, now: 2_000 });
    expect(reordered).toEqual(first);
    expect(otherAccount.fingerprint).not.toBe(first.fingerprint);
    expect(otherAccount.key).not.toBe(first.key);
  });

  it('expires pending records after 24 hours and clears only after a confirmed success', async () => {
    const storage = new MemoryStorage();
    const first = await prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-appointment-create', payload, storage, now: 1_000 });
    const expired = await prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-appointment-create', payload, storage, now: 1_000 + 24 * 60 * 60 * 1000 });
    expect(expired.key).not.toBe(first.key);
    clearOwnerOperation(expired, storage, 1_000 + 24 * 60 * 60 * 1000 + 1);
    const intentionalSecondCreate = await prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-appointment-create', payload, storage, now: 1_000 + 24 * 60 * 60 * 1000 + 2 });
    expect(intentionalSecondCreate.key).not.toBe(expired.key);
  });

  it('persists only a hash, random key, and timestamp rather than owner or request data', async () => {
    const storage = new MemoryStorage();
    await prepareOwnerOperation({ uid: 'owner-private', operation: 'owner-appointment-create', payload, storage, now: 1_000 });
    const persisted = storage.dump();
    expect(persisted).not.toContain('owner-private');
    expect(persisted).not.toContain('Ana Cliente');
    expect(persisted).not.toContain('ana@example.test');
    expect(persisted).not.toContain('1234');
    expect(persisted).toMatch(/"fingerprint":"[a-f0-9]{64}"/);
  });

  it('fails closed before a mutation when browser storage cannot be written', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => { throw new Error('blocked'); };
    await expect(prepareOwnerOperation({ uid: 'owner-a', operation: 'owner-service-create', payload, storage, now: 1_000 })).rejects.toBeInstanceOf(OwnerOperationStorageError);
  });
});
