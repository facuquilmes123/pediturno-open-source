import { createHash } from 'node:crypto';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { initializeAdminApp } from '@/lib/firebase-admin';

// Queue in the resource transaction so a Storage outage cannot lose cleanup work.
export function queueOwnedImageCleanup(tx: Transaction, db: Firestore, uid: string, url: unknown, category: 'services' | 'avatars' | 'logos') {
  if (typeof url !== 'string' || !url) return;
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  let object: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com' || parsed.port || parsed.username || parsed.password) return;
    const prefix = `/v0/b/${bucket}/o/`;
    if (!parsed.pathname.startsWith(prefix)) return;
    object = decodeURIComponent(parsed.pathname.slice(prefix.length));
    if (!object.startsWith(`businesses/${uid}/${category}/`) || object.includes('..') || object.includes('\\')) return;
  } catch { return; }
  const id = createHash('sha256').update(`${uid}\0${bucket}\0${object}`).digest('hex');
  tx.set(db.collection('storageCleanupJobs').doc(id), { businessId: uid, bucket, object, category, status: 'pending', createdAt: FieldValue.serverTimestamp() });
}

export async function runOwnedImageCleanup(db: Firestore, uid?: string) {
  const result = { deleted: 0, retained: 0, failed: 0 };
  const jobs = await (async () => {
    let query = db.collection('storageCleanupJobs').where('status', '==', 'pending');
    if (uid) query = query.where('businessId', '==', uid);
    return query.limit(10).get();
  })().catch(() => null);
  if (!jobs) return { ...result, failed: 1 };
  for (const job of jobs.docs) {
    const data = job.data();
    try {
      const allowedBucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
      if (data.bucket !== allowedBucket || !['services', 'avatars', 'logos'].includes(data.category) || typeof data.businessId !== 'string' ||
          typeof data.object !== 'string' || !data.object.startsWith(`businesses/${data.businessId}/${data.category}/`) ||
          data.object.includes('..') || data.object.includes('\\')) throw new Error('Invalid cleanup job');
      const collection = data.category === 'services' ? 'services' : 'clients';
      const field = data.category === 'services' ? 'photo' : data.category === 'logos' ? 'logo' : 'avatar';
      const references = data.category === 'logos'
        ? [(await db.collection('businesses').doc(data.businessId).get())]
        : (await db.collection(collection).where('businessId', '==', data.businessId).select(field).get()).docs;
      const referenced = references.some(ref => {
        try {
          const url = new URL(ref.get(field));
          return url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(`/v0/b/${data.bucket}/o/`) && decodeURIComponent(url.pathname.slice(`/v0/b/${data.bucket}/o/`.length)) === data.object;
        } catch { return false; }
      });
      if (referenced) {
        await job.ref.update({ status: 'retained', finishedAt: FieldValue.serverTimestamp() });
        result.retained++;
        continue;
      }
      await getStorage(initializeAdminApp()).bucket(data.bucket).file(data.object).delete({ ignoreNotFound: true });
      // Jobs contain object paths, never download tokens.
      await job.ref.update({ status: 'deleted', finishedAt: FieldValue.serverTimestamp() });
      result.deleted++;
    } catch {
      result.failed++;
      // Fixed diagnostic only: no URL, token, client or credential in logs.
      console.warn('[storage-cleanup] retry pending');
    }
  }
  return result;
}
