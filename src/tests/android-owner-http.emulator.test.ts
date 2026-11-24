import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

const projectId = 'demo-pediturno-audit';
const baseUrl = process.env.PEDITURNO_ANDROID_LOCAL_BASE_URL || 'http://127.0.0.1:3000';
const prefix = `it_android_owner_http_${Date.now()}_`;
const fixture = (suffix: string) => `${prefix}${suffix}`;
const sharedPhone = '5491112345678';
const historyPhone = '5491198765432';
let app: App; let db: Firestore;
let initialized = false;
const owners = [fixture('owner_a'), fixture('owner_b')];
const tokens = new Map<string, string>();
const registeredTokenHashes = new Set<string>();

function business() {
  return {
    status: 'active', businessType: 'services', name: 'Servicios de prueba', email: 'owner@example.test',
    timeZone: 'America/Argentina/Buenos_Aires', membership: { type: 'lifetime' },
    bookingSettings: { autoConfirm: true, bookingLeadTimeHours: 2, bookingHorizonDays: 30, appointmentBufferMinutes: 15, remindersEnabled: false, newAppointmentNotificationsEnabled: false, notificationEmail: '' },
  };
}

async function signIn(ownerId: string) {
  const email = `${ownerId}@example.test`;
  const password = `pw-${ownerId}-A!`;
  await getAuth(app).createUser({ uid: ownerId, email, password, emailVerified: true });
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const payload = await response.json() as { idToken?: string };
  if (!response.ok || typeof payload.idToken !== 'string') throw new Error('Could not obtain a Firebase Auth emulator token');
  tokens.set(ownerId, payload.idToken);
}

