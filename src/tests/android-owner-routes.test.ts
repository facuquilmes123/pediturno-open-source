import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn(), appointmentWhere: vi.fn(), appointmentStartAfter: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore: mocks.db }));

vi.mock('@/lib/owner-read-rate-limit', async original => ({...await original<typeof import('@/lib/owner-read-rate-limit')>(), checkOwnerReadRateLimit: vi.fn(async()=>({allowed:true,status:200,retryAfterSeconds:0}))}));

import { GET as bootstrap } from '@/app/api/v1/owner/bootstrap/route';
import { GET as agenda } from '@/app/api/v1/owner/agenda/route';

function business() {
  return { status: 'active', name: 'Servicios', email: 'owner@example.test', membership: { type: 'lifetime' }, timeZone: 'America/Argentina/Buenos_Aires' };
}

function db(options: { agendaDocs?: Array<{ id: string; data: () => Record<string, unknown> }> } = {}) {
  let afterIndex = -1;
  let pageLimit = 100;
  const appointments: any = {
    where: vi.fn(),
  };
  appointments.where.mockImplementation((field: string, operation: string, value: unknown) => {
    if (field === 'businessId') {
      afterIndex = -1;
      mocks.appointmentWhere(field, operation, value);
    }
    return appointments;
  });
  appointments.orderBy = vi.fn(() => appointments);
  appointments.startAfter = mocks.appointmentStartAfter.mockImplementation((_date: unknown, id: string) => {
    afterIndex = options.agendaDocs?.findIndex(item => item.id === id) ?? -1;
    return appointments;
  });
  appointments.limit = vi.fn((count: number) => { pageLimit = count; return appointments; });
  appointments.get = vi.fn(async () => {
    const docs = (options.agendaDocs || []).slice(afterIndex + 1, afterIndex + 1 + pageLimit);
    return { size: docs.length, docs };
  });
  return {
    collection: vi.fn((name: string) => {
      if (name === 'businesses') return { doc: vi.fn((id: string) => ({ get: vi.fn(async () => ({ data: () => id === 'owner-1' ? business() : undefined })) })) };
      if (name === 'appointments') return {
        ...appointments,
        doc: vi.fn((id: string) => ({
          get: vi.fn(async () => {
            const item = options.agendaDocs?.find(candidate => candidate.id === id);
            return { id, exists: Boolean(item), data: item?.data, get: (field: string) => item?.data()[field] };
          }),
        })),
      };
      return { where: vi.fn(() => ({ limit: vi.fn(() => ({ get: vi.fn(async () => ({ size: 0, docs: [] })) })) })) };
    }),
  };
}

describe('Android owner routes', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue({ uid: 'owner-1' }); mocks.db.mockReturnValue(db()); });

  it('rejects bootstrap before any business data is read when bearer authentication is absent', async () => {
    const response = await bootstrap(new Request('https://pediturno.test/api/v1/owner/bootstrap') as any);
    expect(response.status).toBe(401);
    expect(mocks.db).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('derives agenda scope from the verified uid rather than request-controlled identifiers', async () => {
    const response = await agenda(new NextRequest('https://pediturno.test/api/v1/owner/agenda?date=2030-06-03&businessId=another-owner', { headers: { authorization: 'Bearer fixture' } }));
    expect(response.status).toBe(200);
    expect(mocks.appointmentWhere).toHaveBeenCalledWith('businessId', '==', 'owner-1');
    await expect(response.json()).resolves.toMatchObject({ date: '2030-06-03', appointments: [] });
  });

  it('rejects a malformed agenda cursor before querying an appointment document', async () => {
    const response = await agenda(new NextRequest('https://pediturno.test/api/v1/owner/agenda?date=2030-06-03&cursor=not-a-cursor', { headers: { authorization: 'Bearer fixture' } }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it.each([
    { owner: 'another-owner', date: '2030-06-03T12:00:00.000Z' },
    { owner: 'owner-1', date: '2030-06-04T12:00:00.000Z' },
  ])('rejects a cursor from a different tenant or day: $owner / $date', async fixture => {
    const id = 'cursor-private-appointment';
    mocks.db.mockReturnValue(db({ agendaDocs: [{
      id, data: () => ({ businessId: fixture.owner, date: Timestamp.fromDate(new Date(fixture.date)), time: '10:00' }),
    }] }));
    const cursor = Buffer.from(JSON.stringify({ id })).toString('base64url');
    const response = await agenda(new NextRequest(`https://pediturno.test/api/v1/owner/agenda?date=2030-06-03&cursor=${cursor}`, { headers: { authorization: 'Bearer fixture' } }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(mocks.appointmentStartAfter).not.toHaveBeenCalled();
  });

  it('returns a bounded agenda page and uses a validated opaque cursor for the next page', async () => {
    const timestamp = Timestamp.fromDate(new Date('2030-06-03T12:00:00.000Z'));
    const agendaDocs = Array.from({ length: 101 }, (_, index) => ({
      id: `appointment-${String(index).padStart(3, '0')}`,
      data: () => ({ businessId: 'owner-1', date: timestamp, time: `09:${String(index % 60).padStart(2, '0')}` }),
    }));
    mocks.db.mockReturnValue(db({ agendaDocs }));

    const first = await agenda(new NextRequest('https://pediturno.test/api/v1/owner/agenda?date=2030-06-03&limit=100', { headers: { authorization: 'Bearer fixture' } }));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { appointments: unknown[]; nextCursor: string | null };
    expect(firstBody.appointments).toHaveLength(100);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await agenda(new NextRequest(`https://pediturno.test/api/v1/owner/agenda?date=2030-06-03&cursor=${encodeURIComponent(firstBody.nextCursor!)}`, { headers: { authorization: 'Bearer fixture' } }));
    expect(second.status).toBe(200);
    expect(mocks.appointmentStartAfter).toHaveBeenCalledWith(timestamp, 'appointment-099');
    await expect(second.json()).resolves.toMatchObject({ appointments: [expect.objectContaining({ id: 'appointment-100' })], nextCursor: null });
  });
});
