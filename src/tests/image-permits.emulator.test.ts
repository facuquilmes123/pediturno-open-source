// @vitest-environment node
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { authorizeImageUpload, confirmImagePermits, imageUploadInput } from '@/lib/image-upload-permits';
const fixture = vi.hoisted(() => ({ owner: vi.fn() }));
vi.mock('@/lib/android-owner-api', async original => ({ ...await original<typeof import('@/lib/android-owner-api')>(), requireAndroidOwner: fixture.owner }));
import { POST as createClient } from '@/app/api/v1/owner/clients/route';
import { PATCH as patchClient } from '@/app/api/v1/owner/clients/[clientId]/route';

const projectId = 'demo-pediturno-permits';
const bucket = projectId + '.appspot.com';
let db: Firestore; let env: RulesTestEnvironment;
const input = (category = 'logos') => imageUploadInput({ category, contentType: 'image/jpeg', byteSize: 5 });
const image = new Uint8Array([1, 2, 3, 4, 5]);
const metadata = (id: string) => ({ contentType: 'image/jpeg', customMetadata: { imagePermitId: id } });
const url = (path: string) => `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=synthetic`;
describe.runIf(process.env.GOOGLE_CLOUD_PROJECT === projectId)('Receipt-enforced Firestore and Storage emulators', () => {
  beforeAll(async () => {
    // Firestore transaction IDs are Buffers. A jsdom Uint8Array from another
    // realm changes the SDK's transaction-ID dispatch and invalidates this test.
    expect(Buffer.from('synthetic') instanceof Uint8Array).toBe(true);
    for (const value of [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST]) {
      if (!/^127\.0\.0\.1:\d+$/.test(value ?? '')) throw Error('Owned loopback emulators required');
    }
    process.env.FIREBASE_STORAGE_BUCKET = bucket;
    db = new Firestore({ projectId, host: process.env.FIRESTORE_EMULATOR_HOST, ssl: false });
    const [firestoreHost, firestorePort] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
    const [storageHost, storagePort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST!.split(':');
    env = await initializeTestEnvironment({ projectId,
      firestore: { host: firestoreHost, port: Number(firestorePort), rules: fs.readFileSync('firestore.rules', 'utf8') },
      storage: { host: storageHost, port: Number(storagePort), rules: fs.readFileSync('security/storage-permits.rules', 'utf8') },
    });
    await db.doc('businesses/owner').set({ status: 'active', businessType: 'services' });
    await db.doc('businesses/neighbor').set({ status: 'active', businessType: 'services' });
  }, 30_000);
  afterAll(async () => { if (env) await env.cleanup(); if (db) await db.terminate(); });
  it('allows one exact upload and rejects replay, forged ownership, size, type and expired grants', async () => {
    const grant = await authorizeImageUpload(db, 'owner', 'emulator_exact_image_1', input());
    const owner = env.authenticatedContext('owner').storage(`gs://${bucket}`);
    const neighbor = env.authenticatedContext('neighbor').storage(`gs://${bucket}`);
    const target = owner.ref(grant.storagePath);
    await assertFails(neighbor.ref(grant.storagePath).put(image, metadata(grant.permitId)).then(value => value).catch(error => {
      if (error.code === 'storage/unknown') console.error('Synthetic Storage fixture response:', String(error.customData?.serverResponse).slice(0, 2000));
      throw error;
    }));
    await assertFails(target.put(image, metadata('b'.repeat(64))).then(value => value));
    await assertFails(target.put(new Uint8Array(6), metadata(grant.permitId)).then(value => value));
    await assertFails(target.put(image, { ...metadata(grant.permitId), contentType: 'image/png' }).then(value => value));
    await assertFails(owner.ref(grant.storagePath.replace('.jpg', '.png')).put(image, metadata(grant.permitId)).then(value => value));
    await target.put(image, metadata(grant.permitId));
    await assertFails(target.put(image, metadata(grant.permitId)).then(value => value));
    await assertFails(target.delete());
    await assertFails(target.updateMetadata({ customMetadata: { imagePermitId: grant.permitId } }));
    const downloaded = await fetch(await target.getDownloadURL());
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(image);
    await assertFails(owner.ref('businesses/owner/logos/unguarded.jpg').put(image, { contentType: 'image/jpeg' }).then(value => value));
    const expired = await authorizeImageUpload(db, 'owner', 'emulator_expired_image', input());
    await db.doc('bookingRateLimits/image-permit-v1_' + expired.permitId).update({ expiresAt: Timestamp.fromMillis(0) });
    await assertFails(owner.ref(expired.storagePath).put(image, metadata(expired.permitId)).then(value => value));
  }, 30_000);
  it('confirms a resource atomically, rolls back on failure and forbids direct SDK avatar association', async () => {
    const grant = await authorizeImageUpload(db, 'owner', 'emulator_atomic_avatar', input('avatars'));
    const avatar = url(grant.storagePath); const client = db.doc('clients/receipt-client');
    const receipt = db.doc('bookingRateLimits/image-permit-v1_' + grant.permitId);
    await expect(db.runTransaction(async tx => {
      await tx.get(client);
      await confirmImagePermits(tx, db, 'owner', [avatar], client.path);
      throw Error('Synthetic resource failure');
    })).rejects.toThrow('Synthetic resource failure');
    expect((await receipt.get()).get('status')).toBe('pending');
    const ownerDb = env.authenticatedContext('owner').firestore();
    await assertFails(ownerDb.doc(client.path).set({ businessId: 'owner', name: 'Synthetic Client', phone: '111111', avatar }));
    await client.set({ businessId: 'owner', name: 'Synthetic Client', phone: '111111', avatar: '' });
    await assertFails(ownerDb.doc(client.path).update({ avatar }));
    await db.runTransaction(async tx => {
      await tx.get(client);
      await confirmImagePermits(tx, db, 'owner', [avatar], client.path);
      tx.update(client, { avatar });
    });
    expect((await receipt.get()).get('resourceKey')).toBe(client.path);
    expect((await client.get()).get('avatar')).toBe(avatar);
    await ownerDb.doc(client.path).update({ name: 'Synthetic Renamed' });
    await expect(db.runTransaction(tx => confirmImagePermits(tx, db, 'owner', [avatar], 'clients/other'))).rejects.toMatchObject({ status: 409 });
  }, 30_000);
  it('reserves concurrent idempotent requests only once using the real transaction engine', async () => {
    const all = await Promise.all([1, 2].map(() => authorizeImageUpload(db, 'neighbor', 'emulator_same_operation', input())));
    expect(all[0].permitId).toBe(all[1].permitId);
    expect(all.filter(item => item.repeated)).toHaveLength(1);
    const rows = await db.collection('bookingRateLimits').where('businessId', '==', 'neighbor').get();
    expect(rows.docs.filter(row => row.get('kind') === 'image-upload-budget')[0].get('count')).toBe(1);
    await Promise.all([1, 2].map(i => authorizeImageUpload(db, 'neighbor', `emulator_distinct_key_${i}`, input())));
    const after = await db.collection('bookingRateLimits').where('businessId', '==', 'neighbor').get();
    expect(after.docs.filter(row => row.get('kind') === 'image-upload-budget')[0].get('count')).toBe(3);
  }, 60_000);
  it('rechecks business suspension inside client writes even if the authenticated snapshot was active', async () => {
    const grant = await authorizeImageUpload(db, 'owner', 'emulator_stale_profile', input('avatars'));
    fixture.owner.mockResolvedValue({ uid: 'owner', db, business: { status: 'active', businessType: 'services' } });
    await db.doc('businesses/owner').update({ status: 'deletion_requested' });
    const request = (method: string, body: unknown) => new NextRequest('https://qa.invalid/api/v1/owner/clients', {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await createClient(request('POST', { name: 'Must Not Save', phone: '999999', avatar: url(grant.storagePath) }))).status).toBe(403);
    expect((await patchClient(request('PATCH', { name: 'Must Not Change' }), { params: Promise.resolve({ clientId: 'receipt-client' }) })).status).toBe(403);
    expect((await db.doc('clients/receipt-client').get()).get('name')).toBe('Synthetic Renamed');
    expect((await db.doc('bookingRateLimits/image-permit-v1_' + grant.permitId).get()).get('status')).toBe('pending');
    await db.doc('businesses/owner').update({ status: 'active' });
  });
});
