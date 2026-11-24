import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { uid: 'owner-callsite-qa', getIdToken: vi.fn().mockResolvedValue('fixture-id-token') },
  auth: { currentUser: null as unknown },
}));

vi.mock('@/lib/firebase', () => ({ db: null, storage: null, auth: mocks.auth }));
vi.mock('@/lib/app-check-client', () => ({ publicAppCheckHeaders: vi.fn().mockResolvedValue({}) }));

function requestKey(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>;
}

describe('owner web mutation idempotency callers', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.auth.currentUser = mocks.user;
    mocks.user.getIdToken.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reuses the service creation key after a lost response and rotates it after confirmation', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('lost response after commit'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'service-qa-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'service-qa-2' }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    let data = await import('@/services/data');
    const input = { businessId: 'owner-callsite-qa', name: 'Servicio QA', duration: '30', price: '1000', status: 'Pausado' as const };

    await expect(data.createService(input)).rejects.toThrow('lost response after commit');
    const firstKey = requestKey(fetchMock, 0)['X-Idempotency-Key'];
    vi.resetModules();
    data = await import('@/services/data');
    await expect(data.createService(input)).resolves.toBe('service-qa-1');
    expect(requestKey(fetchMock, 1)['X-Idempotency-Key']).toBe(firstKey);
    await expect(data.createService(input)).resolves.toBe('service-qa-2');
    expect(requestKey(fetchMock, 2)['X-Idempotency-Key']).not.toBe(firstKey);
  });

  it('reuses the appointment creation key after a lost response and rotates it after confirmation', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('lost response after commit'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'appointment-qa-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'appointment-qa-2' }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    let data = await import('@/services/data');
    const input = { businessId: 'owner-callsite-qa', client: 'Cliente QA', clientPhone: '+54 11 1111 1111', clientEmail: 'cliente@example.test', serviceId: 'service-qa', date: new Date(2026, 10, 4), time: '10:00', status: 'Confirmado' as const };

    await expect(data.createAppointment(input)).rejects.toThrow('lost response after commit');
    const firstKey = requestKey(fetchMock, 0)['X-Idempotency-Key'];
    vi.resetModules();
    data = await import('@/services/data');
    await expect(data.createAppointment(input)).resolves.toBe('appointment-qa-1');
    expect(requestKey(fetchMock, 1)['X-Idempotency-Key']).toBe(firstKey);
    await expect(data.createAppointment(input)).resolves.toBe('appointment-qa-2');
    expect(requestKey(fetchMock, 2)['X-Idempotency-Key']).not.toBe(firstKey);
  });
});
