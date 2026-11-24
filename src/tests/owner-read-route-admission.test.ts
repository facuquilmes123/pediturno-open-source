import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ owner: vi.fn(), gate: vi.fn(), query: vi.fn(), zone: vi.fn() }));
vi.mock('@/lib/android-owner-api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/android-owner-api')>()),
  requireAndroidOwner: mocks.owner, ownerTimeZone: mocks.zone,
  androidError: (error: string, status: number, code: string) => Response.json({ error, code }, { status }),
  androidAppointmentDto: vi.fn(), androidBusinessDto: vi.fn(), androidClientDto: vi.fn(), androidServiceDto: vi.fn(),
}));
vi.mock('@/lib/owner-read-rate-limit', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/owner-read-rate-limit')>()), checkOwnerReadRateLimit: mocks.gate,
}));
import { GET as catalog } from '@/app/api/owner/catalog/route';
import { GET as bootstrap } from '@/app/api/v1/owner/bootstrap/route';
import { GET as dashboard } from '@/app/api/v1/owner/dashboard/route';
import { GET as agenda } from '@/app/api/v1/owner/agenda/route';
import { GET as clients } from '@/app/api/v1/owner/clients/route';
import { GET as services } from '@/app/api/v1/owner/services/route';
import { GET as availability } from '@/app/api/v1/owner/availability/route';
import { GET as history } from '@/app/api/v1/owner/clients/[clientId]/history/route';

const routes: Array<[string, (request: NextRequest) => Promise<Response>]> = [
  ['catalog', request => { request.nextUrl.searchParams.set('kind', 'services'); return catalog(request); }], ['bootstrap', bootstrap], ['dashboard', dashboard], ['agenda', agenda],
  ['clients', clients], ['services', services], ['availability', availability],
  ['history', request => history(request, { params: Promise.resolve({ clientId: 'qa-client' }) })],
];

describe('Actual heavy read routes: admission after verified owner, before expensive queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.owner.mockResolvedValue({ uid: 'verified-owner', db: { collection: mocks.query }, business: {} });
  });
  for (const [name, handler] of routes) {
    it(`${name}: rejects missing authentication without invoking the counter`, async () => {
      mocks.owner.mockRejectedValue({ status: 401, code: 'AUTH_REQUIRED', message: 'Missing token' });
      expect((await handler(new NextRequest(`https://qa.test/${name}?date=2030-06-03&serviceId=qa-service`))).status).toBe(401);
      expect(mocks.gate).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
    });
    it(`${name}: applies the gate to server UID and returns 429 without data queries`, async () => {
      mocks.gate.mockResolvedValue({ allowed: false, status: 429, retryAfterSeconds: 5 });
      const r = await handler(new NextRequest(`https://qa.test/${name}?date=2030-06-03&serviceId=qa-service&businessId=forged`));
      expect(r.status).toBe(429); expect(r.headers.get('Retry-After')).toBe('5');
      expect(mocks.gate).toHaveBeenCalledWith(expect.any(Object), 'verified-owner');
      expect(mocks.zone).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
    });
    it(`${name}: returns 503 on counter unavailability without stale/empty success`, async () => {
      mocks.gate.mockResolvedValue({ allowed: false, status: 503, retryAfterSeconds: 15 });
      const r = await handler(new NextRequest(`https://qa.test/${name}?date=2030-06-03&serviceId=qa-service`));
      expect(r.status).toBe(503); expect(mocks.query).not.toHaveBeenCalled();
      expect(await r.json()).toMatchObject({ code: 'OWNER_READ_LIMIT_UNAVAILABLE' });
    });
  }
});
