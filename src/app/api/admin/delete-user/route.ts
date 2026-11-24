import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { verifyAdminRequest } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DELETE_BATCH_SIZE = 400;
type DeleteSummary = Record<string, number>;
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const isNotFound = (cause: unknown) => (cause as { code?: string })?.code === 'auth/user-not-found';

async function markDeletionStarted(userId: string): Promise<void> {
  const db = getAdminFirestore();
  const businessRef = db.collection('businesses').doc(userId);
  const tombstoneRef = db.collection('businessDeletions').doc(userId);
  const financial = ['paymentOrders', 'processedPayments', 'membershipPaymentCredits', 'membershipAdminChanges', 'depositOrders', 'depositPayments']
    .map(name => db.collection(name).where('businessId', '==', userId).limit(1));
  await db.runTransaction(async transaction => {
    const [business, tombstone, ...history] = await Promise.all([
      transaction.get(businessRef), transaction.get(tombstoneRef), ...financial.map(query => transaction.get(query)),
    ]);
    if (history.some(snapshot => !snapshot.empty)) throw new Error('FINANCIAL_RETENTION_REQUIRED');
    const now = Timestamp.now();
    if (business.exists) transaction.update(businessRef, { status: 'deleting', deletionStartedAt: now });
    transaction.set(tombstoneRef, {
      businessId: userId, status: 'deleting', startedAt: tombstone.exists ? tombstone.get('startedAt') || now : now,
      updatedAt: now, attempts: Number(tombstone.get('attempts') || 0) + 1,
    }, { merge: true });
  });
}

async function disableAndRevoke(userId: string): Promise<void> {
  const auth = getAuth();
  try { await auth.updateUser(userId, { disabled: true }); } catch (cause) { if (!isNotFound(cause)) throw cause; }
  try { await auth.revokeRefreshTokens(userId); } catch (cause) { if (!isNotFound(cause)) throw cause; }
}

async function deleteByField(collectionName: string, field: string, value: string, summary: DeleteSummary): Promise<void> {
  const db = getAdminFirestore();
  let deleted = 0;
  while (true) {
    const snapshot = await db.collection(collectionName).where(field, '==', value).limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach(document => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
  summary[collectionName] = deleted;
}

async function deleteDocument(collectionName: string, documentId: string, summary: DeleteSummary): Promise<void> {
  const ref = getAdminFirestore().collection(collectionName).doc(documentId);
  const snapshot = await ref.get();
  if (snapshot.exists) { await ref.delete(); summary[collectionName] = (summary[collectionName] || 0) + 1; }
}

async function deleteBusinessStorage(userId: string): Promise<void> {
  initializeAdminApp();
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket) throw new Error('Storage bucket not configured');
  const [files] = await getStorage().bucket(bucket).getFiles({ prefix: `businesses/${userId}/` });
  for (const file of files) {
    try { await file.delete(); } catch (cause: unknown) { if ((cause as { code?: number })?.code !== 404) throw cause; }
  }
}

async function deleteOperationalData(userId: string): Promise<DeleteSummary> {
  await deleteBusinessStorage(userId);
  const summary: DeleteSummary = {};
  await deleteByField('services', 'businessId', userId, summary);
  await deleteByField('canchas', 'businessId', userId, summary);
  await deleteByField('spaces', 'businessId', userId, summary);
  await deleteByField('appointments', 'businessId', userId, summary);
  await deleteByField('clients', 'businessId', userId, summary);
  await deleteByField('pushSubscriptions', 'userId', userId, summary);
  await deleteDocument('pushTestRateLimits', userId, summary);
  await deleteByField('oauthStates', 'uid', userId, summary);
  await deleteByField('publicBusinesses', 'businessId', userId, summary);
  await deleteByField('bookingRequests', 'businessId', userId, summary);
  await deleteByField('ownerWorkspaceVersions', 'businessId', userId, summary);
  await deleteByField('bookingRateLimits', 'businessId', userId, summary);
  await deleteByField('availabilityRateLimits', 'businessId', userId, summary);
  await deleteByField('bookingSlots', 'businessId', userId, summary);
  await deleteByField('bookingCapabilities', 'businessId', userId, summary);
  await deleteByField('bookingEmailOutbox', 'businessId', userId, summary);
  await deleteByField('ownerEmailNotifications', 'businessId', userId, summary);
  await deleteByField('reminderDeliveries', 'businessId', userId, summary);
  await deleteDocument('membershipPaymentOrderLocks', userId, summary);
  await deleteDocument('mercadoPagoConnections', userId, summary);
  return summary;
}

async function rejectSelfAdminDeletion(userId: string, adminEmail: string | undefined): Promise<boolean> {
  if (!adminEmail) return false;
  try {
    const target = await getAuth().getUser(userId);
    return typeof target.email === 'string' && target.email.toLowerCase() === adminEmail.toLowerCase();
  } catch (cause) { if (isNotFound(cause)) return false; throw cause; }
}

async function deleteAuthentication(userId: string): Promise<void> {
  try { await getAuth().deleteUser(userId); } catch (cause) { if (!isNotFound(cause)) throw cause; }
}

export async function POST(request: NextRequest) {
  const authorization = await verifyAdminRequest(request);
  if (!authorization.authorized) return reply({ success: false, message: authorization.error || 'No autorizado.' }, 403);
  if (Number(request.headers.get('content-length') || 0) > 1024) return reply({ success: false, message: 'Solicitud inválida.' }, 400);
  let userIdToDelete: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 1024) return reply({ success: false, message: 'Solicitud inválida.' }, 400);
    userIdToDelete = JSON.parse(raw).userIdToDelete;
  } catch { return reply({ success: false, message: 'Solicitud inválida.' }, 400); }
  if (typeof userIdToDelete !== 'string' || !USER_ID_PATTERN.test(userIdToDelete)) return reply({ success: false, message: 'Identificador de usuario inválido.' }, 400);
  try {
    if (await rejectSelfAdminDeletion(userIdToDelete, authorization.email)) return reply({ success: false, message: 'No se puede eliminar la cuenta del administrador actual.' }, 409);
    await markDeletionStarted(userIdToDelete);
    await disableAndRevoke(userIdToDelete);
    const deleted = await deleteOperationalData(userIdToDelete);
    await deleteAuthentication(userIdToDelete);
    await deleteDocument('businesses', userIdToDelete, deleted);
    return reply({ success: true, message: 'Cuenta y datos operativos eliminados.', deleted });
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'FINANCIAL_RETENTION_REQUIRED') {
      return reply({ success: false, message: 'La cuenta tiene registros financieros. La eliminación queda bloqueada hasta definir la retención y el procedimiento de anonimización.', code: 'FINANCIAL_RETENTION_REQUIRED' }, 409);
    }
    console.error('[Admin API] Business account deletion failed');
    return reply({ success: false, message: 'No se pudo completar la eliminación. La cuenta queda bloqueada para reanudar el proceso de forma segura.' }, 503);
  }
}
