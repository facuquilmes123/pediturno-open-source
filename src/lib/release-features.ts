/** Online deposits for Servicios remain unavailable until the provider flow is accepted.
 * This affects new operations only; historical payments and settlement stay readable.
 */
export function canUseOnlineDeposits(businessType: unknown): boolean {
  return businessType === 'sports_facility' || businessType === 'hybrid' || businessType === 'spaces';
}

export const SERVICES_DEPOSITS_UNAVAILABLE = 'Las reservas de Servicios funcionan sin seña en esta versión. Acordá el cobro directamente con el negocio.';
