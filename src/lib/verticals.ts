export type ProductVertical = 'services' | 'sports_facility' | 'spaces';

export type PediturnoPortalHost = 'pediturno.com' | 'canchas.pediturno.com' | 'espacios.pediturno.com';

export function getPediturnoPortalHost(host: string | null | undefined): PediturnoPortalHost | null {
  const hostname = host?.trim().toLowerCase();
  if (!hostname || !/^[a-z0-9.]+(?::[0-9]{1,5})?$/.test(hostname)) return null;
  const name = hostname.split(':')[0];
  if (name === 'www.pediturno.com' || name === 'pediturno.com') return 'pediturno.com';
  if (name === 'canchas.pediturno.com' || name === 'espacios.pediturno.com') return name;
  return null;
}

export function getVerticalFromHost(host: string | null | undefined): ProductVertical {
  const hostname = getPediturnoPortalHost(host);
  if (hostname === 'canchas.pediturno.com') return 'sports_facility';
  if (hostname === 'espacios.pediturno.com') return 'spaces';
  return 'services';
}

export function getVerticalFromBusinessType(type: unknown): ProductVertical {
  if (type === 'spaces') return 'spaces';
  return type === 'sports_facility' || type === 'hybrid' ? 'sports_facility' : 'services';
}

export function getVerticalOrigin(vertical: ProductVertical): string {
  if (vertical === 'sports_facility') return 'https://canchas.pediturno.com';
  if (vertical === 'spaces') return 'https://espacios.pediturno.com';
  return 'https://pediturno.com';
}

export function getBusinessBookingUrl(type: unknown, slug: string): string {
  return `${getVerticalOrigin(getVerticalFromBusinessType(type))}/${encodeURIComponent(slug)}`;
}
