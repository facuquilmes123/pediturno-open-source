import { confirmImagePermits, ImagePermitError } from '@/lib/image-upload-permits';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp, type DocumentData, type UpdateData } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getAdminFirestore, initializeAdminApp } from '@/lib/firebase-admin';
import { normalizeSlug, publicProjection, safeProfileUpdate, validBookingSettingsInput, type JsonRecord } from '@/lib/business-profile';
import { sendWelcomeEmail } from '@/services/email';
import { isBusinessOperational } from '@/lib/server-membership';
import { ADMIN_EMAILS } from '@/lib/config';
import { getPediturnoPortalHost, getVerticalFromHost } from '@/lib/verticals';
import { verifyPublicAppCheck } from '@/lib/app-check-server';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';

import { queueOwnedImageCleanup, runOwnedImageCleanup } from '@/lib/owned-image-cleanup';

const TRIAL_DAYS = 15;
const DEFAULT_ADDRESS = { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' };
function response(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 16_384) return response('Payload too large', 413);
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return response('Authentication required', 401);

  let input: JsonRecord | null;
  try {
    const parsed = await readLimitedJson(request, 16_384);
    input = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch (error) { return response('Invalid request', error instanceof RequestBodyTooLarge ? 413 : 400); }
  if (!input) return response('Invalid request', 400);
  if ('bookingSettings' in input && !validBookingSettingsInput(input.bookingSettings)) return response('Invalid booking settings', 400);

  try {
    initializeAdminApp();
    const identity = await getAuth().verifyIdToken(token, true);
    const uid = identity.uid;
    const profile = safeProfileUpdate(input);
    if (Object.prototype.hasOwnProperty.call(input, 'socialLinks') && !Object.prototype.hasOwnProperty.call(profile, 'socialLinks')) {
      return response('Revisá los enlaces de redes sociales.', 400);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'logo') && !Object.prototype.hasOwnProperty.call(profile, 'logo')) {
      return response('Invalid image URL or image storage unavailable', 400);
    }
    const hasSlug = Object.prototype.hasOwnProperty.call(input, 'slug');
    const requestedSlug = hasSlug && typeof input.slug === 'string' && input.slug.trim() === ''
      ? null
      : hasSlug ? normalizeSlug(input.slug) : undefined;
    if (hasSlug && requestedSlug === null && !(typeof input.slug === 'string' && input.slug.trim() === '')) return response('Invalid slug', 400);
    const db = getAdminFirestore();
    const businessRef = db.collection('businesses').doc(uid);
    // Existing accounts retain access; a new trial requires an owned email and a verified app request.
    const existingProfile = await businessRef.get();
    const accountVertical = existingProfile.exists
      ? existingProfile.data()?.businessType || 'services'
      : getVerticalFromHost(request.headers.get('host') || new URL(request.url).hostname);
    const requestedBuffer = (input.bookingSettings as JsonRecord | undefined)?.appointmentBufferMinutes;
    if (accountVertical === 'spaces' && requestedBuffer !== undefined && (typeof requestedBuffer !== 'number' || requestedBuffer % 10 !== 0)) {
      return response('El intervalo de Espacios debe ser múltiplo de 10 minutos.', 400);
    }
    const bootstrapVerified = existingProfile.exists || (identity.email_verified === true && await verifyPublicAppCheck(request));

    const saved = await db.runTransaction(async transaction => {
      const current = await transaction.get(businessRef);
      if (!current.exists && (await transaction.get(db.collection('businessDeletions').doc(uid))).exists) throw new Error('ACCOUNT_DELETED');
      if (!current.exists && (!bootstrapVerified || identity.email_verified !== true)) throw new Error('EMAIL_VERIFICATION_REQUIRED');
      const now = Timestamp.now();
      const oldData = current.exists ? current.data() || {} : {};
      if (current.exists && profile.businessType && profile.businessType !== (oldData.businessType || 'services')) {
        throw new Error('PRODUCT_CHANGE_REQUIRES_SUPPORT');
      }
      if (!current.exists) {
        // Product is bound to the trusted site hostname; request JSON cannot select a cheaper plan.
        const vertical = getVerticalFromHost(request.headers.get('host') || new URL(request.url).hostname);
        if (profile.businessType && profile.businessType !== vertical) throw new Error('WRONG_PRODUCT_PORTAL');
        profile.businessType = vertical;
      }
      if (current.exists && !isBusinessOperational(oldData, now.toMillis())) {
        throw new Error('MEMBERSHIP_REQUIRED');
      }
      const oldSlug = typeof oldData.slug === 'string' ? oldData.slug : undefined;
      const nextSlug = requestedSlug === undefined ? oldSlug : requestedSlug || undefined;
      const slugRef = nextSlug ? db.collection('publicBusinesses').doc(nextSlug) : null;
      const oldPublicRef = oldSlug && oldSlug !== nextSlug ? db.collection('publicBusinesses').doc(oldSlug) : null;
      const slugSnapshot = slugRef && nextSlug !== oldSlug ? await transaction.get(slugRef) : null;
      if (slugSnapshot?.exists && slugSnapshot.get('businessId') !== uid) throw new Error('SLUG_TAKEN');

      await confirmImagePermits(transaction, db, uid, [profile.logo], `businesses/${uid}`);
      if ('logo' in profile && profile.logo !== oldData.logo) queueOwnedImageCleanup(transaction, db, uid, oldData.logo, 'logos');
      const changes: JsonRecord = { ...profile, lastModified: now };
      if (profile.bookingSettings && typeof profile.bookingSettings === 'object') {
        changes.bookingSettings = {
          autoConfirm: true, bookingHorizonDays: 30, bookingLeadTimeHours: 2, appointmentBufferMinutes: accountVertical === 'spaces' ? 20 : 15,
          ...oldData.bookingSettings,
          ...profile.bookingSettings as JsonRecord,
        };
      }
      if (requestedSlug !== undefined) changes.slug = requestedSlug || FieldValue.delete();
      let created = false;
      let welcomeName = '';
      if (!current.exists) {
        created = true;
        const startsAt = now.toDate();
        const expiresAt = new Date(startsAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
        welcomeName = typeof profile.name === 'string' && profile.name ? profile.name : (identity.name || identity.email?.split('@')[0] || 'Mi negocio');
        transaction.create(businessRef, {
          id: uid,
          email: identity.email || '',
          name: welcomeName,
          address: profile.address || DEFAULT_ADDRESS,
          status: 'active',
          whatsappButtonEnabled: false,
          socialLinks: [],
          theme: 'menta',
          bookingSettings: { autoConfirm: true, bookingHorizonDays: 30, bookingLeadTimeHours: 2, appointmentBufferMinutes: accountVertical === 'spaces' ? 20 : 15 },
          // The role is verified on the server, and the entitlement is persisted
          // so Storage, public booking and owner APIs use the same source of truth.
          membership: identity.email_verified === true && identity.email && ADMIN_EMAILS.includes(identity.email)
            ? { type: 'lifetime', startsAt: now, expiresAt: null }
            : (accountVertical === 'services'
              ? { type: 'free', plan: 'free', startsAt: now, expiresAt: null }
              : { type: 'trial', startsAt: now, expiresAt: Timestamp.fromDate(expiresAt) }),
          createdAt: now,
          ...changes,
          signupPortalHost: getPediturnoPortalHost(request.headers.get('host') ?? new URL(request.url).hostname),
        });
      } else {
        transaction.update(businessRef, changes as UpdateData<DocumentData>);
      }
      const merged = { ...oldData, ...changes, slug: nextSlug } as JsonRecord;
      if (slugRef && nextSlug) transaction.set(slugRef, publicProjection(uid, merged));
      if (oldPublicRef) transaction.delete(oldPublicRef);
      return { slug: nextSlug || null, created, welcomeName, businessType: merged.businessType };
    });
    await runOwnedImageCleanup(db, uid);
    if (saved.created && identity.email) {
      try { await sendWelcomeEmail({ email: identity.email, name: saved.welcomeName, businessType: saved.businessType as 'services' | 'sports_facility' | 'hybrid' | 'spaces' }); }
      catch { console.warn('Welcome email could not be sent'); }
    }
    return NextResponse.json({ ok: true, slug: saved.slug, created: saved.created }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    if (cause instanceof ImagePermitError) return response(cause.message, cause.status);
    if (cause instanceof Error && cause.message === 'PRODUCT_CHANGE_REQUIRES_SUPPORT') return response('La modalidad pertenece a tu cuenta. Contactá a soporte para solicitar un cambio de producto.', 409);
    if (cause instanceof Error && cause.message === 'WRONG_PRODUCT_PORTAL') return response('Creá la cuenta desde el portal correspondiente a Servicios, Canchas o Espacios.', 400);
    if (cause instanceof Error && cause.message === 'ACCOUNT_DELETED') return response('Account deletion in progress or completed', 403);
    if (cause instanceof Error && cause.message === 'EMAIL_VERIFICATION_REQUIRED') return response('Verificá tu correo electrónico antes de activar la cuenta.', 403);
    if (cause instanceof Error && cause.message === 'SLUG_TAKEN') return response('Slug unavailable', 409);
    if (cause instanceof Error && cause.message === 'MEMBERSHIP_REQUIRED') return response('Active membership required', 403);
    console.error('Business profile update rejected');
    return response('Unable to save business profile', 500);
  }
}
