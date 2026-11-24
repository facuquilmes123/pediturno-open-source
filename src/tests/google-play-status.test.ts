import { beforeEach, describe, expect, it, vi } from 'vitest';
const businessGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => ({ collection: () => ({ doc: () => ({ get: businessGet }) }) }) }));
import { googlePlayStatusForUser } from '@/lib/payments/google-play-membership';
const expires = { toDate: () => new Date('2030-01-01T00:00:00.000Z') };
const valid = { type: 'pro', source: 'GOOGLE_PLAY', vertical: 'services', productId: 'pediturno_servicios_pro_monthly', purchaseHash: 'a'.repeat(64), status: 'active', expiresAt: expires, autoRenewEnabled: true, acknowledgementState: 'acknowledged' };
describe('Google Play status shape', () => {
  beforeEach(() => { vi.clearAllMocks(); businessGet.mockResolvedValue({ get: () => valid }); });
  it('returns only a complete server-authored entitlement shape', async () => { await expect(googlePlayStatusForUser('owner')).resolves.toMatchObject({ status: 'active', source: 'google_play' }); });
  it.each([{ ...valid, source: 'FORGED' }, { ...valid, productId: 'other' }, { ...valid, purchaseHash: 'not-a-hash' }, { ...valid, vertical: 'spaces' }, { ...valid, status: 'unknown' }])('fails closed for forged shape', async record => { businessGet.mockResolvedValue({ get: () => record }); await expect(googlePlayStatusForUser('owner')).resolves.toBeNull(); });
});
