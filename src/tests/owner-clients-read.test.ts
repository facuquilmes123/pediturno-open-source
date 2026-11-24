import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ auth: { currentUser: null as any }, fetch: vi.fn(), token: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: mock.auth }));
import { readOwnerClients } from '@/lib/owner-clients-read';
const row = (id: string) => ({ id, name: id, phone: '1100000000', lastAppointment: null });
const page = (clients: any[], nextCursor: string | null = null) => ({ ok: true, status: 200, json: async () => ({ clients, nextCursor }) });
describe('owner directory read admission and complete pagination', () => {
  beforeEach(() => { mock.auth.currentUser = { uid: 'owner', getIdToken: mock.token }; mock.token.mockResolvedValue('qa'); vi.stubGlobal('fetch', mock.fetch); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('reads 1301 clients without truncation and restores the legacy sort/date shape', async () => {
    for (let i = 0; i < 14; i++) mock.fetch.mockResolvedValueOnce(page(Array.from({ length: i === 13 ? 1 : 100 }, (_, j) => row(`c${i * 100 + j}`)), i === 13 ? null : `cursor${i}`));
    const result = await readOwnerClients('owner'); expect(result).toHaveLength(1301); expect(mock.fetch).toHaveBeenCalledTimes(14);
    expect(result.every(c => c.businessId === 'owner' && c.lastAppointment === null)).toBe(true);
    expect(mock.fetch.mock.calls[1][0]).toContain('cursor=cursor0');
  });
  it('resumes the same page after bounded 429 and sorts latest appointment first', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    mock.fetch.mockResolvedValueOnce({ status: 429, headers: new Headers({ 'Retry-After': '1' }), body: { cancel } })
      .mockResolvedValueOnce(page([row('old'), { ...row('recent'), lastAppointment: '2026-11-03T10:00:00Z' }]));
    const pending = readOwnerClients('owner'); await vi.runAllTimersAsync(); const result = await pending;
    expect(cancel).toHaveBeenCalled(); expect(mock.fetch.mock.calls[0][0]).toBe(mock.fetch.mock.calls[1][0]);
    expect(result[0].id).toBe('recent'); expect(result[0].lastAppointment).toBeInstanceOf(Date);
  });
  it('does not return partial lists after a later denial', async () => {
    mock.fetch.mockResolvedValueOnce(page([row('a')], 'a')).mockResolvedValueOnce({ status: 403, ok: false });
    await expect(readOwnerClients('owner')).rejects.toThrow(/completo/);
  });
  it('rejects another owner before fetch and discards a response after a session change', async () => {
    await expect(readOwnerClients('neighbor')).rejects.toThrow(/sesión/); expect(mock.fetch).not.toHaveBeenCalled();
    mock.fetch.mockImplementation(async () => { mock.auth.currentUser = { uid: 'neighbor' }; return page([row('a')]); });
    await expect(readOwnerClients('owner')).rejects.toThrow(/sesión/); expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects repeating cursors and duplicate rows', async () => {
    mock.fetch.mockResolvedValueOnce(page([row('a')], 'a')).mockResolvedValueOnce(page([row('b')], 'a'));
    await expect(readOwnerClients('owner')).rejects.toThrow(/Paginación/);
    mock.fetch.mockReset().mockResolvedValueOnce(page([row('a')], 'a')).mockResolvedValueOnce(page([row('a')]));
    await expect(readOwnerClients('owner')).rejects.toThrow(/inválida/);
  });
  it('does not retry network failures or a wait exceeding 60 seconds', async () => {
    mock.fetch.mockRejectedValueOnce(new Error('network')); await expect(readOwnerClients('owner')).rejects.toThrow('network');
    mock.fetch.mockReset().mockResolvedValueOnce({ status: 429, headers: new Headers({ 'Retry-After': '61' }) });
    await expect(readOwnerClients('owner')).rejects.toThrow(/ocupado/); expect(mock.fetch).toHaveBeenCalledTimes(1);
  });
});
