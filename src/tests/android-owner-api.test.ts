import { describe, expect, it } from 'vitest';
import { androidBusinessDto, androidAppointmentDto, deterministicAndroidRequestId, safeIdempotencyKey } from '@/lib/android-owner-api';

describe('Android owner API DTO boundary', () => {
  it('preserves paid deposit and review state while projecting only appointment fields', () => {
    const dto = androidAppointmentDto('appointment', { paymentStatus: 'reversal_review', depositAmount: 90, depositPaid: 90, paymentReviewRequired: true, encryptedAccessToken: 'must-not-leak' }, 'America/Argentina/Buenos_Aires');
    expect(dto).toMatchObject({ paymentStatus: 'reversal_review', depositAmount: 90, depositPaid: 90, paymentReviewRequired: true });
    expect(JSON.stringify(dto)).not.toContain('must-not-leak');
    expect(androidAppointmentDto('legacy', {}, 'America/Argentina/Buenos_Aires')).toMatchObject({ depositPaid: 0, paymentReviewRequired: false });
  });
  it('projects an effective Google Play entitlement without leaking Marketplace credentials', () => {
    const dto = androidBusinessDto('owner-1', {
      name: 'Servicios Uno', email: 'owner@example.test', status: 'active', businessType: 'services',
      membership: { type: 'pro', expiresAt: new Date(Date.now() - 60_000) },
      googlePlayMembership: { type: 'pro', source: 'GOOGLE_PLAY', productId: 'pediturno_servicios_pro_monthly', purchaseHash: 'a'.repeat(64), status: 'grace_period', expiresAt: new Date(Date.now() + 60_000), autoRenewEnabled: true },
      mercadopago: { accessToken: 'must-not-leak', refreshToken: 'must-not-leak', publicKey: 'must-not-leak' },
    });
    expect(dto.membership).toMatchObject({ type: 'pro', source: 'GOOGLE_PLAY', autoRenew: true });
    expect(JSON.stringify(dto)).not.toContain('must-not-leak');
  });

  it('does not expose Play renewal for a legacy entitlement with a stale Play record', () => {
    const dto = androidBusinessDto('owner-1', {
      name: 'Servicios Uno', status: 'active', businessType: 'services', membership: { type: 'lifetime' },
      googlePlayMembership: { type: 'pro', source: 'GOOGLE_PLAY', productId: 'pediturno_servicios_pro_monthly', purchaseHash: 'a'.repeat(64), status: 'expired', expiresAt: new Date(Date.now() - 60_000), autoRenewEnabled: true },
    });
    expect(dto.membership).toMatchObject({ type: 'lifetime', source: 'LEGACY', autoRenew: false });
  });

  it('names durable idempotency records by owner and operation, never by payload alone', () => {
    expect(deterministicAndroidRequestId('owner-a', 'owner-appointment-create', 'abcdefghijklmnop'))
      .not.toBe(deterministicAndroidRequestId('owner-b', 'owner-appointment-create', 'abcdefghijklmnop'));
    expect(deterministicAndroidRequestId('owner-a', 'owner-appointment-create', 'abcdefghijklmnop'))
      .not.toBe(deterministicAndroidRequestId('owner-a', 'another-operation', 'abcdefghijklmnop'));
  });

  it('accepts one standard idempotency header and rejects conflicting header values', () => {
    expect(safeIdempotencyKey(new Request('https://pediturno.test', { headers: { 'X-Idempotency-Key': 'abcdefghijklmnop' } }))).toBe('abcdefghijklmnop');
    expect(() => safeIdempotencyKey(new Request('https://pediturno.test', { headers: { 'X-Idempotency-Key': 'abcdefghijklmnop', 'Idempotency-Key': 'qrstuvwxyzabcdef' } }))).toThrow('Conflicting idempotency keys');
  });
});
