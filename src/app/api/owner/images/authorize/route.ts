import { NextRequest, NextResponse } from 'next/server';
import { readAndroidOwnerJson, requireAndroidOwner, safeIdempotencyKey, androidError, AndroidOwnerApiError } from '@/lib/android-owner-api';
import { authorizeImageUpload, imageUploadInput, ImagePermitError } from '@/lib/image-upload-permits';
import { checkOwnerReadRateLimit, ownerReadRateLimitResponse } from '@/lib/owner-read-rate-limit';
import { verifyPublicAppCheck } from '@/lib/app-check-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const input = imageUploadInput(await readAndroidOwnerJson(request));
    const key = safeIdempotencyKey(request);
    if (!key) return androidError('Falta identificar la operación de imagen.', 400, 'INVALID_IDEMPOTENCY_KEY');
    const owner = await requireAndroidOwner(request, { allowOtherBusinessTypes: true });
    const admission = await checkOwnerReadRateLimit(owner.db, owner.uid);
    if (!admission.allowed) return ownerReadRateLimitResponse(admission);
    if (!await verifyPublicAppCheck(request, { consume: true })) return androidError('No pudimos verificar la aplicación. Volvé a intentar.', 403, 'APP_CHECK_REQUIRED');
    const permit = await authorizeImageUpload(owner.db, owner.uid, key, input);
    return NextResponse.json(permit, { status: permit.repeated ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ImagePermitError) return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.status, headers: { 'Cache-Control': 'no-store', ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) },
    });
    if (error instanceof AndroidOwnerApiError) return androidError(error.message, error.status, error.code);
    return androidError('No pudimos autorizar la imagen. Intentá nuevamente.', 503, 'IMAGE_UPLOAD_UNAVAILABLE');
  }
}