async function api(ownerId: string, path: string, options: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${tokens.get(ownerId)}`, ...(options.headers || {}) },
  });
}

async function deleteMatching(collection: string, ownerId: string) {
  const rows = await db.collection(collection).where('businessId', '==', ownerId).get();
  await Promise.all(rows.docs.map(row => row.ref.delete()));
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Existing Firestore/Auth emulators are required');
  const health = await fetch(`${baseUrl}/api/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Expected the isolated Android local server at ${baseUrl}`);
  app = initializeApp({ projectId }); db = getFirestore(app); initialized = true;
  await Promise.all(owners.map(async ownerId => {
    await db.collection('businesses').doc(ownerId).set(business());
    await signIn(ownerId);
  }));
});

afterAll(async () => {
  if (!initialized) return;
  // Fixture-only cleanup: shared emulator collections and other workers stay intact.
  await Promise.all(owners.flatMap(ownerId => [
    db.collection('appointments').where('businessId', '==', ownerId).get().then(rows => Promise.all(rows.docs.map(row => row.ref.delete()))),
    db.collection('clients').where('businessId', '==', ownerId).get().then(rows => Promise.all(rows.docs.map(row => row.ref.delete()))),
    deleteMatching('services', ownerId), deleteMatching('storageCleanupJobs', ownerId), deleteMatching('ownerEmailNotifications', ownerId), deleteMatching('bookingEmailOutbox', ownerId), deleteMatching('bookingCapabilities', ownerId),
    db.collection('businesses').doc(ownerId).collection('deviceTokens').get().then(rows => Promise.all(rows.docs.map(row => row.ref.delete()))),
    db.collection('businesses').doc(ownerId).delete(), getAuth(app).deleteUser(ownerId).catch(() => undefined),
  ]));
  await Promise.all([...registeredTokenHashes].map(hash => db.collection('androidDeviceTokenIndex').doc(hash).delete().catch(() => undefined)));
  if (getApps().some(current => current.name === app.name)) { await db.terminate(); await deleteApp(app); }
});

describe('Android owner HTTP contract against Firebase emulators', () => {
  it('uses authenticated HTTP settings methods, rejects unsupported verbs, and queues the existing notification workflow', async () => {
    const ownerId = owners[0];
    const initial = await api(ownerId, '/api/v1/owner/settings');
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({ bookingSettings: { bookingHorizonDays: 30 } });

    const saved = await api(ownerId, '/api/v1/owner/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookingHorizonDays: 45, newAppointmentNotificationsEnabled: true, notificationEmail: 'alerts@example.test' }),
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ bookingSettings: { bookingHorizonDays: 45, newAppointmentNotificationsEnabled: true, notificationEmail: 'alerts@example.test' } });
    expect((await api(ownerId, '/api/v1/owner/settings', { method: 'PUT' })).status).toBe(405);

    const appointmentId = fixture('notification');
    await db.collection('appointments').doc(appointmentId).set({
      businessId: ownerId, client: 'Cliente de prueba', clientPhone: sharedPhone, clientEmail: 'client@example.test',
      date: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), time: '10:00', status: 'Confirmado',
    });
    const notification = await api(ownerId, `/api/v1/owner/appointments/${appointmentId}/notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'confirmation' }),
    });
    expect(notification.status).toBe(202);
    await expect(notification.json()).resolves.toMatchObject({ status: 'queued', repeated: false });
    const invalid = await api(ownerId, `/api/v1/owner/appointments/${appointmentId}/notify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'other' }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'INVALID_NOTIFICATION' });
  }, 30_000);

  it('keeps client history tenant-scoped and paginates it with an opaque cursor', async () => {
    const ownerId = owners[0]; const otherOwnerId = owners[1]; const clientId = fixture('client');
    await db.collection('clients').doc(clientId).set({ businessId: ownerId, name: 'Cliente', phone: historyPhone, email: '', avatar: '' });
    await db.collection('appointments').doc(fixture('history_1')).set({ businessId: ownerId, clientId, client: 'Cliente', clientPhone: historyPhone, date: Timestamp.fromMillis(1_900_000_000_000), time: '10:00', status: 'Completado' });
    await db.collection('appointments').doc(fixture('history_2')).set({ businessId: ownerId, client: 'Cliente legacy', clientPhone: historyPhone, date: Timestamp.fromMillis(1_800_000_000_000), time: '11:00', status: 'Completado' });
    await db.collection('appointments').doc(fixture('other_tenant')).set({ businessId: otherOwnerId, clientId, client: 'No incluir', clientPhone: historyPhone, date: Timestamp.fromMillis(2_000_000_000_000), time: '12:00', status: 'Completado' });
    const first = await api(ownerId, `/api/v1/owner/clients/${clientId}/history?limit=1`);
    expect(first.status).toBe(200);
    const firstPayload = await first.json() as { appointments: Array<{ id: string }>; nextCursor: string | null };
    expect(firstPayload.appointments).toHaveLength(1);
    expect(firstPayload.appointments[0].id).toBe(fixture('history_1'));
    expect(firstPayload.nextCursor).toEqual(expect.any(String));
    const second = await api(ownerId, `/api/v1/owner/clients/${clientId}/history?limit=1&cursor=${encodeURIComponent(firstPayload.nextCursor!)}`);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ appointments: [{ id: fixture('history_2') }], nextCursor: null });
  }, 30_000);

  it('reassigns a real FCM registration HTTP token between accounts and retains only the five newest devices', async () => {
    const ownerId = owners[0]; const otherOwnerId = owners[1];
    const register = (id: string, token: string) => {
      registeredTokenHashes.add(createHash('sha256').update(token).digest('hex'));
      return api(id, '/api/v1/owner/device/token', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, platform: 'android' }),
      });
    };
    const transferred = `fcm_${fixture('transferred')}_${'a'.repeat(40)}`;
    expect((await register(ownerId, transferred)).status).toBe(200);
    expect((await register(otherOwnerId, transferred)).status).toBe(200);
    const ownerTokens = await db.collection('businesses').doc(ownerId).collection('deviceTokens').get();
    expect(ownerTokens.empty).toBe(true);
    const hash = createHash('sha256').update(transferred).digest('hex');
    expect((await db.collection('androidDeviceTokenIndex').doc(hash).get()).get('ownerId')).toBe(otherOwnerId);
    for (let index = 0; index < 6; index += 1) {
      const response = await register(otherOwnerId, `fcm_${fixture(`cap_${index}`)}_${String(index).repeat(40)}`);
      expect(response.status).toBe(200);
    }
    const retained = await db.collection('businesses').doc(otherOwnerId).collection('deviceTokens').get();
    expect(retained.size).toBe(5);
  }, 30_000);
  it('deletes only owned orphan photos after resource deletion and preserves appointment snapshots', async () => {
    const ownerId = owners[0];
    const bucket = getStorage(app).bucket('demo-pediturno-audit.appspot.com');
    const file = bucket.file(`businesses/${ownerId}/services/${fixture('photo')}.jpg`);
    await file.save(Buffer.from('qa-image'), { contentType: 'image/jpeg' });
    const photo = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media`;
    const serviceId = fixture('photo_service');
    await db.doc(`services/${serviceId}`).set({ businessId: ownerId, name: 'QA photo', duration: '30', price: 1, status: 'Pausado', photo });
    expect((await api(ownerId, '/api/v1/owner/services', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: serviceId }) })).status).toBe(200);
    expect((await file.exists())[0], 'orphan service photo must be removed').toBe(false);
    const avatar = bucket.file(`businesses/${ownerId}/avatars/${fixture('avatar')}.jpg`);
    await avatar.save(Buffer.from('qa-image'), { contentType: 'image/jpeg' });
    const clientId = fixture('photo_client');
    await db.doc(`clients/${clientId}`).set({ businessId: ownerId, name: 'QA snapshot', phone: '5400003333', avatar: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(avatar.name)}?alt=media` });
    const historyRef = db.doc(`appointments/${fixture('retained_history')}`);
    await historyRef.set({ businessId: ownerId, clientId, client: 'QA snapshot', clientPhone: '5400003333', date: Timestamp.now(), status: 'Completado' });
    expect((await api(ownerId, `/api/v1/owner/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await avatar.exists())[0], 'orphan client avatar must be removed').toBe(false);
    expect((await historyRef.get()).get('client')).toBe('QA snapshot');
  }, 60_000);

  it('retains a shared image until its last owned reference disappears and rejects cross-owner cleanup', async () => {
    const ownerId = owners[0]; const bucket = getStorage(app).bucket('demo-pediturno-audit.appspot.com');
    const file = bucket.file(`businesses/${ownerId}/services/${fixture('shared')}.jpg`);
    await file.save(Buffer.from('qa'), { contentType: 'image/jpeg' });
    const photo = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media`;
    for (const suffix of ['shared_a','shared_b']) await db.doc(`services/${fixture(suffix)}`).set({ businessId: ownerId, name: suffix, duration: '30', status: 'Pausado', photo });
    const remove = (suffix: string) => api(ownerId, '/api/v1/owner/services', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: fixture(suffix) }) });
    expect((await remove('shared_a')).status).toBe(200); expect((await file.exists())[0]).toBe(true);
    expect((await remove('shared_b')).status).toBe(200); expect((await file.exists())[0]).toBe(false);
    const foreign = bucket.file(`businesses/${owners[1]}/avatars/${fixture('foreign')}.jpg`);
    await foreign.save(Buffer.from('qa'), { contentType: 'image/jpeg' });
    const clientId = fixture('foreign_image_client');
    await db.doc(`clients/${clientId}`).set({ businessId: ownerId, name: 'QA external image', phone: '5400004444', avatar: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(foreign.name)}?alt=media` });
    expect((await api(ownerId, `/api/v1/owner/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await foreign.exists())[0]).toBe(true); await foreign.delete();
  }, 60_000);

  it('returns every client, service and agenda item across 100-item boundaries without duplicates', async () => {
    const ownerId = owners[0]; const batch = db.batch(); const expected: Record<string, Set<string>> = {};
    for (const collection of ['clients','services','appointments']) {
      expected[collection] = new Set();
      for (let index = 0; index < 121; index++) {
        const id = fixture(`${collection}_page_${index.toString().padStart(3,'0')}`); expected[collection].add(id);
        batch.set(db.doc(`${collection}/${id}`), { businessId: ownerId, name: `QA ${index}`, phone: `540033${index}`, client: `QA ${index}`, clientPhone: `540033${index}`, date: Timestamp.fromDate(new Date('2026-11-10T03:00:00Z')), time: '10:00', duration: '30', price: 1, status: collection === 'appointments' ? 'Completado' : 'Pausado', service: 'QA fixture', serviceId: 'qa' });
      }
    }
    await batch.commit();
    for (const [collection,path,key] of [['clients','clients','clients'],['services','services','services'],['appointments','agenda?date=2026-11-10','appointments']]) {
      let cursor: string | null = null; const ids: string[] = []; let pages = 0;
      do {
        const separator = path.includes('?') ? '&' : '?';
        const response = await api(ownerId, `/api/v1/owner/${path}${separator}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(response.status).toBe(200); const payload = await response.json(); ids.push(...payload[key].map((x: {id: string}) => x.id)); cursor = payload.nextCursor; expect(++pages).toBeLessThan(5);
      } while(cursor);
      expect(new Set(ids).size).toBe(ids.length); for(const id of expected[collection]) expect(ids).toContain(id); expect(pages).toBeGreaterThan(1);
    }
  }, 60_000);

  it('round-trips the complete profile and settings, atomically claims slugs and rejects collisions', async () => {
    const ownerId = owners[0]; const slug = `qa-profile-${Date.now()}`;
    const payload = { name: 'QA perfil completo', slug, description: 'Descripción QA de perfil completo para contrastar la persistencia compartida.', whatsappButtonEnabled: true, whatsappNumber: '+540000333333', address: {street:'Calle QA',number:'123',city:'Ciudad QA',province:'Provincia QA',postalCode:'0000',country:'Argentina'}, location:{lat:-34.6,lng:-58.4}, socialLinks:[{id:'qa-web',type:'website',url:'https://example.invalid/qa',title:'QA Web'}], theme:'custom', customTheme:{primary:'#123456',background:'#F2F3F4',accent:'#456789'}, bookingSettings:{autoConfirm:false,bookingLeadTimeHours:3,bookingHorizonDays:45,appointmentBufferMinutes:20,remindersEnabled:true,newAppointmentNotificationsEnabled:true,notificationEmail:'qa@example.invalid'} };
    const save = (id: string, value: unknown) => api(id,'/api/business/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
    try {
      expect((await save(ownerId,payload)).status).toBe(200);
      expect((await db.doc(`businesses/${ownerId}`).get()).data()).toMatchObject(payload);
      expect((await db.doc(`publicBusinesses/${slug}`).get()).data()).toMatchObject({businessId:ownerId,slug,name:payload.name,socialLinks:payload.socialLinks,customTheme:payload.customTheme});
      const bootstrap = await api(ownerId,'/api/v1/owner/bootstrap'); expect(bootstrap.status).toBe(200);
      const profile = (await bootstrap.json()).business; expect(profile).toMatchObject({name:payload.name,slug,description:payload.description,address:payload.address,location:payload.location,socialLinks:payload.socialLinks,theme:'custom',customTheme:payload.customTheme,bookingSettings:payload.bookingSettings});
      expect((await save(owners[1],{slug})).status).toBe(409);
      const moved = `${slug}-nuevo`;expect((await save(ownerId,{slug:moved})).status).toBe(200);expect((await db.doc(`publicBusinesses/${slug}`).get()).exists).toBe(false);expect((await db.doc(`publicBusinesses/${moved}`).get()).get('businessId')).toBe(ownerId);
      const settings={...payload.bookingSettings,autoConfirm:true,bookingLeadTimeHours:0,bookingHorizonDays:60,appointmentBufferMinutes:0,remindersEnabled:false,newAppointmentNotificationsEnabled:false,notificationEmail:''};
      const change=await api(ownerId,'/api/v1/owner/settings',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(settings)});expect(change.status).toBe(200);expect((await change.json()).bookingSettings).toMatchObject(settings);expect((await (await api(ownerId,'/api/v1/owner/settings')).json()).bookingSettings).toMatchObject(settings);
      expect((await save(ownerId,{socialLinks:[{type:'instagram',url:'https://example.invalid/qa'}]})).status).toBe(400);
    } finally {for(const name of [slug,`${slug}-nuevo`]) await db.doc(`publicBusinesses/${name}`).delete();}
  },60_000);

  it('keeps international phone upserts stable after edits and never mutates a foreign deterministic client', async () => {
    const ownerId=owners[0];const create=(name:string,phone:string)=>api(ownerId,'/api/v1/owner/clients',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,phone,email:''})});
    const first=await create('QA Phone A','+54 (11) 5555-0001');expect(first.status).toBe(201);const a=await first.json();
    const repeated=await create('QA Phone A','54 11 5555 0001');expect(repeated.status).toBe(200);expect((await repeated.json()).id).toBe(a.id);
    const second=await create('QA Phone B','+54 11 5555 0002');const b=await second.json();
    const patch=(phone:string)=>api(ownerId,`/api/v1/owner/clients/${a.id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({phone})});
    expect((await patch('+54 11 5555 0002')).status).toBe(409);
    expect((await patch('+54 11 5555 0003')).status).toBe(200);
    const afterEdit=await create('QA Phone A','54 (11) 5555-0003');expect(afterEdit.status).toBe(200);expect((await afterEdit.json()).id).toBe(a.id);
    expect((await db.collection('clients').where('businessId','==',ownerId).where('phone','==','541155550003').get()).size).toBe(1);
    const preclaimedId=createHash('sha256').update(`${ownerId}\0client\0${'541155550004'}`).digest('hex');
    await db.doc(`clients/${preclaimedId}`).set({businessId:owners[1],name:'Neighbor untouched',phone:'541155550004'});
    const safe=await create('QA Phone C','+54 11 5555 0004');expect(safe.status).toBe(201);const c=await safe.json();expect(c.id).not.toBe(preclaimedId);
    expect((await db.doc(`clients/${preclaimedId}`).get()).get('name')).toBe('Neighbor untouched');
    expect((await db.doc(`clients/${c.id}`).get()).get('businessId')).toBe(ownerId);
  },60_000);

  it('replays a concurrent service save once and rejects a changed body for the same operation', async () => {
    const key=`qa-service-${Date.now()}`;const payload={name:'QA servicio reintento',duration:30,price:'100',status:'Pausado'};
    const create=(value:unknown)=>api(owners[0],'/api/v1/owner/services',{method:'POST',headers:{'content-type':'application/json','X-Idempotency-Key':key},body:JSON.stringify(value)});
    const responses=await Promise.all([create(payload),create(payload)]);expect(responses.every(r=>r.status===200||r.status===201)).toBe(true);const results=await Promise.all(responses.map(r=>r.json()));expect(results[0].id).toBe(results[1].id);
    expect((await create({...payload,name:'QA distinto'})).status).toBe(409);
    expect((await db.collection('services').where('businessId','==',owners[0]).where('name','==',payload.name).get()).size).toBe(1);
  },60_000);

});

