import { getPediturnoPortalHost, getVerticalFromHost } from './verticals';

export const ESTETICA_GUIDE_PATH = '/guias/agenda-para-estetica';

const PUBLIC_EVENTS = ['hero_exposure', 'trial_cta', 'demo_open', 'business_created'] as const;
type PublicEvent = (typeof PUBLIC_EVENTS)[number];

// Only labels from the product catalog belong in optional browser measurement.
export function trackPublicEvent(name: PublicEvent, values: { vertical: string; variant: 'a' | 'b' }) {
  if (name === 'business_created' && typeof location !== 'undefined' && location.pathname === ESTETICA_GUIDE_PATH) {
    if (values.vertical === 'services') trackEsteticaEvent(name);
    return;
  }
  try {
    if (localStorage.getItem('pediturno_analytics_consent_v1') !== 'accepted') return;
    const host = getPediturnoPortalHost(location.hostname);
    if (!host || !PUBLIC_EVENTS.includes(name) || values.vertical !== getVerticalFromHost(host) ||
        (values.variant !== 'a' && values.variant !== 'b')) return;
    const win = window as Window & { gtag?: (...args: unknown[]) => void };
    if (!win.gtag) return;
    const key = `pediturno_event_hero_20261009_${name}_${values.variant}`;
    // Account creation is deduplicated by the profile transaction, not by browser session.
    if (name !== 'business_created' && sessionStorage.getItem(key) === 'sent') return;
    win.gtag('event', name, { vertical: values.vertical, variant: values.variant,
      experiment_id: 'hero_20261009', page_location: `https://${host}/`, page_referrer: '' });
    if (name !== 'business_created') sessionStorage.setItem(key, 'sent');
  } catch { /* Optional measurement never blocks the product. */ }
}

type EsteticaEvent = Extract<PublicEvent, 'demo_open' | 'trial_cta' | 'business_created'>;

export function trackEsteticaEvent(name: EsteticaEvent) {
  try {
    if (getPediturnoPortalHost(location.hostname) !== 'pediturno.com' || location.pathname !== ESTETICA_GUIDE_PATH ||
        localStorage.getItem('pediturno_analytics_consent_v1') !== 'accepted') return;
    const win = window as Window & { gtag?: (...args: unknown[]) => void };
    if (!win.gtag) return;
    const key = `pediturno_estetica_${name}`;
    if (name !== 'business_created' && sessionStorage.getItem(key) === 'sent') return;
    win.gtag('event', name, {
      vertical: 'services', case_id: 'estetica',
      page_location: 'https://pediturno.com' + ESTETICA_GUIDE_PATH, page_referrer: '',
    });
    if (name !== 'business_created') sessionStorage.setItem(key, 'sent');
  } catch { /* Optional measurement never blocks the product. */ }
}

export function heroAssignment(vertical: string): 'a' | 'b' {
  try {
    if (localStorage.getItem('pediturno_analytics_consent_v1') !== 'accepted') return 'a';
    const key = `pediturno_hero_20261009_${vertical}`;
    const existing = sessionStorage.getItem(key);
    if (existing === 'a' || existing === 'b') return existing;
    const variant = Math.random() < 0.5 ? 'a' : 'b';
    sessionStorage.setItem(key, variant);
    return variant;
  } catch { return 'a'; }
}
