import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ business: {} as Record<string, unknown>, reads: [] as string[] }));
vi.mock('react', async () => ({ ...await vi.importActual('react'), cache: (fn: unknown) => fn }));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: () => ({ collection: (name: string) => {
  const query = { where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: async () => {
    mocks.reads.push(name);
    return name === 'businesses' ? { size: 1, docs: [{ id: 'business-1', data: () => mocks.business }] } : { docs: [] };
  } };
  return query;
} }) }));
import { getPublicBusinessBySlug } from '@/lib/public-business';
describe('public business projection', () => {
  beforeEach(() => { mocks.reads = []; mocks.business = { name: 'Example', status: 'active', businessType: 'services', membership: { type: 'lifetime' }, whatsappNumber: '1112345678', whatsappButtonEnabled: false, accessToken: 'private-fixture' }; });
  it.each([['services', ['businesses', 'services']], ['sports_facility', ['businesses', 'canchas']], ['spaces', ['businesses', 'spaces']], ['hybrid', ['businesses', 'services', 'canchas']]])('reads only the resources of %s', async (type, expected) => {
    mocks.business.businessType = type;
    const view = await getPublicBusinessBySlug('example');
    expect(mocks.reads).toEqual(expected);
    expect(view?.business.whatsappNumber).toBe('');
    expect(view?.business).not.toHaveProperty('accessToken');
  });
  it('does not read resources for an expired sports membership', async () => {
    mocks.business.businessType = 'sports_facility';
    mocks.business.membership = { type: 'trial' };
    expect(await getPublicBusinessBySlug('example')).toBeNull();
    expect(mocks.reads).toEqual(['businesses']);
  });
  it('keeps the public Services page available with a verified Play subscription without exposing billing identifiers', async () => {
    mocks.business.membership = { type: 'trial' };
    mocks.business.googlePlayMembership = {
      type: 'pro', source: 'GOOGLE_PLAY', productId: 'pediturno_servicios_pro_monthly', purchaseHash: 'a'.repeat(64),
      status: 'active', expiresAt: new Date(Date.now() + 86400000),
    };
    const view = await getPublicBusinessBySlug('example');
    expect(view).not.toBeNull();
    expect(view?.business).not.toHaveProperty('googlePlayMembership');
  });
});
