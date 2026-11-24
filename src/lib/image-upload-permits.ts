import 'server-only';
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { isBusinessOperational } from '@/lib/server-membership';

const HOUR = 3_600_000;
const MAX_BYTES = 2 * 1024 * 1024;
const HOUR_BYTES = 64 * 1024 * 1024;
const HOUR_COUNT = 120;
const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
const FOLDERS = ['logos', 'avatars', 'services', 'canchas', 'spaces'] as const;
export type ImageCategory = typeof FOLDERS[number];
type UploadInput = { category: ImageCategory; contentType: keyof typeof MIME; byteSize: number };
export class ImagePermitError extends Error {
  constructor(public status: number, public code: string, public retryAfter = 0) {
    super(code === 'IMAGE_UPLOAD_RATE_LIMITED' ? 'Alcanzaste el límite temporal de imágenes. Intentá más tarde.' : 'No se pudo autorizar esta imagen. Volvé a seleccionarla.');
  }
}
export function imageUploadInput(value: Record<string, unknown>): UploadInput {
  if (Object.keys(value).some(k => !['category', 'contentType', 'byteSize'].includes(k)) ||
    !FOLDERS.includes(value.category as ImageCategory) || typeof value.contentType !== 'string' || !Object.hasOwn(MIME, value.contentType) ||
    !Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 1 || Number(value.byteSize) > MAX_BYTES) {
    throw new ImagePermitError(400, 'INVALID_IMAGE_UPLOAD');
  }
  return { category: value.category as ImageCategory, contentType: value.contentType as UploadInput['contentType'], byteSize: value.byteSize as number };
}
function allowedCategory(business: Record<string, unknown>, category: ImageCategory) {
  const vertical = business.businessType ?? 'services';
  return category === 'logos' || category === 'avatars' ||
    category === 'services' && ['services', 'hybrid'].includes(String(vertical)) || category === 'canchas' && ['sports_facility', 'hybrid'].includes(String(vertical)) || category === 'spaces' && vertical === 'spaces';
}
export async function authorizeImageUpload(db: Firestore, uid: string, key: string, input: UploadInput, now = Date.now()) {
  if (!uid || uid.length > 128 || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw new ImagePermitError(400, 'INVALID_IMAGE_UPLOAD');
  // Derive both the receipt and path in the server. No caller-selected object name.
  const id = createHash('sha256').update(`${uid}\0image-upload-v1\0${key}`).digest('hex');
  // Keep receipts in a disjoint namespace of the operational collection already
  // purged by account deletion, including the previous rollback release.
  const permit = db.collection('bookingRateLimits').doc('image-permit-v1_' + id);
  const ownerHash = createHash('sha256').update(uid).digest('hex');
  const budget = db.collection('bookingRateLimits').doc('image-upload-v1_' + ownerHash);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const start = Math.floor(now / HOUR) * HOUR;
  const objectPath = `businesses/${uid}/${input.category}/g_${id}.${MIME[input.contentType]}`;
  const expiresAt = Timestamp.fromMillis(now + 10 * 60_000);
  const result = await db.runTransaction(async tx => {
    const [profile, prior, state] = await Promise.all([
      tx.get(db.collection('businesses').doc(uid)), tx.get(permit), tx.get(budget),
    ]);
    const business = profile.data();
    if (!business || !isBusinessOperational(business, now) || !allowedCategory(business, input.category)) throw new ImagePermitError(403, 'IMAGE_UPLOAD_FORBIDDEN');
    if (prior.exists) {
      const data = prior.data()!;
      if (data.kind !== 'image-upload-permit' || data.businessId !== uid || data.fingerprint !== fingerprint || data.objectPath !== objectPath) throw new ImagePermitError(409, 'IMAGE_UPLOAD_CONFLICT');
      if (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= now || data.status !== 'pending') throw new ImagePermitError(410, 'IMAGE_UPLOAD_EXPIRED');
      return { id, objectPath: data.objectPath as string, expiresAt: data.expiresAt as Timestamp, repeated: true };
    }
    const data = state.data();
    if (state.exists && (data?.businessId !== uid || data.kind !== 'image-upload-budget' ||
      !Number.isSafeInteger(data.windowStartMs) || !Number.isSafeInteger(data.count) || data.count < 0 ||
      !Number.isSafeInteger(data.bytes) || data.bytes < 0)) throw new ImagePermitError(503, 'IMAGE_UPLOAD_UNAVAILABLE');
    const count = data?.windowStartMs === start ? data.count as number : 0;
    const bytes = data?.windowStartMs === start ? data.bytes as number : 0;
    if (count >= HOUR_COUNT || bytes + input.byteSize > HOUR_BYTES) {
      throw new ImagePermitError(429, 'IMAGE_UPLOAD_RATE_LIMITED', Math.max(1, Math.ceil((start + HOUR - now) / 1000)));
    }
    tx.set(budget, { businessId: uid, kind: 'image-upload-budget', windowStartMs: start, count: count + 1,
      bytes: bytes + input.byteSize, updatedAt: FieldValue.serverTimestamp() });
    // The prior read participates in transaction conflict detection. A retry
    // must re-read both the receipt and budget before making any write.
    tx.create(permit, { businessId: uid, kind: 'image-upload-permit', ...input, objectPath, fingerprint, status: 'pending', expiresAt, createdAt: FieldValue.serverTimestamp() });
    return { id, objectPath, expiresAt, repeated: false };
  });
  return { permitId: result.id, storagePath: result.objectPath, expiresAt: result.expiresAt.toDate().toISOString(), repeated: result.repeated };
}

/** Must be awaited after all resource reads and before the transaction's first write. */
export async function confirmImagePermits(tx: Transaction, db: Firestore, uid: string, urls: unknown[], resourceKey: string, now = Date.now()) {
  const objects = new Map<string, string[]>();
  const category = ({ businesses: 'logos', clients: 'avatars', services: 'services', canchas: 'canchas', spaces: 'spaces' } as Record<string, string>)[resourceKey.split('/')[0]];
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  for (const value of urls) {
    if (typeof value !== 'string' || !value) continue;
    let url: URL; try { url = new URL(value); } catch { continue; }
    const object = (() => { try { return decodeURIComponent(url.pathname.split('/o/')[1] ?? ''); } catch { return ''; } })();
    const match = object.match(/\/g_([a-f0-9]{64})\.(jpg|png|webp)$/);
    if (!match) continue; // Preserve already-issued legacy image URLs during migration.
    if (!bucket || url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password ||
      !url.pathname.startsWith(`/v0/b/${bucket}/o/`) || !object.startsWith(`businesses/${uid}/`)) throw new ImagePermitError(400, 'INVALID_IMAGE_UPLOAD');
    const paths = objects.get(match[1]) ?? []; paths.push(object); objects.set(match[1], paths);
  }
  const confirmations = await Promise.all([...objects].map(async ([id, paths]) => {
    const ref = db.collection('bookingRateLimits').doc('image-permit-v1_' + id); const row = await tx.get(ref); const data = row.data();
    if (!data || data.kind !== 'image-upload-permit' || data.businessId !== uid || data.category !== category || (data.status !== 'pending' && data.status !== 'confirmed') ||
      data.status === 'confirmed' && data.resourceKey !== resourceKey ||
      data.status === 'pending' && (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= now)) throw new ImagePermitError(409, 'IMAGE_UPLOAD_EXPIRED');
    // Exact path matching prevents reusing a receipt for another folder or suffix.
    if (paths.some(path => path !== data.objectPath)) throw new ImagePermitError(400, 'INVALID_IMAGE_UPLOAD');
    return { ref, data };
  }));
  for (const { ref, data } of confirmations) if (data.status === 'pending') tx.update(ref, { status: 'confirmed', resourceKey, confirmedAt: FieldValue.serverTimestamp() });
}
