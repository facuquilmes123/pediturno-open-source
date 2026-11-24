import { afterAll, beforeAll, expect, it } from 'vitest';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { getSmtpUsageController } from '@/lib/smtp-usage-store';
import { getApps, deleteApp } from 'firebase-admin/app';

beforeAll(async () => {
  if (process.env.FIREBASE_PROJECT_ID !== 'demo-pediturno-smtp' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') || process.env.GCLOUD_PRIVATE_KEY_BASE64 || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Only the owned credential-free emulator is permitted');
  // Establish emulator connectivity before measuring the actual transaction case.
  await getAdminFirestore().collection('harnessConnectivity').doc('ready').get();
});
afterAll(async () => { await Promise.all(getApps().map(app => deleteApp(app))); });

it('persists actual concurrent Firestore transactions, deduplicates across controller instances and records alert usage', async () => {
  const db = getAdminFirestore(); const first = getSmtpUsageController();
  await Promise.all(Array.from({ length: 5 }, () => getSmtpUsageController().recordAccepted(16)));
  let acceptedAlerts = 0;
  await Promise.all(Array.from({ length: 5 }, () => getSmtpUsageController().monitor(async summary => {
    expect(summary.appAcceptedUnits24h).toBe(80); acceptedAlerts++; return true;
  })));
  expect(acceptedAlerts).toBe(1);
  const stored = (await db.collection('maintenanceJobs').doc('smtp-notificaciones-usage-v1').get()).data()!;
  expect(stored.events.reduce((sum: number, e: { units: number }) => sum + e.units, 0)).toBe(81);
  expect(stored.lease).toBeUndefined(); expect(stored.lastAlertAt).toBeTypeOf('number');
  expect((await first.monitor(async () => { throw Error('Must not send a duplicate'); })).alert).toBe('deduplicated');
  expect(JSON.stringify(stored)).not.toMatch(/@|recipient|password|token|clientEmail/);
});

it('does not overwrite a corrupt non-array field while recording a real accepted event', async () => {
  const ref = getAdminFirestore().collection('maintenanceJobs').doc('smtp-notificaciones-usage-v1');
  await ref.update({ events: 'corrupt-private-state' });
  await expect(getSmtpUsageController().recordAccepted(1)).rejects.toThrow();
  expect((await ref.get()).get('events')).toBe('corrupt-private-state');
});
