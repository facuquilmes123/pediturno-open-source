import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock('@/lib/firebase-admin', () => ({ initializeAdminApp: vi.fn(), getAdminFirestore: mocks.db }));
import { readAndroidOwnerJson } from '@/lib/android-owner-api';
import { POST as service } from '@/app/api/owner/services/route';
import { POST as cancha } from '@/app/api/owner/canchas/route';
import { POST as space } from '@/app/api/owner/spaces/route';

function endlessBody(contentLength?: string) {
  let pulls = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024).fill(32)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new NextRequest('https://qa.test/body', {
    method: 'POST', body: stream, duplex: 'half',
    headers: { 'content-type': 'application/json', ...(contentLength ? { 'content-length': contentLength } : {}) },
  } as RequestInit);
  return { request, stats: () => ({ pulls, cancelled }) };
}

describe('Owner JSON streaming boundaries, including undeclared or false Content-Length', () => {
  it.each([undefined, '1'])('Android rejects a never-ending body early: %s', async contentLength => {
    const fixture = endlessBody(contentLength);
    await expect(readAndroidOwnerJson(fixture.request)).rejects.toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect(fixture.stats()).toEqual({ pulls: 17, cancelled: true });
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
  });
  it('rejects a declared oversized body before pulling any bytes', async () => {
    const fixture = endlessBody('1000000');
    await expect(readAndroidOwnerJson(fixture.request)).rejects.toMatchObject({ status: 413 });
    expect(fixture.stats().pulls).toBe(0);
  });
  for (const [name, handler, maxKiB] of [['services', service, 16], ['canchas', cancha, 16], ['spaces', space, 24]] as const) {
    it.each([undefined, '1'])(`${name} rejects/cancels before authentication or writes: %s`, async contentLength => {
      const fixture = endlessBody(contentLength);
      // Preserve the legacy endpoint's existing 400 contract for invalid input.
      expect((await handler(fixture.request)).status).toBe(400);
      expect(fixture.stats()).toEqual({ pulls: maxKiB + 1, cancelled: true });
      expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.db).not.toHaveBeenCalled();
    });
  }
  it('preserves multibyte UTF8 split across chunks at the exact byte boundary', async () => {
    const expected = { name: 'Peña' }, bytes = new TextEncoder().encode(JSON.stringify(expected));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const value of bytes) controller.enqueue(Uint8Array.of(value));
      controller.close();
    } });
    const request = new Request('https://qa.test/body', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(readAndroidOwnerJson(request, bytes.byteLength)).resolves.toEqual(expected);
  });
  it.each(['[1]', 'null', '{'])('preserves invalid JSON/object rejection: %s', async body => {
    await expect(readAndroidOwnerJson(new Request('https://qa.test', { method: 'POST', body }))).rejects.toMatchObject({ status: 400, code: 'INVALID_REQUEST' });
  });
});
