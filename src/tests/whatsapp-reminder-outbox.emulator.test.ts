import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { enqueueWhatsAppReminder } from '@/lib/whatsapp-reminder-outbox';
import { planWhatsAppReminder, type WhatsAppReminderSource } from '@/lib/whatsapp-reminder-policy';
let app: App, db: Firestore;
function source(): WhatsAppReminderSource {
  const nowMs = Date.parse('2026-11-06T15:00:00Z');
  return { nowMs, business: {id:'owner-a',status:'active',remindersEnabled:true},
    appointment:{id:'appointment-a',businessId:'owner-a',clientId:'client-a',status:'Confirmado',startsAtMs:nowMs+3600000,reminderDueAtMs:nowMs-1},
    client:{id:'client-a',businessId:'owner-a',phoneE164:'+5491100000000'},
    consent:{businessId:'owner-a',clientId:'client-a',phoneE164:'+5491100000000',category:'appointment_reminder',textVersion:'v1',grantedAtMs:nowMs-1000},
    sender:{businessId:'owner-a',phoneNumberId:'123456',active:true},
    template:{businessId:'owner-a',name:'appointment_reminder',language:'es_AR',category:'UTILITY',status:'APPROVED',revision:'v1'}};
}
beforeAll(() => {
  if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Local emulator required');
  app = initializeApp({projectId:'demo-pediturno-whatsapp-outbox'}, 'whatsapp-outbox-it'); db = getFirestore(app);
});
beforeEach(async () => { await db.recursiveDelete(db.collection('whatsappReminderOutbox')); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });
describe('V2 WhatsApp durable enqueue', () => {
  it('creates exactly one job under concurrent retries', async () => {
    const results = await Promise.all(Array.from({length:5},()=>enqueueWhatsAppReminder(db,source())));
    expect(results.filter(result=>result.status==='enqueued')).toHaveLength(1);
    expect(results.filter(result=>result.status==='duplicate')).toHaveLength(4);
    expect((await db.collection('whatsappReminderOutbox').get()).size).toBe(1);
  });
  it('stores bounded references without copying contact details or a whole source payload', async () => {
    const input = source(); const result = await enqueueWhatsAppReminder(db,input);
    if (result.status!=='enqueued') throw Error('Expected enqueue');
    const record = (await db.doc(`whatsappReminderOutbox/${result.deliveryKey}`).get()).data()!;
    expect(record).toMatchObject({businessId:'owner-a',clientId:'client-a',appointmentId:'appointment-a',status:'pending',attempts:0});
    expect(JSON.stringify(record)).not.toContain(input.client.phoneE164);
    expect(record).not.toHaveProperty('consent'); expect(record).not.toHaveProperty('client');
    expect(record).not.toHaveProperty('body'); expect(record).not.toHaveProperty('token');
  });
  it.each(['pending','sent','cancelled','failed','uncertain'])('never resets an existing %s job on a template or sender change', async status => {
    const input = source(); const first = await enqueueWhatsAppReminder(db,input);
    if (first.status!=='enqueued') throw Error('Expected enqueue');
    const ref = db.doc(`whatsappReminderOutbox/${first.deliveryKey}`);
    await ref.update({status,attempts:3}); const before = (await ref.get()).data();
    input.template!.revision='v2'; input.sender!.phoneNumberId='654321';
    expect((await enqueueWhatsAppReminder(db,input)).status).toBe('duplicate');
    expect((await ref.get()).data()).toEqual(before);
  });
  it('rejects revoked consent and a foreign tenant before any write', async () => {
    const input = source(); input.consent!.revokedAtMs=input.nowMs;
    expect((await enqueueWhatsAppReminder(db,input)).status).toBe('rejected');
    input.consent!.revokedAtMs=null; input.sender!.businessId='owner-b';
    expect((await enqueueWhatsAppReminder(db,input)).status).toBe('rejected');
    expect((await db.collection('whatsappReminderOutbox').get()).empty).toBe(true);
  });
  it('does not overwrite an existing record associated with another business', async () => {
    const input = source(), plan = planWhatsAppReminder(input);
    if (!plan.eligible) throw Error('Expected plan');
    const ref = db.doc(`whatsappReminderOutbox/${plan.deliveryKey}`);
    await ref.set({businessId:'foreign',appointmentId:'other',clientId:'other'});
    await expect(enqueueWhatsAppReminder(db,input)).rejects.toThrow('source conflict');
    expect((await ref.get()).get('businessId')).toBe('foreign');
  });
  it('uses a new occurrence after rescheduling without changing the previous job', async () => {
    const input = source(); await enqueueWhatsAppReminder(db,input);
    input.nowMs+=86400000; input.appointment.startsAtMs+=86400000; input.appointment.reminderDueAtMs+=86400000;
    expect((await enqueueWhatsAppReminder(db,input)).status).toBe('enqueued');
    expect((await db.collection('whatsappReminderOutbox').get()).size).toBe(2);
    // Cancellation/claim checks are the future worker's responsibility.
  });
});
