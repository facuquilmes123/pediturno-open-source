import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/public/payment-availability/route';

afterEach(() => vi.unstubAllEnvs());

describe('public payment availability', () => {
  it('fails closed unless the server switch and required reconciliation config are present', async () => {
    vi.stubEnv('MP_PAYMENTS_ENABLED', 'false');
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-token');
    vi.stubEnv('MP_WEBHOOK_SECRET', 'synthetic-secret');
    vi.stubEnv('MP_PLATFORM_APPLICATION_ID', '12345');
    expect(await (await GET()).json()).toEqual({ enabled: false });

    vi.stubEnv('MP_PAYMENTS_ENABLED', 'true');
    vi.stubEnv('MP_WEBHOOK_SECRET', '');
    expect(await (await GET()).json()).toEqual({ enabled: false });

    vi.stubEnv('MP_WEBHOOK_SECRET', 'synthetic-secret');
    vi.stubEnv('MP_PLATFORM_APPLICATION_ID', 'invalid');
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });

  it('reports only availability and forbids caches when fully configured', async () => {
    vi.stubEnv('MP_PAYMENTS_ENABLED', 'true');
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-token');
    vi.stubEnv('MP_WEBHOOK_SECRET', 'synthetic-secret');
    vi.stubEnv('MP_PLATFORM_APPLICATION_ID', '12345');

    const response = await GET();
    expect(await response.json()).toEqual({ enabled: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
