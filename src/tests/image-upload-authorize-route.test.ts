import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ owner: vi.fn(), admit: vi.fn(), attest: vi.fn(), issue: vi.fn() }));
vi.mock('@/lib/android-owner-api', async original => ({ ...await original<typeof import('@/lib/android-owner-api')>(), requireAndroidOwner: mock.owner }));
vi.mock('@/lib/owner-read-rate-limit', async original => ({ ...await original<typeof import('@/lib/owner-read-rate-limit')>(), checkOwnerReadRateLimit: mock.admit }));
vi.mock('@/lib/app-check-server', () => ({ verifyPublicAppCheck: mock.attest }));
vi.mock('@/lib/image-upload-permits', async original => ({ ...await original<typeof import('@/lib/image-upload-permits')>(), authorizeImageUpload: mock.issue }));
import { AndroidOwnerApiError } from '@/lib/android-owner-api';
import { POST } from '@/app/api/owner/images/authorize/route';
const input = { category: 'logos', contentType: 'image/jpeg', byteSize: 50 };
function request(body: unknown = input, key = 'synthetic_operation_key') {
  return new NextRequest('https://qa.invalid/api/owner/images/authorize', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Idempotency-Key': key }, body: JSON.stringify(body) });
}
describe('image permit HTTP admission', () => {
  beforeEach(() => {
    mock.owner.mockResolvedValue({ uid: 'verified-owner', db: 'synthetic-db' });
    mock.admit.mockResolvedValue({ allowed: true }); mock.attest.mockResolvedValue(true);
    mock.issue.mockResolvedValue({ permitId: 'a'.repeat(64), repeated: false });
  });
  it('uses only verified ownership and consumes the one-use attestation', async () => {
    const result = await POST(request());
    expect(result.status).toBe(201); expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(mock.issue).toHaveBeenCalledWith('synthetic-db', 'verified-owner', 'synthetic_operation_key', input);
    expect(mock.attest).toHaveBeenCalledWith(expect.any(NextRequest), { consume: true });
  });
  it('returns 200 for an already-issued identical request', async () => {
    mock.issue.mockResolvedValue({ repeated: true }); expect((await POST(request())).status).toBe(200);
  });
  it('rejects caller scope and malformed or missing idempotency before issuing anything', async () => {
    expect((await POST(request({ ...input, businessId: 'neighbor' }))).status).toBe(400);
    expect((await POST(request(input, 'short'))).status).toBe(400);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it('rejects missing application attestation without an upload receipt', async () => {
    mock.attest.mockResolvedValue(false); expect((await POST(request())).status).toBe(403);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it('returns the bounded admission retry interval and performs no later work', async () => {
    mock.admit.mockResolvedValue({ allowed: false, status: 429, retryAfterSeconds: 5 });
    const result = await POST(request()); expect(result.status).toBe(429); expect(result.headers.get('Retry-After')).toBe('5');
    expect(mock.attest).not.toHaveBeenCalled(); expect(mock.issue).not.toHaveBeenCalled();
  });
  it('does not disclose authentication/provider details or grant access after verifier failure', async () => {
    mock.owner.mockRejectedValue(new AndroidOwnerApiError(401, 'AUTH_REQUIRED', 'Authentication required'));
    expect((await POST(request())).status).toBe(401);
    mock.owner.mockRejectedValue(new Error('secret provider detail'));
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret provider detail'); expect(mock.issue).not.toHaveBeenCalled();
  });
});
