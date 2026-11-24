import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  getDoc: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn(), optimizeImage: vi.fn(),
  getIdToken: vi.fn(), fetch: vi.fn(),
  auth: { currentUser: { uid: 'owner' } as { uid: string; getIdToken?: () => Promise<string> } | null },
}));
vi.mock('@/lib/firebase', () => ({ db: {}, storage: {}, auth: mocks.auth }));
vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(), doc: vi.fn(), getDoc: mocks.getDoc,
}));
vi.mock('firebase/storage', () => ({ ref: (_store: unknown, path: string) => path, uploadBytes: mocks.uploadBytes, getDownloadURL: mocks.getDownloadURL, deleteObject: vi.fn() }));
vi.mock('@/lib/app-check-client', () => ({ publicAppCheckHeaders: async () => ({ 'X-Firebase-AppCheck': 'synthetic' }) }));
vi.mock('@/lib/image-utils', () => ({ optimizeImage: mocks.optimizeImage }));
vi.mock('@/lib/owner-workspace-client', () => ({
  readOwnerProfile: async () => { const snapshot = await mocks.getDoc(); return snapshot.exists() ? snapshot.data() : null; },
}));
import { uploadFile } from '@/services/data';

describe('image upload boundary', () => {
  const input = () => new File(['photo'], 'photo.png', { type: 'image/png' });
  beforeEach(() => {
    mocks.auth.currentUser = { uid: 'owner', getIdToken: mocks.getIdToken };
    mocks.getIdToken.mockResolvedValue('synthetic');
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const ext = body.contentType === 'image/jpeg' ? 'jpg' : body.contentType.split('/')[1];
      return { ok: true, json: async () => ({ permitId: 'a'.repeat(64), storagePath: `businesses/owner/${body.category}/g_${'a'.repeat(64)}.${ext}`, expiresAt: new Date(Date.now() + 600000).toISOString() }) };
    });
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active', membership: { type: 'lifetime' } }) });
    mocks.optimizeImage.mockResolvedValue({ blob: new Blob(['optimized'], { type: 'image/webp' }) });
    mocks.uploadBytes.mockResolvedValue({ ref: 'uploaded' });
    mocks.getDownloadURL.mockResolvedValue('https://example.test/image');
  });
  it('uploads the optimized raster under the authenticated owner path', async () => {
    await expect(uploadFile(input(), 'services')).resolves.toBe('https://example.test/image');
    expect(mocks.uploadBytes.mock.calls[0][0]).toMatch(/^businesses\/owner\/services\/.+\.webp$/);
    expect(mocks.uploadBytes.mock.calls[0][1].type).toBe('image/webp');
    expect(mocks.optimizeImage).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ maxWidth: 1000, maxHeight: 1000 }));
  });
  it('rejects expired non-services memberships with an actionable message before uploading', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active', businessType: 'sports_facility', membership: { type: 'trial', expiresAt: new Date(0) } }) });
    await expect(uploadFile(input(), 'logos')).rejects.toThrow(/membresía/);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
  it('does not upload an original that failed to decode or optimize', async () => {
    mocks.optimizeImage.mockRejectedValue(new Error('Imagen dañada'));
    await expect(uploadFile(input(), 'services')).rejects.toThrow('Imagen dañada');
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
  it('rejects oversized output even if client compression returned it', async () => {
    mocks.optimizeImage.mockResolvedValue({ blob: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/webp' }) });
    await expect(uploadFile(input(), 'canchas')).rejects.toThrow(/2 MB/);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
  it('keeps storage authorization errors actionable without exposing provider details', async () => {
    mocks.uploadBytes.mockRejectedValue({ code: 'storage/unauthorized', message: 'private provider detail' });
    await expect(uploadFile(input(), 'logos')).rejects.toThrow(/membresía/);
  });
  it('allows operational Servicios Gratis without inventing a paid photo requirement', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ status: 'active', businessType: 'services' }) });
    await expect(uploadFile(input(), 'services')).resolves.toBe('https://example.test/image');
  });
  it('stops before uploading if the account changes during compression', async () => {
    mocks.optimizeImage.mockImplementation(async () => {
      mocks.auth.currentUser = { uid: 'other-owner' };
      return { blob: new Blob(['optimized'], { type: 'image/webp' }) };
    });
    await expect(uploadFile(input(), 'services')).rejects.toThrow(/sesión cambió/);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
  it('does not resolve the download token after logout during upload', async () => {
    mocks.uploadBytes.mockImplementation(async () => { mocks.auth.currentUser = null; return { ref: 'uploaded' }; });
    await expect(uploadFile(input(), 'services')).rejects.toThrow(/sesión cambió/);
    expect(mocks.getDownloadURL).not.toHaveBeenCalled();
  });
  it('does not return another account an image URL after the lookup completes', async () => {
    mocks.getDownloadURL.mockImplementation(async () => { mocks.auth.currentUser = { uid: 'other-owner' }; return 'https://example.test/old-owner-image'; });
    await expect(uploadFile(input(), 'services')).rejects.toThrow(/sesión cambió/);
  });
  it('sends only compressed size/type/category and attaches the returned receipt to Storage', async () => {
    await uploadFile(input(), 'logos');
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toBe('/api/owner/images/authorize');
    expect(JSON.parse(init.body)).toEqual({ category: 'logos', contentType: 'image/webp', byteSize: 9 });
    expect(mocks.uploadBytes.mock.calls[0][2]).toEqual({ contentType: 'image/webp', customMetadata: { imagePermitId: 'a'.repeat(64) } });
  });
  it('does not fall back to an unrestricted Storage upload when the server denies a permit', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(uploadFile(input(), 'logos')).rejects.toThrow(/límite temporal/);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
  it('rejects a returned path for another account or an expired permit before upload', async () => {
    for (const storagePath of ['businesses/other/logos/g_' + 'a'.repeat(64) + '.webp', 'businesses/owner/logos/unguarded.webp']) {
      mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ permitId: 'a'.repeat(64), storagePath, expiresAt: new Date(Date.now() + 600000).toISOString() }) });
      await expect(uploadFile(input(), 'logos')).rejects.toThrow(/permiso/);
    }
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ permitId: 'a'.repeat(64), storagePath: 'businesses/owner/logos/g_' + 'a'.repeat(64) + '.webp', expiresAt: new Date(0).toISOString() }) });
    await expect(uploadFile(input(), 'logos')).rejects.toThrow(/permiso/);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });
  it('stops after authorization if the session changes during the request', async () => {
    mocks.fetch.mockImplementation(async () => { mocks.auth.currentUser = { uid: 'other' }; return { ok: true }; });
    await expect(uploadFile(input(), 'logos')).rejects.toThrow(/sesión cambió/);
    expect(mocks.uploadBytes).not.toHaveBeenCalled();
  });

});
