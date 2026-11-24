import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { confirmImagePermits } from '@/lib/image-upload-permits';
import { matchesClientIdentity } from '@/lib/client-identity';
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { AndroidOwnerApiError, androidClientDto, androidError, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';
import { isBusinessOperational } from '@/lib/server-membership';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clientFields(input: Record<string, unknown>, required: boolean) {
  // The web dashboard stores an avatar URL for a client.  Keep the Android
  // contract compatible, but never accept data/blob URLs into Firestore.
  const allowed = new Set(['name', 'phone', 'email', 'avatar']);
  if (Object.keys(input).some(key => !allowed.has(key)) || (!required && Object.keys(input).length === 0)) {
    throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client details');
  }
  const result: Record<string, string> = {};
  if (required || input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 120 || /[\u0000-\u001F\u007F]/.test(input.name)) {
      throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client name');
    }
    result.name = input.name.trim();
  }
  if (required || input.phone !== undefined) {
    if (typeof input.phone !== 'string' || !/^[+\d ()-]{6,40}$/.test(input.phone.trim())) {
      throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client phone');
    }
    const phone = input.phone.replace(/\D/g, '');
    if (phone.length < 6) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client phone');
    result.phone = phone;
  }
  if (input.email !== undefined) {
    if (typeof input.email !== 'string' || input.email.length > 254 || (input.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) {
      throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client email');
    }
    result.email = input.email.trim();
  }
  if (input.avatar !== undefined) {
    if (typeof input.avatar !== 'string' || input.avatar.length > 2048) {
      throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client avatar');
    }
    const avatar = input.avatar.trim();
    if (avatar) {
      try {
        if (new URL(avatar).protocol !== 'https:') throw new Error('invalid protocol');
      } catch {
        throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client avatar');
      }
    }
    result.avatar = avatar;
  }
  return result;
}

function errorResponse(cause: unknown, fallback: string) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError(fallback, 503, 'CLIENTS_UNAVAILABLE');
}

export async function GET(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request, { allowOtherBusinessTypes: true });
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    const limit = Math.max(1, Math.min(100, Number(request.nextUrl.searchParams.get('limit') || 100) || 100));
    const cursor = request.nextUrl.searchParams.get('cursor');
    if (cursor !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(cursor)) return androidError('Invalid cursor', 400, 'INVALID_CURSOR');
    let query = owner.db.collection('clients').where('businessId', '==', owner.uid).orderBy('__name__').limit(limit + 1);
    if (cursor) query = query.startAfter(cursor) as typeof query;
    const snapshot = await query.get(); const page = snapshot.docs.slice(0, limit);
    const clients = page.map(item => androidClientDto(item.id, item.data()))
      .sort((a, b) => a.name.localeCompare(b.name, 'es-AR'));
    return NextResponse.json({ clients, nextCursor: snapshot.size > limit ? page.at(-1)?.id || null : null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return errorResponse(cause, 'Clients unavailable');
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = clientFields(await readAndroidOwnerJson(request), true);
    const owner = await requireAndroidOwner(request, { allowOtherBusinessTypes: true });
    if (!isBusinessOperational(owner.business)) return androidError('Active membership required', 403, 'MEMBERSHIP_REQUIRED');
    const clientId = createHash('sha256').update(`${owner.uid}\0client\0${input.phone}`).digest('hex');
    const ref = owner.db.collection('clients').doc(clientId);
    const fallbackRef = owner.db.collection('clients').doc();
    const samePhone = owner.db.collection('clients').where('businessId', '==', owner.uid).where('phone', '==', input.phone).limit(2);
    const result = await owner.db.runTransaction(async transaction => {
      const [deterministic, matches, business] = await Promise.all([transaction.get(ref), transaction.get(samePhone), transaction.get(owner.db.collection('businesses').doc(owner.uid))]);
      if (!isBusinessOperational(business.data())) throw new AndroidOwnerApiError(403, 'MEMBERSHIP_REQUIRED', 'Business unavailable');
      if (matches.size > 1) throw new AndroidOwnerApiError(409, 'CLIENT_PHONE_CONFLICT', 'Hay varios clientes con ese telÃ©fono. RevisÃ¡ el directorio.');
      const existing = matches.docs[0] || (matchesClientIdentity(deterministic.data(), owner.uid, input.phone) ? deterministic : null);
      const target = existing?.ref || (deterministic.exists ? fallbackRef : ref);
      const data = {
        name: input.name, phone: input.phone,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
      };
      await confirmImagePermits(transaction, owner.db, owner.uid, [input.avatar], `clients/${target.id}`);
      if (existing) transaction.update(target, { ...data, updatedAt: FieldValue.serverTimestamp() });
      else transaction.create(target, { businessId: owner.uid, avatar: '', lastAppointment: null, ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return { id: target.id, repeated: Boolean(existing) };
    });
    return NextResponse.json(result, { status: result.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return errorResponse(cause, 'Client unavailable');
  }
}
