import { NextRequest, NextResponse } from 'next/server';
import { POST as legacyNotify } from '@/app/api/owner/appointments/notify/route';
import { AndroidOwnerApiError, androidError, isDocumentId, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';
import { isBusinessOperational } from '@/lib/server-membership';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type NotificationKind = 'confirmation' | 'cancellation' | 'reminder';
const KINDS = new Set<NotificationKind>(['confirmation', 'cancellation', 'reminder']);

function failure(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('Notification unavailable', 503, 'NOTIFICATION_UNAVAILABLE');
}

/**
 * Typed v1 boundary over the established notification workflow. The legacy
 * handler still owns delivery leases and email idempotency, while this route
 * enforces the Android Servicios scope before it is invoked.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ appointmentId: string }> }) {
  try {
    const { appointmentId } = await params;
    const input = await readAndroidOwnerJson(request.clone(), 1024);
    if (!isDocumentId(appointmentId) || Object.keys(input).length !== 1 || !KINDS.has(input.kind as NotificationKind)) {
      return androidError('Invalid notification request', 400, 'INVALID_NOTIFICATION');
    }
    const owner = await requireAndroidOwner(request);
    if (!isBusinessOperational(owner.business)) return androidError('Active membership required', 403, 'MEMBERSHIP_REQUIRED');
    const headers = new Headers(request.headers);
    headers.delete('content-length'); headers.set('content-type', 'application/json');
    const legacyRequest = new NextRequest(new URL('/api/owner/appointments/notify', request.url), {
      method: 'POST', headers, body: JSON.stringify({ appointmentId, kind: input.kind }),
    });
    const legacy = await legacyNotify(legacyRequest);
    const payload = await legacy.json().catch(() => null);
    if (legacy.ok) return NextResponse.json(payload, { status: legacy.status, headers: { 'Cache-Control': 'no-store' } });
    const code = legacy.status === 401 ? 'AUTH_REQUIRED'
      : legacy.status === 403 ? 'MEMBERSHIP_REQUIRED'
        : legacy.status === 404 ? 'APPOINTMENT_NOT_FOUND'
          : legacy.status === 409 ? 'NOTIFICATION_REJECTED'
            : legacy.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'NOTIFICATION_UNAVAILABLE';
    const message = typeof payload?.error === 'string' ? payload.error : 'Notification unavailable';
    return androidError(message, legacy.status, code);
  } catch (cause) {
    return failure(cause);
  }
}
