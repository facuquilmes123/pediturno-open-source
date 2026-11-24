import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), register: vi.fn() }));
vi.mock('@/lib/payments/auth', () => ({ requireFirebaseUser: mocks.authenticate }));
vi.mock('@/lib/payments/google-play-membership', () => ({ registerGooglePlayAccount: mocks.register }));
import { POST } from '@/app/api/google-play/account/route';

const request = () => new Request('https://pediturno.test/api/google-play/account', { method: 'POST', headers: { authorization: 'Bearer local-test-credential' } });

describe('Play monthly purchase authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({ uid: 'owner-test' });
    mocks.register.mockResolvedValue({ obfuscatedAccountId: 'opaque-account-hash', purchaseAllowed: true });
    vi.stubEnv('GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID', 'monthly');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns the exact server monthly plan instead of leaving the client to pick the first offer', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ purchaseAllowed: true, basePlanId: 'monthly' });
  });

  it('does not allow initiating a purchase while the commercial plan is unconfigured', async () => {
    vi.stubEnv('GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID', '');
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ purchaseAllowed: false, basePlanId: null });
  });

  it('preserves existing legacy eligibility gates even with a configured plan', async () => {
    mocks.register.mockResolvedValue({ purchaseAllowed: false, reason: 'existing_membership', eligibleAt: '2030-01-01T00:00:00.000Z' });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ purchaseAllowed: false, reason: 'existing_membership', basePlanId: 'monthly' });
  });

  it('separates authentication failure from a storage outage', async () => {
    mocks.authenticate.mockRejectedValueOnce(new Error('invalid credential'));
    expect((await POST(request())).status).toBe(401);
    expect(mocks.register).not.toHaveBeenCalled();
    mocks.register.mockRejectedValueOnce(new Error('unavailable'));
    expect((await POST(request())).status).toBe(503);
  });
});
