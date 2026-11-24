import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyIdToken, getAdminFirestore } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getAdminFirestore: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: vi.fn(() => 'server-time'), increment: vi.fn((value: number) => value) },
  Timestamp: class Timestamp {
    static fromDate = vi.fn((value: Date) => value);
  },
}));

import { POST as createAppointment } from '@/app/api/owner/appointments/route';
import { POST as updateAppointmentStatus } from '@/app/api/owner/appointments/[appointmentId]/status/route';
import { POST as rescheduleAppointment } from '@/app/api/owner/appointments/[appointmentId]/reschedule/route';
import { canTransitionAppointmentStatus } from '@/lib/appointment-state';

function request(body: unknown, authorization?: string) {
  return new Request('https://pediturno.test/api/owner/appointments', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
  }) as any;
}

describe('owner appointment routes', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('does not read or write without an owner bearer token', async () => {
    expect((await createAppointment(request({}))).status).toBe(400);
    expect((await updateAppointmentStatus(request({ status: 'Cancelado' }), { params: { appointmentId: 'appointment_1' } })).status).toBe(401);
    expect((await rescheduleAppointment(request({ dateKey: '2026-10-01', time: '10:00' }), { params: { appointmentId: 'appointment_1' } })).status).toBe(401);
  });

  it('still requires owner authentication when a manual appointment has no email', async () => {
    const response = await createAppointment(request({ client: 'Cliente QA', clientPhone: '11111111', clientEmail: '', serviceId: 'service_1', dateKey: '2026-12-01', time: '10:00', status: 'Confirmado' }));
    expect(response.status).toBe(401);
    expect(getAdminFirestore).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, {}, 'invalid', 'a@', '   ', 'a'.repeat(255)])('rejects a malformed optional email without database access: %j', async (clientEmail) => {
    const response = await createAppointment(request({ client: 'Cliente QA', clientPhone: '11111111', clientEmail, serviceId: 'service_1', dateKey: '2026-12-01', time: '10:00', status: 'Confirmado' }, 'Bearer synthetic'));
    expect(response.status).toBe(400);
    expect(getAdminFirestore).not.toHaveBeenCalled();
  });

  it('does not let an expired owner mutate an appointment through the server route', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_1' });
    const update = vi.fn();
    const db = {
      collection: vi.fn((name: string) => ({ doc: vi.fn((id: string) => ({ name, id })) })),
      runTransaction: vi.fn(async (callback: (transaction: { get: (ref: { name: string }) => Promise<unknown>; update: typeof update }) => Promise<unknown>) => callback({
        get: vi.fn(async (ref: { name: string }) => ref.name === 'appointments'
          ? { data: () => ({ businessId: 'owner_1', status: 'Confirmado', bookingSlotIds: [] }) }
          : { data: () => ({ status: 'active', businessType: 'sports_facility', membership: { type: 'pro', expiresAt: { toMillis: () => Date.now() - 1000 } } }) }),
        update,
      })),
    };
    getAdminFirestore.mockReturnValue(db);

    const response = await updateAppointmentStatus(
      request({ status: 'Completado' }, 'Bearer valid-token'),
      { params: Promise.resolve({ appointmentId: 'appointment_1' }) },
    );

    expect(response.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects manual appointments in the past even with an active owner', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    verifyIdToken.mockResolvedValue({ uid: 'owner_1' });
    const db = {
      collection: vi.fn((name: string) => ({ doc: vi.fn(() => ({
        get: vi.fn(async () => ({ data: () => name === 'businesses'
          ? { status: 'active', membership: { type: 'lifetime' } }
          : { businessId: 'owner_1', status: 'Activo' },
        })),
      })) })),
    };
    getAdminFirestore.mockReturnValue(db);

    const response = await createAppointment(request({
      client: 'Cliente', clientPhone: '11111111', clientEmail: 'client@example.test', serviceId: 'service_1',
      dateKey: '2026-10-01', time: '10:00', status: 'Confirmado',
    }, 'Bearer valid-token'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Appointments cannot be created in the past' });
  });

  it('keeps completed and cancelled appointments terminal server-side', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'owner_1' });
    const update = vi.fn();
    const db = {
      collection: vi.fn((name: string) => ({ doc: vi.fn((id: string) => ({ name, id })) })),
      runTransaction: vi.fn(async (callback: (transaction: { get: (ref: { name: string }) => Promise<unknown>; update: typeof update }) => Promise<unknown>) => callback({
        get: vi.fn(async (ref: { name: string }) => ref.name === 'appointments'
          ? { data: () => ({ businessId: 'owner_1', status: 'Completado', bookingSlotIds: [] }) }
          : { data: () => ({ status: 'active', membership: { type: 'lifetime' } }) }),
        update,
      })),
    };
    getAdminFirestore.mockReturnValue(db);

    const statusResponse = await updateAppointmentStatus(
      request({ status: 'Confirmado' }, 'Bearer valid-token'),
      { params: Promise.resolve({ appointmentId: 'appointment_1' }) },
    );
    const rescheduleResponse = await rescheduleAppointment(
      request({ dateKey: '2026-10-01', time: '10:00' }, 'Bearer valid-token'),
      { params: Promise.resolve({ appointmentId: 'appointment_1' }) },
    );

    expect(statusResponse.status).toBe(409);
    expect(rescheduleResponse.status).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });

  it('allows only lifecycle transitions used by owner workflows', () => {
    expect(canTransitionAppointmentStatus('Pendiente', 'Confirmado')).toBe(true);
    expect(canTransitionAppointmentStatus('Pendiente', 'Completado')).toBe(true);
    expect(canTransitionAppointmentStatus('Confirmado', 'Pendiente')).toBe(false);
    expect(canTransitionAppointmentStatus('Completado', 'Confirmado')).toBe(false);
    expect(canTransitionAppointmentStatus('Cancelado', 'Pendiente')).toBe(false);
  });

  it('preserves a pending status when the owner reschedules it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    verifyIdToken.mockResolvedValue({ uid: 'owner_1' });
    const update = vi.fn();
    const create = vi.fn();
    const sameDay = { kind: 'same-day' };
    const appointments = {
      doc: vi.fn((id: string) => ({ name: 'appointments', id })),
      where: vi.fn(),
      limit: vi.fn(() => sameDay),
    };
    appointments.where.mockReturnValue(appointments);
    const db = {
      collection: vi.fn((name: string) => name === 'appointments'
        ? appointments
        : { doc: vi.fn((id: string) => ({ name, id })) }),
      runTransaction: vi.fn(async (callback: (transaction: { get: (ref: { name?: string; kind?: string }) => Promise<unknown>; update: typeof update; create: typeof create; delete: ReturnType<typeof vi.fn> }) => Promise<unknown>) => callback({
        get: vi.fn(async (ref: { name?: string; kind?: string }) => {
          if (ref.kind === 'same-day') return { size: 0, docs: [] };
          if (ref.name === 'appointments') return { data: () => ({
            businessId: 'owner_1', status: 'Pendiente', serviceId: 'service_1', durationMinutes: 60,
            date: { toDate: () => new Date('2026-10-09T03:00:00.000Z') }, time: '10:00', bookingSlotIds: [],
          }) };
          if (ref.name === 'businesses') return { data: () => ({ status: 'active', membership: { type: 'lifetime' } }) };
          return { data: () => ({ businessId: 'owner_1', status: 'Activo', name: 'Consulta', duration: '60', workingHours: { 4: { slots: [{ start: '09:00', end: '18:00' }] } } }) };
        }),
        update,
        create,
        set: vi.fn(),
        delete: vi.fn(),
      })),
    };
    getAdminFirestore.mockReturnValue(db);

    const response = await rescheduleAppointment(
      request({ dateKey: '2026-10-08', time: '11:00' }, 'Bearer valid-token'),
      { params: Promise.resolve({ appointmentId: 'appointment_1' }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'appointments', id: 'appointment_1' }),
      expect.objectContaining({ status: 'Pendiente', time: '11:00' }),
    );

    const pastResponse = await rescheduleAppointment(
      request({ dateKey: '2026-10-01', time: '11:00' }, 'Bearer valid-token'),
      { params: Promise.resolve({ appointmentId: 'appointment_1' }) },
    );
    expect(pastResponse.status).toBe(400);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
