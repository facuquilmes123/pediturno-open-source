import { FieldValue } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { validBookingSettingsInput } from '@/lib/business-profile';
import { AndroidOwnerApiError, androidBusinessDto, androidError, asRecord, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';
import { isBusinessOperational } from '@/lib/server-membership';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SETTING_FIELDS = new Set([
  'autoConfirm', 'bookingLeadTimeHours', 'bookingHorizonDays',
  'appointmentBufferMinutes', 'remindersEnabled',
  'newAppointmentNotificationsEnabled', 'notificationEmail',
]);

function bookingSettingsDto(ownerId: string, business: Record<string, unknown>) {
  return androidBusinessDto(ownerId, business).bookingSettings;
}

function patchFrom(input: Record<string, unknown>) {
  if (Object.keys(input).length === 0 || Object.keys(input).some(field => !SETTING_FIELDS.has(field)) || !validBookingSettingsInput(input)) {
    throw new AndroidOwnerApiError(400, 'INVALID_BOOKING_SETTINGS', 'Invalid booking settings');
  }
  return input;
}

function failure(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('Settings unavailable', 503, 'SETTINGS_UNAVAILABLE');
}

export async function GET(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request);
    if (!isBusinessOperational(owner.business)) return androidError('Active membership required', 403, 'MEMBERSHIP_REQUIRED');
    return NextResponse.json({ bookingSettings: bookingSettingsDto(owner.uid, owner.business) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const patch = patchFrom(await readAndroidOwnerJson(request));
    const owner = await requireAndroidOwner(request);
    const businessRef = owner.db.collection('businesses').doc(owner.uid);
    const bookingSettings = await owner.db.runTransaction(async transaction => {
      const current = await transaction.get(businessRef);
      const business = current.data() as Record<string, unknown> | undefined;
      if (!current.exists || !business || business.status !== 'active') throw new AndroidOwnerApiError(403, 'BUSINESS_UNAVAILABLE', 'Business unavailable');
      if (business.businessType !== undefined && business.businessType !== 'services') throw new AndroidOwnerApiError(403, 'WRONG_BUSINESS_TYPE', 'This Android API is available for Servicios only');
      if (!isBusinessOperational(business)) throw new AndroidOwnerApiError(403, 'MEMBERSHIP_REQUIRED', 'Active membership required');
      const merged = { ...(asRecord(business.bookingSettings) || {}), ...patch };
      if (!validBookingSettingsInput(merged)) throw new AndroidOwnerApiError(400, 'INVALID_BOOKING_SETTINGS', 'Invalid booking settings');
      if (merged.newAppointmentNotificationsEnabled === true && (typeof merged.notificationEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(merged.notificationEmail))) {
        throw new AndroidOwnerApiError(400, 'INVALID_BOOKING_SETTINGS', 'Notification email is required when notifications are enabled');
      }
      transaction.update(businessRef, { bookingSettings: merged, lastModified: FieldValue.serverTimestamp() });
      return bookingSettingsDto(owner.uid, { ...business, bookingSettings: merged });
    });
    return NextResponse.json({ bookingSettings }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}
