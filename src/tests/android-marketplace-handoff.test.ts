import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ owner: vi.fn(), create: vi.fn() }));
vi.mock('@/lib/android-owner-api', () => ({
  requireAndroidOwner: mocks.owner,
  androidError: (error: string, status: number, code: string) => Response.json({ error, code }, { status }),
}));
import { POST } from '@/app/api/v1/owner/mercadopago/handoff/route';

describe('Android Marketplace server-issued handoff', () => {
  beforeEach(() => {
    mocks.create.mockResolvedValue(undefined);
    mocks.owner.mockResolvedValue({ uid: 'qa-owner', business: { businessType: 'sports_facility' }, db: {
      collection: (name: string) => {
        expect(name).toBe('androidMarketplaceHandoffs');
        return { doc: () => ({ create: mocks.create }) };
      },
    } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does not create a Servicios handoff while online deposits are unavailable', async () => {
    mocks.owner.mockResolvedValue({ uid: 'qa-owner', business: { businessType: 'services' }, db: {} });
    const response = await POST(new NextRequest('https://pediturno.com/api/v1/owner/mercadopago/handoff', { method: 'POST' }));
    expect(response.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['https://0.0.0.0:3000', 'http://localhost:3000', 'https://untrusted.example'])('uses the canonical production URL behind proxy origin %s', async origin => {
    vi.stubEnv('NODE_ENV', 'production');
    const before = Date.now();
    const response = await POST(new NextRequest(origin + '/api/v1/owner/mercadopago/handoff', { method: 'POST' }));
    expect(response.status).toBe(201);
    const payload = await response.json();
    const target = new URL(payload.url);
    expect(target.origin).toBe('https://pediturno.com');
    expect(target.pathname).toBe('/api/auth/mercadopago/native-handoff');
    expect(target.searchParams.get('handoff')).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
    const record = mocks.create.mock.calls[0][0];
    expect(record.ownerId).toBe('qa-owner');
    expect(record.expiresAt.toMillis()).toBeGreaterThanOrEqual(before + 5 * 60000);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('retains loopback origin for the isolated local integration server', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const response = await POST(new NextRequest('http://localhost:3000/api/v1/owner/mercadopago/handoff', { method: 'POST' }));
    expect(new URL((await response.json()).url).origin).toBe('http://localhost:3000');
  });

  it('does not issue a handoff to an unauthenticated caller', async () => {
    mocks.owner.mockRejectedValue({ status: 401, code: 'AUTH_REQUIRED', message: 'Authentication required' });
    const response = await POST(new NextRequest('https://pediturno.com/api/v1/owner/mercadopago/handoff', { method: 'POST' }));
    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
