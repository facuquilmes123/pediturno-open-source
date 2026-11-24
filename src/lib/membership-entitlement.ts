/** Shared selection only: rights are always persisted and verified by the server. */
export function entitlementMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (!value || typeof value !== 'object') return Number.NaN;
  const timestamp = value as { toMillis?: () => number; toDate?: () => Date };
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime();
  return Number.NaN;
}

export type EffectiveMembership = {
  type: 'trial' | 'pro' | 'lifetime'; startsAt?: unknown; expiresAt?: unknown;
  source?: string;
};

/** Keep prepaid legacy rights independent from Google renewal/revocation. */
export function getEffectiveMembership(business: unknown, now = Date.now()): EffectiveMembership | null {
  if (!business || typeof business !== 'object') return null;
  const record = business as Record<string, unknown>;
  const legacy = record.membership as EffectiveMembership | undefined;
  if (legacy?.type === 'lifetime') return legacy;
  const legacyValid = legacy && ['trial', 'pro'].includes(legacy.type) && entitlementMillis(legacy.expiresAt) > now;
  const play = record.googlePlayMembership as (EffectiveMembership & { status?: string; productId?: string; purchaseHash?: string }) | undefined;
  const isServices = record.businessType === 'services' || record.businessType === undefined || record.businessType === null;
  const playValid = isServices && play?.type === 'pro' && play.source === 'GOOGLE_PLAY'
    && play.productId === 'pediturno_servicios_pro_monthly' && /^[a-f0-9]{64}$/.test(play.purchaseHash || '')
    && ['active', 'grace_period'].includes(play.status || '')
    && entitlementMillis(play.expiresAt) > now;
  if (playValid && (!legacyValid || entitlementMillis(play.expiresAt) > entitlementMillis(legacy.expiresAt))) {
    return { ...play, source: 'GOOGLE_PLAY' };
  }
  return legacyValid ? legacy : null;
}

export function isServicesBusiness(business: unknown): boolean {
  if (!business || typeof business !== 'object') return true;
  const type = (business as Record<string, unknown>).businessType;
  return type === 'services' || type === undefined || type === null;
}

export type BusinessPlan = 'free' | 'pro';

export interface PlanEntitlement {
  plan: BusinessPlan;
  isPro: boolean;
  monthlyQuota: number | null; // 40 for free, null for pro
  source: 'GOOGLE_PLAY' | 'MERCADO_PAGO' | 'LEGACY' | 'FREE';
  status: string; // 'active', 'grace_period', 'lifetime', 'free', 'expired'
  expiresAt: string | null;
  autoRenew: boolean;
  effectiveMembership: EffectiveMembership | null;
}

export function getBusinessPlan(business: unknown, now = Date.now()): PlanEntitlement {
  const effective = getEffectiveMembership(business, now);
  const record = (business && typeof business === 'object') ? business as Record<string, unknown> : {};
  const isServices = isServicesBusiness(business);

  if (effective) {
    const isPlay = effective.source === 'GOOGLE_PLAY';
    const playRecord = record.googlePlayMembership as Record<string, unknown> | undefined;
    const expiryMillis = entitlementMillis(effective.expiresAt);
    const expiresAt = Number.isFinite(expiryMillis) ? new Date(expiryMillis).toISOString() : null;
    const status = isPlay && typeof playRecord?.status === 'string' ? playRecord.status
      : effective.type === 'lifetime' ? 'lifetime'
      : 'active';
    const autoRenew = isPlay && playRecord?.autoRenewEnabled === true;
    const source = isPlay ? 'GOOGLE_PLAY' : (effective.source === 'MERCADO_PAGO' ? 'MERCADO_PAGO' : 'LEGACY');

    return {
      plan: 'pro',
      isPro: true,
      monthlyQuota: null,
      source,
      status,
      expiresAt,
      autoRenew,
      effectiveMembership: effective,
    };
  }

  // No active paid membership
  if (isServices) {
    return {
      plan: 'free',
      isPro: false,
      monthlyQuota: 40,
      source: 'FREE',
      status: 'free',
      expiresAt: null,
      autoRenew: false,
      effectiveMembership: null,
    };
  }

  // Non-services without active membership is expired/none
  return {
    plan: 'free',
    isPro: false,
    monthlyQuota: 0,
    source: 'FREE',
    status: 'expired',
    expiresAt: null,
    autoRenew: false,
    effectiveMembership: null,
  };
}
