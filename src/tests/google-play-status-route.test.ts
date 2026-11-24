import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireFirebaseUser: vi.fn(), googlePlayStatusForUser: vi.fn() }));
vi.mock('@/lib/payments/auth', () => ({ requireFirebaseUser: mocks.requireFirebaseUser }));
vi.mock('@/lib/payments/google-play-membership', () => ({ googlePlayStatusForUser: mocks.googlePlayStatusForUser }));
import { GET } from '@/app/api/google-play/status/route';

const request = () => new Request('https://pediturno.test/api/google-play/status', { headers: { authorization: 'Bearer firebase-id-token' } });
describe('Google Play status route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireFirebaseUser.mockResolvedValue({ uid: 'owner-a' }); mocks.googlePlayStatusForUser.mockResolvedValue(null); });
  it('returns 401 only when Firebase authentication fails', async () => { mocks.requireFirebaseUser.mockRejectedValue(new Error('invalid token')); expect((await GET(request())).status).toBe(401); });
  it('returns 503 when entitlement storage cannot be read after authentication', async () => { mocks.googlePlayStatusForUser.mockRejectedValue(new Error('Firestore unavailable')); expect((await GET(request())).status).toBe(503); });
});
