import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyIdToken, getAdminFirestore, sendWelcomeEmail } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getAdminFirestore: vi.fn(),
  sendWelcomeEmail: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore }));
vi.mock('@/services/email', () => ({ sendWelcomeEmail }));
vi.mock('@/lib/app-check-server', () => ({ verifyPublicAppCheck: vi.fn().mockResolvedValue(true) }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => 'DELETE' },
  Timestamp: {
    now: () => ({ toDate: () => new Date('2026-10-04T12:00:00Z'), toMillis: () => Date.parse('2026-10-04T12:00:00Z') }),
    fromDate: (value: Date) => value,
  },
}));

import { POST } from '@/app/api/business/profile/route';
import { verifyPublicAppCheck } from '@/lib/app-check-server';

function request(body: unknown, host = 'pediturno.com') {
  return new Request(`https://${host}/api/business/profile`, {
    method: 'POST',
    headers: { authorization: 'Bearer valid-token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function database(current: { exists: boolean; data: () => Record<string, unknown> }) {
  const create = vi.fn();
  const update = vi.fn();
  const transaction = { get: vi.fn(async () => current), create, update, set: vi.fn(), delete: vi.fn() };
  const db = {
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: 'owner_1', get: async () => current })) })),
    runTransaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)),
  };
  return { db, create, update };
}

describe('business profile membership boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyPublicAppCheck).mockResolvedValue(true);
    verifyIdToken.mockResolvedValue({ uid: 'owner_1', email: 'owner@example.test', name: 'Owner', email_verified: true });
    sendWelcomeEmail.mockResolvedValue({ success: true });
  });

  it('binds new accounts to the portal hostname', async () => {
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ name: 'Complejo', businessType: 'sports_facility' }, 'canchas.pediturno.com'))).status).toBe(200);
    expect(create.mock.calls[0][1].businessType).toBe('sports_facility');
  });
  it('binds new spaces accounts to the spaces hostname', async () => {
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ name: 'Salón', businessType: 'spaces' }, 'espacios.pediturno.com'))).status).toBe(200);
    expect(create.mock.calls[0][1].businessType).toBe('spaces');
    expect(create.mock.calls[0][1].bookingSettings.appointmentBufferMinutes).toBe(20);
  });
  it('rejects an off-grid global buffer for Spaces', async () => {
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ businessType: 'spaces', bookingSettings: { appointmentBufferMinutes: 15 } }, 'espacios.pediturno.com'))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects choosing a different product in request JSON', async () => {
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ businessType: 'sports_facility' }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('prevents changing a paid product into another product', async () => {
    const { db, update } = database({ exists: true, data: () => ({ status: 'active', businessType: 'services', membership: { type: 'lifetime' } }) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ businessType: 'sports_facility' }))).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects profile mutations for an expired existing business', async () => {
    const current = {
      exists: true,
      data: () => ({ status: 'active', businessType: 'sports_facility', membership: { type: 'pro', expiresAt: { toMillis: () => Date.parse('2026-10-04T11:59:59Z') } } }),
    };
    const { db, create, update } = database(current);
    getAdminFirestore.mockReturnValue(db);

    const response = await POST(request({ name: 'Cambio no permitido' }));

    expect(response.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['owner@example.test', 'admin@example.com'])('rejects unverified %s before granting any entitlement', async (email) => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_1', email, email_verified: false });
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ name: 'Sin verificar' }))).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('bootstraps Services in permanent Gratis', async () => {
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);

    const response = await POST(request({ name: 'Club Nuevo' }));

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][1]).toMatchObject({
      status: 'active',
      membership: { type: 'free' },
    });
  });

  it('persists the verified administrator entitlement instead of only displaying it', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_1', email: 'admin@example.com', email_verified: true });
    const { db, create } = database({ exists: false, data: () => ({}) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ name: 'Admin' }))).status).toBe(200);
    expect(create.mock.calls[0][1].membership).toMatchObject({ type: 'lifetime', expiresAt: null });
  });

  it('does not revive a blocked existing administrator business', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_1', email: 'admin@example.com', email_verified: true });
    const { db, update } = database({ exists: true, data: () => ({ status: 'blocked', membership: { type: 'lifetime' } }) });
    getAdminFirestore.mockReturnValue(db);
    expect((await POST(request({ name: 'Admin' }))).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
