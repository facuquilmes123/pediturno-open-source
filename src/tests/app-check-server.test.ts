import { afterEach, describe, expect, it, vi } from 'vitest';

const { initializeAdminApp, getAppCheck, verifyToken } = vi.hoisted(() => ({
  initializeAdminApp: vi.fn(() => ({ name: 'admin-app' })),
  getAppCheck: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp }));
vi.mock('firebase-admin/app-check', () => ({
  getAppCheck,
}));

import { verifyPublicAppCheck } from '@/lib/app-check-server';

const priorBypass = process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS;
const priorNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  vi.clearAllMocks();
  if (priorBypass === undefined) delete process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS;
  else process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS = priorBypass;
  process.env.NODE_ENV = priorNodeEnv;
});

function setVerifier() {
  getAppCheck.mockReturnValue({ verifyToken });
}

describe('public App Check verification', () => {
  it('fails closed when the request has no token', async () => {
    delete process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS;
    await expect(verifyPublicAppCheck(new Request('https://pediturno.test/api/public/availability'))).resolves.toBe(false);
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('consumes POST tokens and rejects a replay', async () => {
    setVerifier();
    verifyToken.mockResolvedValue({ alreadyConsumed: false });
    const request = new Request('https://pediturno.test/api/public/bookings', {
      headers: { 'X-Firebase-AppCheck': 'synthetic-token' },
    });
    await expect(verifyPublicAppCheck(request, { consume: true })).resolves.toBe(true);
    expect(verifyToken).toHaveBeenCalledWith('synthetic-token', { consume: true });

    verifyToken.mockResolvedValue({ alreadyConsumed: true });
    await expect(verifyPublicAppCheck(request, { consume: true })).resolves.toBe(false);
  });

  it('allows the explicit bypass only outside production', async () => {
    process.env.ALLOW_INSECURE_PUBLIC_APP_CHECK_BYPASS = 'true';
    process.env.NODE_ENV = 'test';
    await expect(verifyPublicAppCheck(new Request('https://pediturno.test/api/public/bookings'), { consume: true })).resolves.toBe(true);

    process.env.NODE_ENV = 'production';
    setVerifier();
    await expect(verifyPublicAppCheck(new Request('https://pediturno.test/api/public/bookings'), { consume: true })).resolves.toBe(false);
  });
});
