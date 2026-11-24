import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({ business: {} as Record<string, unknown>, create: vi.fn(), verify: vi.fn() }));
vi.mock('@/lib/firebase-admin', () => ({
  initializeAdminApp: vi.fn(),
  getAdminFirestore: () => ({
    collection: () => ({ doc: () => ({ id: 'resource-1' }) }),
    runTransaction: async (callback: any) => callback({ get: async () => ({ data: () => mocks.business }), create: mocks.create, update: vi.fn() }),
  }),
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
import { POST as service } from '@/app/api/owner/services/route';
import { POST as cancha } from '@/app/api/owner/canchas/route';

function request(sports = false) {
  return new Request('https://pediturno.com/api/owner/resources', {
    method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'asesoria de marketing', price: '100.000', duration: sports ? 60 : '60', status: 'Pausado' }),
  }) as any;
}

describe('guardado de recursos con importes agrupados', () => {
  beforeEach(() => {
    mocks.verify.mockResolvedValue({ uid: 'owner-1' });
    mocks.business = { status: 'active', businessType: 'services', membership: { type: 'trial', expiresAt: Timestamp.fromMillis(Date.now() + 60000) } };
  });
  it('guarda el valor monetario exacto en servicios y canchas', async () => {
    expect((await service(request())).status).toBe(201);
    expect(mocks.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ price: '100000', businessId: 'owner-1' }));
    mocks.business.businessType = 'sports_facility';
    expect((await cancha(request(true))).status).toBe(201);
    expect(mocks.create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ price: '100000' }));
  });
  it('no escribe cuando la membresia vence y devuelve un rechazo explicito', async () => {
    mocks.business.membership = { type: 'trial', expiresAt: Timestamp.fromMillis(Date.now() - 1000) };
    mocks.business.businessType = 'sports_facility';
    const response = await cancha(request(true));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Active membership required' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
