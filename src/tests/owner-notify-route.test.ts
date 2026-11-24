import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyIdToken, getAdminFirestore, sendCancellationEmail, sendReminderEmail } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getAdminFirestore: vi.fn(),
  sendCancellationEmail: vi.fn(),
  sendReminderEmail: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(), delete: vi.fn() },
  Timestamp: { now: vi.fn(), fromDate: vi.fn((value: Date) => value) },
}));
vi.mock('@/lib/booking-capability', () => ({ createBookingCapability: vi.fn() }));
vi.mock('@/lib/booking-outbox', () => ({ createBookingConfirmationOutbox: vi.fn() }));
vi.mock('@/services/email', () => ({ sendCancellationEmail, sendReminderEmail }));

import { POST } from '@/app/api/owner/appointments/notify/route';

function request(body: unknown, authorization?: string) {
  return new Request('https://pediturno.test/api/owner/appointments/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  }) as any;
}

describe('owner appointment notification route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a Firebase bearer token before it reads appointment data', async () => {
    const response = await POST(request({ appointmentId: 'appointment_1', kind: 'confirmation' }));

    expect(response.status).toBe(401);
    expect(getAdminFirestore).not.toHaveBeenCalled();
  });

  it('rejects an appointment that belongs to a different business', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_a' });
    const get = vi.fn()
      .mockResolvedValueOnce({ data: () => ({ businessId: 'owner_b', clientEmail: 'client@example.com' }) })
      .mockResolvedValueOnce({ data: () => ({ name: 'Business A' }) });
    getAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: vi.fn(() => ({ get })) })) });

    const response = await POST(request({ appointmentId: 'appointment_1', kind: 'confirmation' }, 'Bearer token'));

    expect(response.status).toBe(404);
  });

  it('does not queue or send email for an expired sports owner', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_a' });
    const get = vi.fn()
      .mockResolvedValueOnce({ data: () => ({ businessId: 'owner_a', clientEmail: 'client@example.com', status: 'Confirmado' }) })
      .mockResolvedValueOnce({ data: () => ({
        name: 'Business A', status: 'active', businessType: 'sports_facility',
        membership: { type: 'pro', expiresAt: { toMillis: () => Date.now() - 1000 } },
      }) });
    const runTransaction = vi.fn();
    getAdminFirestore.mockReturnValue({ collection: vi.fn(() => ({ doc: vi.fn(() => ({ get })) })), runTransaction });

    const response = await POST(request({ appointmentId: 'appointment_1', kind: 'reminder' }, 'Bearer token'));

    expect(response.status).toBe(403);
    expect(runTransaction).not.toHaveBeenCalled();
    expect(sendReminderEmail).not.toHaveBeenCalled();
    expect(sendCancellationEmail).not.toHaveBeenCalled();
  });
});
