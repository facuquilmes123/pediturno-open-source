import 'server-only';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { initializeAdminApp, getAdminFirestore } from '@/lib/firebase-admin';
import { AndroidOwnerApiError } from '@/lib/android-owner-api';

export async function verifiedWebOwner(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AndroidOwnerApiError(401, 'AUTH_REQUIRED', 'Authentication required');
  let uid: string;
  try { initializeAdminApp(); uid = (await getAuth().verifyIdToken(token, true)).uid; }
  catch { throw new AndroidOwnerApiError(401, 'AUTH_REQUIRED', 'Authentication required'); }
  return { uid, db: getAdminFirestore() };
}
/** Same transaction as the actual mutation; duplicate acknowledgements do not advance it. */
export function markOwnerAgendaChanged(tx: Transaction, db: Firestore, uid: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid workspace owner');
  tx.set(db.collection('ownerWorkspaceVersions').doc(uid), {
    businessId: uid, revision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
