import { describe, expect, it } from 'vitest';
import { DELETE, PATCH, POST } from '@/app/api/owner/canchas/route';
import { DELETE as deleteService, POST as createService } from '@/app/api/owner/services/route';

function request(method: string, body: unknown, authorized = false) {
  return new Request('https://pediturno.test/api/owner/canchas', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { authorization: 'Bearer synthetic-token' } : {}),
    },
    body: JSON.stringify(body),
  }) as any;
}

const validCancha = { name: 'Cancha 1', price: '3500', duration: 60, status: 'Pausado' };

describe('owner cancha route', () => {
  it('rejects malformed schemas before any authenticated write', async () => {
    expect((await POST(request('POST', { ...validCancha, businessId: 'forged' }))).status).toBe(400);
    expect((await PATCH(request('PATCH', { canchaId: 'cancha_1', status: 'Borrado' }))).status).toBe(400);
    expect((await DELETE(request('DELETE', { canchaId: 'cancha_1', extra: true }))).status).toBe(400);
  });

  it('requires a bearer token for otherwise valid mutations', async () => {
    expect((await POST(request('POST', validCancha))).status).toBe(401);
    expect((await PATCH(request('PATCH', { canchaId: 'cancha_1', status: 'Pausado' }))).status).toBe(401);
    expect((await DELETE(request('DELETE', { canchaId: 'cancha_1' }))).status).toBe(401);
  });

  it('applies the same strict authentication boundary to services', async () => {
    const validService = { name: 'Corte', price: '2500', duration: '30', status: 'Pausado' };
    expect((await createService(request('POST', { ...validService, businessId: 'forged' }))).status).toBe(400);
    expect((await createService(request('POST', validService))).status).toBe(401);
    expect((await deleteService(request('DELETE', { serviceId: 'service_1' }))).status).toBe(401);
  });
});
