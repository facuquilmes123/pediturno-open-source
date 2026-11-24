
export const ADMIN_EMAILS = ['admin@example.com', 'ops@example.com'];

/**
 * Membership prices are determined exclusively from the persisted business
 * vertical. Checkout callers never provide an amount or a vertical.
 */
export const SERVICE_MEMBERSHIP_PRICE_ARS = 5000;
// ARS is retained for legacy accounting only; new Services purchases use Play ProductDetails.
export const SERVICE_MEMBERSHIP_PRICE_USD = 7;
export const SERVICE_MEMBERSHIP_PRICE_LABEL = 'USD 7';
export const SERVICE_PLAY_PRODUCT_ID = 'pediturno_servicios_pro_monthly';
export const SERVICE_PLAY_PACKAGE = 'com.pediturno.servicios';
export const SERVICE_PLAY_URL = `https://play.google.com/store/apps/details?id=${SERVICE_PLAY_PACKAGE}`;
export function usesGooglePlayMembership(businessType: unknown): boolean {
  return businessType === 'services' || businessType === undefined || businessType === null;
}
export const SPORTS_MEMBERSHIP_PRICE_ARS = 10000;
export const SPACES_MEMBERSHIP_PRICE_ARS = 15000;

export type MembershipPlanVertical = 'services' | 'sports_facility' | 'hybrid' | 'spaces';

/**
 * Old service accounts did not persist a vertical. They keep the services
 * price; any explicit non-services vertical is priced as a sports plan.
 */
export function getMembershipPlanVertical(businessType: unknown): MembershipPlanVertical {
  if (businessType === 'services' || businessType === undefined || businessType === null) return 'services';
  if (businessType === 'sports_facility') return 'sports_facility';
  if (businessType === 'spaces') return 'spaces';
  if (businessType === 'hybrid') return 'hybrid';
  // A malformed persisted value must not downgrade a sports-capable business.
  return 'sports_facility';
}

export function getMembershipPriceArs(businessType: unknown): number {
  const vertical = getMembershipPlanVertical(businessType);
  if (vertical === 'services') return SERVICE_MEMBERSHIP_PRICE_ARS;
  if (vertical === 'spaces') return SPACES_MEMBERSHIP_PRICE_ARS;
  return SPORTS_MEMBERSHIP_PRICE_ARS;
}

export function getMembershipPriceLabel(businessType: unknown): string {
  if (usesGooglePlayMembership(businessType)) return SERVICE_MEMBERSHIP_PRICE_LABEL;
  const price = getMembershipPriceArs(businessType);
  return price === SERVICE_MEMBERSHIP_PRICE_ARS ? SERVICE_MEMBERSHIP_PRICE_LABEL : price === SPACES_MEMBERSHIP_PRICE_ARS ? '$15.000' : '$10.000';
}

// Kept for older services-only consumers. New code must use the helper above
// with the persisted business profile.
export const MEMBERSHIP_PRICE_ARS = SERVICE_MEMBERSHIP_PRICE_ARS;
export const MEMBERSHIP_PRICE_LABEL = 'USD 7';
