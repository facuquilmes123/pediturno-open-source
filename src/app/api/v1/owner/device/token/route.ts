import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { AndroidOwnerApiError, androidError, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function token(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => key !== 'token' && key !== 'platform') || typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 4096 || input.platform !== 'android') {
    throw new AndroidOwnerApiError(400, 'INVALID_DEVICE_TOKEN', 'Invalid device token');
  }
  return input.token;
}

function fail(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('Device registration unavailable', 503, 'DEVICE_UNAVAILABLE');
}

export async function POST(request: NextRequest) {
  try {
    const value = token(await readAndroidOwnerJson(request));
    const owner = await requireAndroidOwner(request);
    // Tokens are never returned, logged, or stored in a collection queryable by another owner.
    const id = createHash('sha256').update(`${owner.uid}\0${value}`).digest('hex');
    const tokenHash = createHash('sha256').update(value).digest('hex');
    const devices = owner.db.collection('businesses').doc(owner.uid).collection('deviceTokens');
    const current = devices.doc(id); const index = owner.db.collection('androidDeviceTokenIndex').doc(tokenHash);
    await owner.db.runTransaction(async transaction => {
      const [existing, prior, currentDevices] = await Promise.all([transaction.get(current), transaction.get(index), transaction.get(devices.limit(6))]);
      if (prior.exists && prior.get('ownerId') !== owner.uid && typeof prior.get('ownerId') === 'string' && typeof prior.get('deviceId') === 'string') {
        transaction.delete(owner.db.collection('businesses').doc(prior.get('ownerId')).collection('deviceTokens').doc(prior.get('deviceId')));
      }
      if (!existing.exists && currentDevices.size >= 5) {
        const oldest = currentDevices.docs.slice().sort((a, b) => Number(a.get('updatedAt')?.toMillis?.() || 0) - Number(b.get('updatedAt')?.toMillis?.() || 0))[0];
        if (oldest) transaction.delete(oldest.ref);
      }
      transaction.set(current, { ownerId: owner.uid, platform: 'android', token: value, updatedAt: FieldValue.serverTimestamp(), ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }) }, { merge: true });
      transaction.set(index, { ownerId: owner.uid, deviceId: id, updatedAt: FieldValue.serverTimestamp() });
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return fail(cause);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const value = token(await readAndroidOwnerJson(request));
    const owner = await requireAndroidOwner(request);
    const id = createHash('sha256').update(`${owner.uid}\0${value}`).digest('hex');
    const tokenHash = createHash('sha256').update(value).digest('hex');
    const current = owner.db.collection('businesses').doc(owner.uid).collection('deviceTokens').doc(id);
    const index = owner.db.collection('androidDeviceTokenIndex').doc(tokenHash);
    await owner.db.runTransaction(async transaction => {
      const prior = await transaction.get(index);
      transaction.delete(current);
      if (prior.exists && prior.get('ownerId') === owner.uid && prior.get('deviceId') === id) transaction.delete(index);
    });
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return fail(cause);
  }
}
