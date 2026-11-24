import { beforeEach, describe, expect, it, vi } from 'vitest';
const values = new Map<string, Record<string, unknown>>();
const db = {
  collection: (name: string) => ({ doc: (id: string) => ({ id: `${name}/${id}` }) }),
  runTransaction: async (callback: (tx: { get: (ref: { id: string }) => Promise<{ exists: boolean; get: (key: string) => unknown }>; set: (ref: { id: string }, data: Record<string, unknown>) => void }) => unknown) => callback({ get: async ref => ({ exists: values.has(ref.id), get: key => values.get(ref.id)?.[key] }), set: (ref, data) => values.set(ref.id, data) }),
};
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' }, FieldValue: { serverTimestamp: () => 'time', increment: () => 1 }, Timestamp: { now: () => ({}) } }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => db }));
import { claimGooglePlayVerificationAttempt } from '@/lib/payments/google-play-membership';
describe('Google Play verification rate limit', () => {
  beforeEach(() => values.clear());
  it('blocks a thirteenth distinct token for the same Firebase account before Publisher', async () => {
    for (let i = 0; i < 12; i += 1) await expect(claimGooglePlayVerificationAttempt('owner-a', `token-${i}`)).resolves.toBe(true);
    await expect(claimGooglePlayVerificationAttempt('owner-a', 'new-rotated-token')).resolves.toBe(false);
  });
});
