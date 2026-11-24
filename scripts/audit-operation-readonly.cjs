// Aggregated read-only evidence. Never prints credentials, customer data or capability tokens.
const { cert, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
(async () => {
  if (process.env.FIREBASE_PROJECT_ID !== 'pediturno-app') throw new Error('Unexpected project');
  const app = initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.GCLOUD_CLIENT_EMAIL, privateKey: Buffer.from(process.env.GCLOUD_PRIVATE_KEY_BASE64 || '', 'base64').toString('utf8') }) });
  const db = getFirestore(app);
  const [failed, pending, connections, push] = await Promise.all([
    db.collection('bookingEmailOutbox').where('status', '==', 'failed').get(),
    db.collection('bookingEmailOutbox').where('status', 'in', ['pending', 'processing']).count().get(),
    db.collection('mercadoPagoConnections').where('active', '==', true).count().get(),
    db.collection('pushSubscriptions').count().get(),
  ]);
  let futureConfirmed = 0;
  for (const item of failed.docs) {
    const data = item.data();
    if (typeof data.appointmentId !== 'string') continue;
    const appointment = (await db.collection('appointments').doc(data.appointmentId).get()).data();
    if (appointment?.status === 'Confirmado' && appointment.date?.toMillis?.() > Date.now()) futureConfirmed++;
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), failedConfirmations: failed.size, failedFutureConfirmed: futureConfirmed, queuedConfirmations: pending.data().count, activeMarketplaceConnections: connections.data().count, pushSubscriptions: push.data().count }));
  await db.terminate();
})().catch(() => { console.error('Read-only operational check unavailable (no credential details logged).'); process.exitCode = 1; });
