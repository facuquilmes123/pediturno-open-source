import { confirmImagePermits } from '@/lib/image-upload-permits';
import { queueOwnedImageCleanup, runOwnedImageCleanup } from '@/lib/owned-image-cleanup';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { AndroidOwnerApiError, androidError, isDocumentId, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';
import { isBusinessOperational } from '@/lib/server-membership';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fields(input: Record<string, unknown>) {
  const allowed = new Set(['name', 'phone', 'email', 'avatar']);
  if (Object.keys(input).length === 0 || Object.keys(input).some(key => !allowed.has(key))) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client details');
  const patch: Record<string, string> = {};
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 120 || /[\u0000-\u001F\u007F]/.test(input.name)) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client name');
    patch.name = input.name.trim();
  }
  if (input.phone !== undefined) {
    if (typeof input.phone !== 'string' || !/^[+\d ()-]{6,40}$/.test(input.phone.trim())) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client phone');
    const phone = input.phone.replace(/\D/g, '');
    if (phone.length < 6) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client phone');
    patch.phone = phone;
  }
  if (input.email !== undefined) {
    if (typeof input.email !== 'string' || input.email.length > 254 || (input.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client email');
    patch.email = input.email.trim();
  }
  if (input.avatar !== undefined) {
    if (typeof input.avatar !== 'string' || input.avatar.length > 2048) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client avatar');
    const avatar = input.avatar.trim();
    if (avatar) {
      try {
        if (new URL(avatar).protocol !== 'https:') throw new Error('invalid protocol');
      } catch {
        throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client avatar');
      }
    }
    patch.avatar = avatar;
  }
  return patch;
}

async function ownedClient(request: NextRequest, clientId: string) {
  if (!isDocumentId(clientId)) throw new AndroidOwnerApiError(400, 'INVALID_CLIENT', 'Invalid client');
  const owner = await requireAndroidOwner(request, { allowOtherBusinessTypes: true });
  if (!isBusinessOperational(owner.business)) throw new AndroidOwnerApiError(403, 'MEMBERSHIP_REQUIRED', 'Active membership required');
  return { owner, ref: owner.db.collection('clients').doc(clientId) };
}

function failed(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('Client update unavailable', 503, 'CLIENT_UNAVAILABLE');
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params;
    const patch = fields(await readAndroidOwnerJson(request));
    const { owner, ref } = await ownedClient(request, clientId);
    await owner.db.runTransaction(async transaction => {
      const [existing, business] = await Promise.all([transaction.get(ref), transaction.get(owner.db.collection('businesses').doc(owner.uid))]);
      if (!isBusinessOperational(business.data())) throw new AndroidOwnerApiError(403, 'MEMBERSHIP_REQUIRED', 'Business unavailable');
      if (!existing.exists || existing.get('businessId') !== owner.uid) throw new AndroidOwnerApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');
      if (patch.phone !== undefined) {
        const samePhone = await transaction.get(owner.db.collection('clients').where('businessId', '==', owner.uid).where('phone', '==', patch.phone).limit(2));
        if (samePhone.docs.some(item => item.id !== clientId)) throw new AndroidOwnerApiError(409, 'CLIENT_PHONE_CONFLICT', 'Ese teléfono ya pertenece a otro cliente de tu negocio.');
      }
      await confirmImagePermits(transaction, owner.db, owner.uid, [patch.avatar], `clients/${clientId}`);
      if (patch.avatar !== undefined && patch.avatar !== existing.get('avatar')) queueOwnedImageCleanup(transaction, owner.db, owner.uid, existing.get('avatar'), 'avatars');
      transaction.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    });
    await runOwnedImageCleanup(owner.db, owner.uid);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failed(cause);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params;
    const { owner, ref } = await ownedClient(request, clientId);
    await owner.db.runTransaction(async transaction => {
      const [existing, business] = await Promise.all([transaction.get(ref), transaction.get(owner.db.collection('businesses').doc(owner.uid))]);
      if (!isBusinessOperational(business.data())) throw new AndroidOwnerApiError(403, 'MEMBERSHIP_REQUIRED', 'Business unavailable');
      if (!existing.exists || existing.get('businessId') !== owner.uid) throw new AndroidOwnerApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');
      // Historical appointments keep their immutable client snapshot for accounting/audit.
      queueOwnedImageCleanup(transaction, owner.db, owner.uid, existing.get('avatar'), 'avatars');
      transaction.delete(ref);
    });
    await runOwnedImageCleanup(owner.db, owner.uid);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failed(cause);
  }
}
