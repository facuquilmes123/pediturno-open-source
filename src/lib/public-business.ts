import 'server-only';
import { cache } from 'react';
import { getAdminFirestore } from '@/lib/firebase-admin';
import type { BusinessProfile, Cancha, Service, Space } from '@/services/data';
import { isBusinessOperational } from '@/lib/server-membership';
import { canUseOnlineDeposits } from '@/lib/release-features';

export interface PublicBusinessView {
  businessId: string;
  isQaFixture: boolean;
  business: BusinessProfile;
  services: Service[];
  canchas: Cancha[];
  spaces: Space[];
}

export const getPublicBusinessBySlug = cache(async (slug: string): Promise<PublicBusinessView | null> => {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) return null;
  const db = getAdminFirestore();
  const matches = await db.collection('businesses').where('slug', '==', slug).limit(2).get();
  if (matches.size !== 1) return null;
  const businessDoc = matches.docs[0];
  const source = businessDoc.data();
  if (!isBusinessOperational(source)) return null;

  // This explicit projection is the only business object serialized into the public page.
  // Never spread the original Firestore document: it can contain OAuth tokens and PII.
  const business: BusinessProfile = {
    id: businessDoc.id,
    email: '',
    name: String(source.name || ''),
    slug,
    businessType: source.businessType,
    timeZone: source.timeZone,
    description: source.description,
    logo: source.logo,
    address: source.address || { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' },
    location: source.location,
    whatsappButtonEnabled: Boolean(source.whatsappButtonEnabled),
    whatsappNumber: source.whatsappButtonEnabled === true ? source.whatsappNumber : '',
    socialLinks: source.socialLinks,
    theme: source.theme,
    customTheme: source.customTheme,
    mercadopago: { requireDeposit: canUseOnlineDeposits(source.businessType) && source.mercadopago?.requireDeposit === true, depositType: source.mercadopago?.depositType, depositValue: source.mercadopago?.depositValue },
    bookingSettings: {
      autoConfirm: source.bookingSettings?.autoConfirm !== false,
      bookingLeadTimeHours: Number(source.bookingSettings?.bookingLeadTimeHours || 0),
      bookingHorizonDays: Number(source.bookingSettings?.bookingHorizonDays || 30),
      appointmentBufferMinutes: Number(source.bookingSettings?.appointmentBufferMinutes || 0),
    },
  };

  const readResources = async (collection: string, enabled: boolean) => enabled
    ? (await db.collection(collection).where('businessId', '==', businessDoc.id).where('status', '==', 'Activo').get()).docs
    : [];
  const [serviceDocs, canchaDocs, spaceDocs] = await Promise.all([
    readResources('services', !['sports_facility', 'spaces'].includes(source.businessType)),
    readResources('canchas', ['sports_facility', 'hybrid'].includes(source.businessType)),
    readResources('spaces', source.businessType === 'spaces'),
  ]);
  const convertDates = (value: unknown): Date[] => Array.isArray(value)
    ? value.map(item => item?.toDate?.() || new Date(item)).filter(item => !Number.isNaN(item.getTime()))
    : [];
  const services = serviceDocs.map(doc => {
    const item = doc.data();
    return {
      id: doc.id, businessId: businessDoc.id,
      name: item.name, duration: item.duration, price: item.price,
      status: 'Activo' as const, photo: item.photo, workingHours: item.workingHours,
      unavailableDates: convertDates(item.unavailableDates),
      bookingBufferMinutes: item.bookingBufferMinutes,
    } satisfies Service;
  });
  const canchas = canchaDocs.map(doc => {
    const item = doc.data();
    return {
      id: doc.id, businessId: businessDoc.id,
      name: item.name, duration: item.duration, price: item.price,
      status: 'Activo' as const, photo: item.photo, sport: item.sport,
      workingHours: item.workingHours, unavailableDates: convertDates(item.unavailableDates),
      bookingBufferMinutes: item.bookingBufferMinutes,
    } satisfies Cancha;
  });
  const spaces = spaceDocs.map(doc => {
    const item = doc.data();
    return {
      id: doc.id, businessId: businessDoc.id, name: item.name,
      category: item.category, description: item.description, capacity: item.capacity,
      packages: item.packages, preparationMinutes: item.preparationMinutes,
      cleanupMinutes: item.cleanupMinutes, bookingBufferMinutes: item.bookingBufferMinutes,
      status: 'Activo' as const, photo: item.photo, photos: item.photos,
      workingHours: item.workingHours, unavailableDates: convertDates(item.unavailableDates),
    } satisfies Space;
  });
  return { businessId: businessDoc.id, isQaFixture: source.qaFixture === true, business,
    services: source.businessType === 'sports_facility' || source.businessType === 'spaces' ? [] : services,
    canchas: ['sports_facility', 'hybrid'].includes(source.businessType) ? canchas : [],
    spaces: source.businessType === 'spaces' ? spaces : [],
  };
});
