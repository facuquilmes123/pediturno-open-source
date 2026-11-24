import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn(), delivery: vi.fn(), requests: new Map<string, Record<string, unknown>>(), creates: [] as Array<{ name: string; id: string }>, sequence: 0 }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verifyIdToken }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore: vi.fn() }));
vi.mock('@/lib/booking-capability', () => ({ createBookingCapability: vi.fn(({ appointmentId }: { appointmentId: string }) => ({ token: 'synthetic-capability-token', tokenHash: `cap-${appointmentId}`, capability: { appointmentId, expiresAt: new Date(Date.now() + 60_000) } })) }));
vi.mock('@/lib/booking-outbox', () => ({ createBookingConfirmationOutbox: vi.fn(() => ({ type: 'booking-confirmation' })) }));
vi.mock('@/lib/booking-delivery', () => ({ scheduleBookingDelivery: mocks.delivery }));
vi.mock('@/lib/booking-rate-limit', () => ({ sameBookingConfiguration: vi.fn(() => true) }));

import { getAdminFirestore } from '@/lib/firebase-admin';
import { POST } from '@/app/api/owner/appointments/route';

function futureDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(Date.now() + 3 * 86_400_000));
}

function database() {
  const dateKey = futureDate();
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  const refs = new Map<string, any>();
  const ref = (name: string, id: string) => {
    const key = `${name}/${id}`;
    if (!refs.has(key)) refs.set(key, { name, id, get: vi.fn(async () => ({ data: () => name === 'businesses'
      ? { status: 'active', membership: { type: 'lifetime' }, businessType: 'services', timeZone: 'America/Argentina/Buenos_Aires' }
      : name === 'services' ? { businessId: 'owner-1', status: 'Activo', name: 'Consulta', duration: '60', price: '1000', workingHours: { [day]: { slots: [{ start: '09:00', end: '18:00' }] } } }
        : undefined })) });
    return refs.get(key);
  };
  const appointments = {
    doc: vi.fn((id?: string) => ref('appointments', id || `appointment-${++mocks.sequence}`)),
    where: vi.fn(),
  };
  appointments.where.mockReturnValue(appointments);
  appointments.limit = vi.fn(() => ({ kind: 'nearby' }));
  const clients = { doc: vi.fn((id?: string) => ref('clients', id || `client-${++mocks.sequence}`)), where: vi.fn() };
  clients.where.mockReturnValue(clients);
  clients.limit = vi.fn(() => ({ kind: 'clients' }));
  const collection = vi.fn((name: string) => name === 'appointments' ? appointments : name === 'clients' ? clients : {
    doc: vi.fn((id?: string) => ref(name, id || `${name}-${++mocks.sequence}`)),
  });
  let serial = Promise.resolve();
  return {
    collection,
    runTransaction: vi.fn((callback: (transaction: any) => Promise<unknown>) => {
      const run = serial.then(async () => callback({
        get: vi.fn(async (target: any) => {
          if (target?.kind === 'nearby') return { size: 0, docs: [] };
          if (target?.kind === 'clients') return { size: 0, docs: [] };
          if (target?.name === 'ownerAppointmentRequests') {
            const record = mocks.requests.get(target.id);
            return { exists: !!record, get: (field: string) => record?.[field] };
          }
          if (target?.name === 'businesses') return { exists: true, get: (field: string) => ({ status: 'active', membership: { type: 'lifetime' } } as any)[field], data: () => ({ status: 'active', membership: { type: 'lifetime' }, businessType: 'services' }) };
          if (target?.name === 'services') return { exists: true, get: (field: string) => ({ businessId: 'owner-1', status: 'Activo', name: 'Consulta', duration: '60', bookingRevision: 0 } as any)[field], data: () => ({ businessId: 'owner-1', status: 'Activo', name: 'Consulta', duration: '60', bookingRevision: 0 }) };
          return { exists: false, get: () => undefined, data: () => undefined };
        }),
        create: vi.fn((target: any, data: Record<string, unknown>) => {
          mocks.creates.push({ name: target.name, id: target.id });
          if (target.name === 'ownerAppointmentRequests') mocks.requests.set(target.id, data);
        }),
        set: vi.fn(), update: vi.fn(), delete: vi.fn(),
      }));
      serial = run.then(() => undefined, () => undefined);
      return run;
    }),
  };
}

function request(time = '10:00') {
  return new Request('https://pediturno.test/api/owner/appointments', {
    method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json', 'X-Idempotency-Key': 'android-request-123456' },
    body: JSON.stringify({ client: 'Cliente', clientPhone: '11111111', clientEmail: 'client@example.test', serviceId: 'service-1', dateKey: futureDate(), time, status: 'Confirmado' }),
  }) as any;
}

describe('owner appointment durable idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.requests.clear(); mocks.creates.length = 0; mocks.sequence = 0;
    mocks.verifyIdToken.mockResolvedValue({ uid: 'owner-1' });
    vi.mocked(getAdminFirestore).mockReturnValue(database() as any);
  });

  it('serializes concurrent retries into one appointment and one durable notification outbox', async () => {
    const [first, retry] = await Promise.all([POST(request()), POST(request())]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(await first.json()).toEqual(await retry.json());
    expect(mocks.creates.filter(item => item.name === 'appointments')).toHaveLength(1);
    expect(mocks.creates.filter(item => item.name === 'bookingEmailOutbox')).toHaveLength(1);
    expect(mocks.creates.filter(item => item.name === 'ownerAppointmentRequests')).toHaveLength(1);
    expect(mocks.delivery).toHaveBeenCalledTimes(2);
  });

  it('rejects a changed appointment payload under an already consumed key', async () => {
    await POST(request());
    const response = await POST(request('11:00'));
    expect(response.status).toBe(409);
    expect(mocks.creates.filter(item => item.name === 'appointments')).toHaveLength(1);
  });
});
