import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn(), auth: { currentUser: null as unknown } }));
vi.mock('@/lib/firebase', () => ({ db: null, storage: null, auth: mock.auth }));
import { updateClient } from '@/services/data';
describe('web client saves use transactional owner APIs', () => {
  beforeEach(() => { mock.auth.currentUser = { uid: 'owner', getIdToken: mock.token }; mock.token.mockResolvedValue('synthetic'); vi.stubGlobal('fetch', mock.fetch); });
  afterEach(() => vi.unstubAllGlobals());
  it('sends editable fields only and leaves tenant authority and appointment snapshots on the server', async () => {
    mock.fetch.mockResolvedValue({ ok: true, status: 200 });
    await updateClient('client', { businessId: 'owner', name: 'Synthetic', phone: '111111', avatar: '', lastAppointment: new Date(0) });
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    expect(mock.fetch.mock.calls[0][0]).toBe('/api/v1/owner/clients/client');
    expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({ name: 'Synthetic', phone: '111111', avatar: '' });
  });
  it('materializes a missing legacy client only after an explicit 404', async () => {
    mock.fetch.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce({ ok: true, status: 201 });
    await updateClient('legacy', { name: 'Synthetic', phone: '111111' });
    expect(mock.fetch.mock.calls.map(call => [call[0], call[1].method])).toEqual([
      ['/api/v1/owner/clients/legacy', 'PATCH'], ['/api/v1/owner/clients', 'POST'],
    ]);
  });
  it('does not create another client after denial or an ambiguous network failure', async () => {
    mock.fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(updateClient('client', { name: 'Synthetic', phone: '111111' })).rejects.toThrow(/guardar/);
    expect(mock.fetch).toHaveBeenCalledTimes(1);
    mock.fetch.mockReset().mockRejectedValue(new Error('lost acknowledgement'));
    await expect(updateClient('client', { name: 'Synthetic', phone: '111111' })).rejects.toThrow('lost acknowledgement');
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects cross-tenant input before HTTP and stops a legacy create after account switch', async () => {
    await expect(updateClient('client', { businessId: 'neighbor', name: 'Synthetic' })).rejects.toThrow(/cuenta/);
    expect(mock.fetch).not.toHaveBeenCalled();
    mock.fetch.mockImplementation(async () => { mock.auth.currentUser = { uid: 'neighbor' }; return { ok: false, status: 404 }; });
    await expect(updateClient('client', { name: 'Synthetic', phone: '111111' })).rejects.toThrow(/sesión cambió/);
    expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
});
