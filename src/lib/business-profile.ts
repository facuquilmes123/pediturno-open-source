import { Timestamp } from 'firebase-admin/firestore';

const DEFAULT_ADDRESS = { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' };
const THEME_NAMES = new Set(['menta', 'ocaso', 'bosque', 'noche', 'cielo', 'coral', 'lavanda', 'custom']);
const BUSINESS_TYPES = new Set(['services', 'sports_facility', 'hybrid', 'spaces']);

export type JsonRecord = Record<string, unknown>;

export function validBookingSettingsInput(value: unknown): boolean {
  const settings = object(value);
  if (!settings) return false;
  for (const [key, min, max] of [['bookingLeadTimeHours', 0, 720], ['bookingHorizonDays', 1, 365], ['appointmentBufferMinutes', 0, 240]] as const) {
    if (key in settings && (!Number.isInteger(settings[key]) || (settings[key] as number) < min || (settings[key] as number) > max)) return false;
  }
  for (const key of ['autoConfirm', 'remindersEnabled', 'newAppointmentNotificationsEnabled']) {
    if (key in settings && typeof settings[key] !== 'boolean') return false;
  }
  if ('notificationEmail' in settings && (typeof settings.notificationEmail !== 'string' || settings.notificationEmail.length > 254 ||
      (settings.notificationEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.notificationEmail)))) return false;
  return true;
}

function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result.length <= max ? result : undefined;
}

export function normalizeSlug(value: unknown): string | null {
  const slug = text(value, 50)?.toLowerCase();
  return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 ? slug : null;
}

function safeAddress(value: unknown) {
  const input = object(value);
  if (!input) return undefined;
  const fields = ['street', 'number', 'city', 'province', 'postalCode', 'country'] as const;
  const address: Record<string, string> = {};
  for (const field of fields) {
    const result = text(input[field], 120);
    if (result !== undefined) address[field] = result;
  }
  return address;
}

function safeSocialLinks(value: unknown) {
  if (!Array.isArray(value) || value.length > 5) return undefined;
  const allowedTypes = new Set(['instagram', 'facebook', 'tiktok', 'website', 'x', 'youtube', 'linkedin', 'custom']);
  const links: Array<{ id: string; type: string; url: string; title?: string }> = [];
  for (const item of value) {
    const link = object(item);
    const id = text(link?.id, 80);
    const type = text(link?.type, 20);
    const url = text(link?.url, 2048);
    const title = text(link?.title, 120);
    if (!id || !type || !url || !allowedTypes.has(type)) return undefined;
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) return undefined; } catch { return undefined; }
    links.push({ id, type, url, ...(title ? { title } : {}) });
  }
  return links;
}

export function safeProfileUpdate(input: JsonRecord): JsonRecord {
  const result: JsonRecord = {};
  const name = text(input.name, 120); if (name !== undefined) result.name = name;
  const description = text(input.description, 2000); if (description !== undefined) result.description = description;
  const logo = text(input.logo, 2048);
  if (logo === '') result.logo = logo;
  else if (logo) {
    try {
      if (new URL(logo).protocol === 'https:') result.logo = logo;
    } catch { /* Invalid image URL is rejected by the API. */ }
  }
  const address = safeAddress(input.address); if (address) result.address = address;
  const businessType = text(input.businessType, 30); if (businessType && BUSINESS_TYPES.has(businessType)) result.businessType = businessType;
  const theme = text(input.theme, 20); if (theme && THEME_NAMES.has(theme)) result.theme = theme;
  if (typeof input.whatsappButtonEnabled === 'boolean') result.whatsappButtonEnabled = input.whatsappButtonEnabled;
  const whatsappNumber = text(input.whatsappNumber, 40); if (whatsappNumber !== undefined) result.whatsappNumber = whatsappNumber;
  const socialLinks = safeSocialLinks(input.socialLinks); if (socialLinks) result.socialLinks = socialLinks;
  if (input.location === null) result.location = null;
  const location = object(input.location);
  if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && Math.abs(location.lat as number) <= 90 && Math.abs(location.lng as number) <= 180) {
    result.location = { lat: location.lat, lng: location.lng };
  }
  const customTheme = object(input.customTheme);
  if (customTheme && ['primary', 'background', 'accent'].every(key => typeof customTheme[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(customTheme[key] as string))) {
    result.customTheme = { primary: customTheme.primary, background: customTheme.background, accent: customTheme.accent };
  }
  const settings = object(input.bookingSettings);
  if (settings) {
    const saved: JsonRecord = {};
    if (typeof settings.autoConfirm === 'boolean') saved.autoConfirm = settings.autoConfirm;
    if (typeof settings.remindersEnabled === 'boolean') saved.remindersEnabled = settings.remindersEnabled;
    if (typeof settings.newAppointmentNotificationsEnabled === 'boolean') saved.newAppointmentNotificationsEnabled = settings.newAppointmentNotificationsEnabled;
    const notificationEmail = text(settings.notificationEmail, 254);
    if (notificationEmail !== undefined && (notificationEmail === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail))) {
      saved.notificationEmail = notificationEmail;
    }
    for (const [key, min, max] of [['bookingLeadTimeHours', 0, 720], ['bookingHorizonDays', 1, 365], ['appointmentBufferMinutes', 0, 240]] as const) {
      if (Number.isInteger(settings[key]) && (settings[key] as number) >= min && (settings[key] as number) <= max) saved[key] = settings[key];
    }
    if (Object.keys(saved).length) result.bookingSettings = saved;
  }
  return result;
}

function publicBookingSettings(source: JsonRecord) {
  const settings = object(source.bookingSettings);
  const bufferDefault = source.businessType === 'spaces' ? 20 : 15;
  const integer = (key: string, min: number, max: number, fallback: number) =>
    Number.isInteger(settings?.[key]) && (settings![key] as number) >= min && (settings![key] as number) <= max
      ? settings![key] as number
      : fallback;
  return {
    autoConfirm: settings?.autoConfirm !== false,
    bookingHorizonDays: integer('bookingHorizonDays', 1, 365, 30),
    bookingLeadTimeHours: integer('bookingLeadTimeHours', 0, 720, 2),
    appointmentBufferMinutes: integer('appointmentBufferMinutes', 0, 240, bufferDefault),
  };
}

export function publicProjection(businessId: string, source: JsonRecord) {
  return {
    businessId, slug: source.slug, name: source.name || '', description: source.description || '', logo: source.logo || '',
    businessType: source.businessType || 'services', address: source.address || DEFAULT_ADDRESS, location: source.location || null,
    whatsappButtonEnabled: source.whatsappButtonEnabled === true, whatsappNumber: source.whatsappButtonEnabled === true ? source.whatsappNumber || '' : '',
    socialLinks: Array.isArray(source.socialLinks) ? source.socialLinks : [], theme: source.theme || 'menta', customTheme: source.customTheme || null,
    bookingSettings: publicBookingSettings(source),
    updatedAt: Timestamp.now(),
  };
}
