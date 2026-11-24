import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { checkAndConsumeAppointmentQuota, adjustAppointmentQuotaForReschedule, AppointmentQuotaExceededError, countActiveAppointmentsInMonth } from '@/lib/appointment-quota';
let app: ReturnType<typeof initializeApp>;
let db: ReturnType<typeof getFirestore>;
const id = `quota-${randomUUID()}`;
beforeAll(async () => {
  if (!['127.0.0.1:8080', 'localhost:8080'].includes(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Loopback emulator required');
  app = initializeApp({ projectId: 'demo-pediturno-quota' }, id); db = getFirestore(app);
  const batch = db.batch();
  for (let i = 0; i < 39; i++) batch.set(db.doc(`appointments/${id}-${i}`), { businessId: id, date: Timestamp.fromDate(new Date('2026-10-10T03:00:00Z')), status: 'Confirmado' });
  batch.set(db.doc(`businesses/${id}/monthlyUsage/2026-10`), { count: 1 });
  await batch.commit();
}, 60000);
afterAll(async () => {
  if (!db) return;
  const docs = await db.collection('appointments').where('businessId', '==', id).get();
  await Promise.all(docs.docs.map(d => d.ref.delete())); await db.recursiveDelete(db.doc(`businesses/${id}`));
  await db.terminate(); await deleteApp(app);
}, 60000);
it('admits exactly one concurrent 40th booking despite a stale counter', async () => {
  const results = await Promise.allSettled([0, 1].map(n => db.runTransaction(async tx => {
    await checkAndConsumeAppointmentQuota(tx, db, id, {}, '2026-10-10');
    tx.create(db.doc(`appointments/${id}-new-${n}`), { businessId: id, date: Timestamp.fromDate(new Date('2026-10-10T03:00:00Z')), status: 'Confirmado' });
  })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(AppointmentQuotaExceededError);
}, 30000);
it('reschedules across months without reading after a write', async () => {
  await expect(db.runTransaction(tx => adjustAppointmentQuotaForReschedule(tx, db, id, {}, '2026-10-10', '2026-11-10'))).resolves.toBeUndefined();
});

it('preserves Pro appointments, counts automatic cancellations and moves consumption across years', async () => {
  const pro = { membership: { type: 'lifetime' } };
  const batch = db.batch();
  for (let i = 0; i < 41; i++) batch.set(db.doc(`appointments/${id}-dec-${i}`), { businessId: id, date: Timestamp.fromDate(new Date('2026-12-10T03:00:00Z')), status: 'Confirmado' });
  await batch.commit();
  await expect(db.runTransaction(tx => checkAndConsumeAppointmentQuota(tx, db, id, pro, '2026-12-10'))).resolves.toMatchObject({ plan: 'pro' });
  await expect(db.runTransaction(tx => checkAndConsumeAppointmentQuota(tx, db, id, {}, '2026-12-10'))).rejects.toBeInstanceOf(AppointmentQuotaExceededError);
  // An automatic seña timeout can cancel without updating an advisory counter.
  await db.doc(`appointments/${id}-dec-0`).update({ status: 'Cancelado' });
  expect(await countActiveAppointmentsInMonth(db, id, '2026-12')).toBe(40);
  await db.runTransaction(async tx => {
    await adjustAppointmentQuotaForReschedule(tx, db, id, {}, '2026-12-10', '2027-01-10');
    tx.update(db.doc(`appointments/${id}-dec-1`), { date: Timestamp.fromDate(new Date('2027-01-10T03:00:00Z')) });
  });
  expect(await countActiveAppointmentsInMonth(db, id, '2026-12')).toBe(39);
  expect(await countActiveAppointmentsInMonth(db, id, '2027-01')).toBe(1);
  expect((await db.collection('appointments').where('businessId', '==', id).get()).size).toBeGreaterThanOrEqual(41);
}, 30000);
