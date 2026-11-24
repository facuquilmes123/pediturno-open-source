import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {},
  OAuth2Client: class { verifyIdToken = verifyIdToken; },
}));

import { assertGooglePlayPackage, GooglePlayConfigurationError, GooglePlayVerificationError, verifyGooglePlayPushOidc } from '@/lib/payments/google-play';

const audience = 'https://pediturno.com/api/google-play/notifications';
const email = 'pediturno-play-rtdn-push@pediturno-app.iam.gserviceaccount.com';
const valid = { iss: 'https://accounts.google.com', email, email_verified: true };

beforeEach(() => {
  vi.stubEnv('GOOGLE_PLAY_RTDN_AUDIENCE', audience);
  vi.stubEnv('GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL', email);
  vi.stubEnv('GOOGLE_PLAY_PACKAGE_NAME', 'com.pediturno.servicios');
  vi.stubEnv('GOOGLE_PLAY_ALLOW_TEST_PACKAGES', 'false');
  verifyIdToken.mockResolvedValue({ getPayload: () => valid });
});

describe('Servicios package isolation', () => {
  it('accepts only the configured production package', () => {
    expect(assertGooglePlayPackage('com.pediturno.servicios')).toBe('com.pediturno.servicios');
  });
  it.each(['com.pediturno.canchas', 'com.pediturno.espacios', 'com.pediturno.servicios.debug'])('rejects %s without a separate explicit test allowlist', packageName => {
    expect(() => assertGooglePlayPackage(packageName)).toThrow(GooglePlayVerificationError);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Google Play push OIDC trust boundary', () => {
  it('passes the configured audience to Google verification before accepting the dedicated identity', async () => {
    await expect(verifyGooglePlayPushOidc('synthetic-test-token')).resolves.toBeUndefined();
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'synthetic-test-token', audience });
  });

  it.each([
    ['another email', { ...valid, email: 'other@pediturno-app.iam.gserviceaccount.com' }],
    ['unverified email', { ...valid, email_verified: false }],
    ['another issuer', { ...valid, iss: 'https://untrusted.example' }],
    ['absent payload', undefined],
  ])('rejects %s after signature verification', async (_label, payload) => {
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });
    await expect(verifyGooglePlayPushOidc('synthetic-test-token')).rejects.toBeInstanceOf(GooglePlayVerificationError);
  });

  it('rejects a token Google rejects for audience, expiry or signature without exposing provider details', async () => {
    verifyIdToken.mockRejectedValue(new Error('synthetic-provider-detail'));
    await expect(verifyGooglePlayPushOidc('synthetic-test-token')).rejects.toThrow('Invalid Pub/Sub push identity.');
  });

  it.each(['GOOGLE_PLAY_RTDN_AUDIENCE', 'GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL'])('fails closed when %s is missing', async key => {
    vi.stubEnv(key, '');
    await expect(verifyGooglePlayPushOidc('synthetic-test-token')).rejects.toBeInstanceOf(GooglePlayConfigurationError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
