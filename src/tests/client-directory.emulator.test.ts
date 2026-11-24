// @vitest-environment node
// Real route and persistence; explicitly synthetic session verification.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
const source = vi.hoisted(() => ({ auth: { currentUser: null as any }, owner: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: null, storage: null, auth: source.auth }));
vi.mock('@/lib/android-owner-api', async original => ({
  ...(await original<typeof import('@/lib/android-owner-api')>()), requireAndroidOwner: source.owner,
}));
import { GET } from '@/app/api/v1/owner/clients/route';
import { getClients } from '@/services/data';
const owner = 'directory-web-owner', projectId = 'demo-pediturno-p103';
const db = new Firestore({ projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
beforeAll(async () => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || process.env.GOOGLE_CLOUD_PROJECT !== projectId) throw Error('Own loopback demo emulator required');
  source.auth.currentUser = { uid: owner, getIdToken: async () => 'synthetic-web-session' };
  source.owner.mockResolvedValue({ uid: owner, db, business: { status: 'active', businessType: 'canchas' } });
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => GET(new NextRequest('https://qa.invalid' + url, options)));
  await db.doc('clients/web-manual-missing').set({ businessId: owner, name: 'Ana sin turno', phone: '111111' });
  await db.doc('clients/web-manual-null').set({ businessId: owner, name: 'Zoe sin turno', phone: '222222', lastAppointment: null });
  await db.doc('clients/web-dated').set({ businessId: owner, name: 'Cliente con turno', phone: '333333', lastAppointment: Timestamp.fromMillis(100000) });
  await db.doc('clients/web-other').set({ businessId: 'other-web-owner', name: 'No pertenece', phone: '444444' });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') && process.env.GOOGLE_CLOUD_PROJECT === projectId) {
    for (const id of ['web-manual-missing', 'web-manual-null', 'web-dated', 'web-other']) await db.doc('clients/' + id).delete();
    await db.doc('bookingRateLimits/owner-read-v1_' + createHash('sha256').update(owner).digest('hex')).delete();
  }
  await db.terminate();
});
it('web reads manual, dated and legacy clients through the gated API without a neighboring tenant', async () => {
  source.owner.mockResolvedValue({ uid: owner, db, business: { status: 'active', businessType: 'canchas' } });
  const clients = await getClients(owner);
  expect(clients.map(client => client.id)).toEqual(['web-dated', 'web-manual-missing', 'web-manual-null']);
  expect(clients[0].lastAppointment).toEqual(new Date(100000));
  expect(clients[1].lastAppointment).toBeNull(); expect(clients[2].lastAppointment).toBeNull();
  expect(source.owner).toHaveBeenCalledWith(expect.anything(), { allowOtherBusinessTypes: true });
});
