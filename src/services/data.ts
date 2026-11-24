import { readOwnerProfile, readOwnerAppointments, subscribeOwnerAppointments } from '@/lib/owner-workspace-client';
import { readOwnerCatalog } from '@/lib/owner-catalog-read';
import { readOwnerClients } from '@/lib/owner-clients-read';
import { resourceErrorMessage } from '@/lib/resource-errors';


import { db, storage, auth as firebaseAuth } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, setDoc, query, where, addDoc, updateDoc, Timestamp, orderBy, limit, writeBatch, deleteDoc, CollectionReference, DocumentReference, Firestore, QueryDocumentSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { ThemeName } from '@/lib/themes';
import { subDays, addMonths } from 'date-fns';
import { optimizeImage } from '@/lib/image-utils';
import { isBusinessOperational } from '@/lib/server-membership';
import { validateCanchaWrite } from '@/lib/cancha-validation';
import { validateServiceWrite } from '@/lib/service-validation';
import { publicAppCheckHeaders } from '@/lib/app-check-client';
import { clearOwnerOperation, prepareOwnerOperation } from '@/lib/owner-operation-idempotency';

export { CANCHA_DURATIONS, CANCHA_SPORTS, normalizeCanchaPrice, validateWorkingHours } from '@/lib/cancha-validation';


export type SocialLinkType = 'instagram' | 'facebook' | 'tiktok' | 'website' | 'x' | 'youtube' | 'linkedin' | 'custom';

export interface SocialLink {
  id: string;
  type: SocialLinkType;
  url: string;
  title?: string;
}

export type WorkingHours = {
  [key: number]: { 
    slots: { start: string; end: string }[];
    isAlternating?: boolean;
  };
};

// Use a union type to correctly handle data from Firestore (Timestamp) and in the app (Date)
export type FirestoreDate = Date | Timestamp;

export interface Service {
  id: string;
  name: string;
  duration: string;
  price: string;
  status: 'Activo' | 'Pausado';
  businessId: string; // Foreign key to the user/business
  photo?: string; // URL to the image in Firebase Storage
  workingHours?: WorkingHours;
  unavailableDates?: Date[];
  bookingBufferMinutes?: number | null;
}

export interface NewServiceData {
    name: string;
    duration: string;
    price: string;
    status: 'Activo' | 'Pausado';
    businessId: string;
    photo?: string; // URL to the image in Firebase Storage
    workingHours?: WorkingHours;
    unavailableDates?: Date[];
    bookingBufferMinutes?: number | null;
}

export interface Cancha {
  id: string;
  name: string;
  price: string;
  duration: number; // Duration in minutes
  status: 'Activo' | 'Pausado';
  businessId: string;
  photo?: string;
  sport?: 'futbol' | 'padel' | 'tenis' | 'otro';
  workingHours?: WorkingHours;
  unavailableDates?: Date[];
  bookingBufferMinutes?: number | null;
}

export interface NewCanchaData {
  name: string;
  price: string;
  duration: number;
  status: 'Activo' | 'Pausado';
  businessId: string;
  photo?: string;
  sport?: 'futbol' | 'padel' | 'tenis' | 'otro';
  workingHours?: WorkingHours;
  unavailableDates?: Date[];
  bookingBufferMinutes?: number | null;
}

export type SpaceCategory = 'salon' | 'quincho' | 'sum' | 'quinta' | 'terraza' | 'jardin' | 'auditorio' | 'capacitacion' | 'estudio_fotografico' | 'otro';

export interface SpacePackage {
  durationMinutes: 240 | 480 | 720 | 1440;
  price: string;
}

export interface Space {
  id: string;
  businessId: string;
  name: string;
  category: SpaceCategory;
  description?: string;
  capacity?: number;
  packages: SpacePackage[];
  preparationMinutes: number;
  cleanupMinutes: number;
  bookingBufferMinutes?: number | null;
  status: 'Activo' | 'Pausado';
  photo?: string;
  photos?: string[];
  workingHours?: WorkingHours;
  unavailableDates?: Date[];
}

export type NewSpaceData = Omit<Space, 'id'>;

function assertCanchaData(data: Partial<NewCanchaData>, creating: boolean): Partial<NewCanchaData> {
  const { businessId, ...mutableData } = data;
  const result = validateCanchaWrite(mutableData, creating);
  if (!result.data) throw new Error(result.error || 'Los datos de la cancha no son válidos.');
  const { unavailableDates, ...validatedData } = result.data;
  const clean: Partial<NewCanchaData> = {
    ...validatedData,
    ...(unavailableDates ? { unavailableDates: unavailableDates as Date[] } : {}),
  };
  if (creating || clean.businessId !== undefined) {
    if (typeof businessId !== 'string' || !/^[\w-]{1,128}$/.test(businessId)) {
      throw new Error('El negocio de la cancha no es válido.');
    }
    clean.businessId = businessId;
  }
  return clean;
}

export type AppointmentStatus = 'Confirmado' | 'Pendiente' | 'Completado' | 'Cancelado';

export interface Appointment {
  id?: string;
  client: string;
  clientId?: string; // Add clientId to Appointment interface
  service?: string;
  serviceId?: string;
  canchaId?: string;
  spaceId?: string;
  durationMinutes?: number;
  /** Immutable amount captured when the booking was created; legacy records omit it. */
  priceAtBooking?: number;
  paymentStatus?: 'pending' | 'paid' | 'expired' | 'reversal_review';
  depositAmount?: number;
  depositPaid?: number;
  paymentReviewRequired?: boolean;
  cancha?: string;
  space?: string;
  preparationMinutes?: number;
  cleanupMinutes?: number;
  bookingBufferMinutes?: number;
  preparationMinutesAtBooking?: number;
  cleanupMinutesAtBooking?: number;
  bookingBufferMinutesAtBooking?: number;
  occupiedStartAt?: Date | string;
  occupiedEndAt?: Date | string;
  time: string;
  avatar: string; // URL to the image
  date: Date;
  status: AppointmentStatus;
  businessId: string; // Foreign key to the user/business
  clientEmail?: string;
  clientPhone: string;
}

export interface Client {
    id: string;
    businessId: string;
    name: string;
    phone: string;
    email?: string;
    avatar?: string; // URL to the image
    lastAppointment: Date | null;
}

export interface Address {
    street: string;
    number: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
}

export interface CustomThemeData {
  primary: string; // hex color
  background: string; // hex color
  accent: string; // hex color
}

export interface BookingSettings {
    bookingLeadTimeHours: number; // Minimum hours before a booking can be made
    bookingHorizonDays: number;   // How many days in the future can be booked
    autoConfirm: boolean;         // Whether bookings are automatically confirmed
    appointmentBufferMinutes?: number; // Time in minutes between appointments
    remindersEnabled?: boolean; // Whether to send 24-hour email reminders
    newAppointmentNotificationsEnabled?: boolean;
    notificationEmail?: string;
}

export interface Membership {
    type: 'trial' | 'pro' | 'lifetime';
    startsAt?: Date | Timestamp | null;
    expiresAt?: Date | Timestamp | null;
}

export type BusinessType = 'services' | 'sports_facility' | 'spaces' | 'hybrid';

export interface MercadoPagoBusinessSettings {
    isConnected?: boolean;
    userId?: string;
    publicKey?: string;
    accessToken?: string;
    refreshToken?: string;
    connectedAt?: Date | Timestamp;
    requireDeposit?: boolean;
    depositType?: 'fixed' | 'percentage';
    depositValue?: number;
}

export interface BusinessProfile {
    id: string;
    email: string;
    createdAt?: Date | Timestamp;
    lastModified?: Date | Timestamp;
    name: string;
    slug?: string;
    businessType?: BusinessType;
    timeZone?: string;
    description?: string;
    logo?: string; // URL to the image
    address: Address;
    status?: 'active' | 'blocked';
    location?: {
        lat: number;
        lng: number;
    };
    whatsappButtonEnabled?: boolean;
    whatsappNumber?: string;
    socialLinks?: SocialLink[];
    theme?: ThemeName | 'custom';
    customTheme?: CustomThemeData;
    bookingSettings?: BookingSettings;
    membership?: Membership;
    googlePlayMembership?: Membership & {
        status: 'active' | 'grace_period' | 'canceled_active' | 'expired' | 'on_hold' | 'pending' | 'revoked' | 'paused';
        source?: 'GOOGLE_PLAY'; productId?: string; autoRenewEnabled?: boolean;
    };
    mercadopago?: MercadoPagoBusinessSettings;
    services?: Service[]; // Add this line
    canchas?: Cancha[];
    spaces?: Space[];
}

// For georef-ar-api suggestions
export interface GeorefSuggestion {
    id: string;
    nombre: string;
    nomenclatura?: string;
}

// Data for creating a new appointment
export interface NewAppointmentData {
    businessId: string;
    client: string;
    clientPhone: string;
    clientId?: string; // Add clientId to NewAppointmentData interface
    clientEmail?: string;
    service?: string;
    serviceId?: string;
    canchaId?: string;
    spaceId?: string;
    durationMinutes?: number;
    cancha?: string;
    space?: string;
    date: Date;
    time: string;
    status: AppointmentStatus;
}


// Helper function to convert a Firestore document to an Appointment object
function docToAppointment(doc: QueryDocumentSnapshot): Appointment {
    const data = doc.data();
    let date;
    if (data.date && data.date instanceof Timestamp) {
        date = data.date.toDate();
    } else if (data.date) {
        date = new Date(data.date);
    } else {
        // Fallback to current date if date is missing, though this indicates a data integrity issue.
        date = new Date(); 
    }
    return {
        id: doc.id,
        ...data,
        date: date,
        occupiedStartAt: data.occupiedStartAt instanceof Timestamp ? data.occupiedStartAt.toDate() : data.occupiedStartAt,
        occupiedEndAt: data.occupiedEndAt instanceof Timestamp ? data.occupiedEndAt.toDate() : data.occupiedEndAt,
    } as Appointment;
}


// A new function to find a businessId by its slug
export async function getBusinessIdBySlug(slug: string): Promise<string | null> {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    if (!token) throw new Error('Debes iniciar sesión para verificar la URL.');
    const response = await fetch(`/api/business/slug?slug=${encodeURIComponent(slug)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'No se pudo verificar la URL.');
    // The client only needs occupancy, never the identifier of another tenant.
    return body.available === true ? null : '__slug_taken__';
}


export async function getServices(businessId?: string): Promise<Service[]> {
    if (!db) return [];
    const ownerId = businessId || firebaseAuth?.currentUser?.uid;
    if (!ownerId) throw new Error('Debes iniciar sesión para cargar el catálogo.');
    return readOwnerCatalog(ownerId, 'services');
}

export async function createService(serviceData: NewServiceData): Promise<string> {
    const { businessId, ...mutableData } = serviceData;
    if (typeof businessId !== 'string' || !/^[\w-]{1,128}$/.test(businessId)) throw new Error('El negocio no es válido.');
    const validated = validateServiceWrite(mutableData, true);
    if (!validated.data) throw new Error(validated.error || 'Los datos del servicio no son válidos.');
    if (validated.data.status === 'Activo' && !validated.data.workingHours) throw new Error('Configurá la disponibilidad antes de activar un servicio.');
    const result = await ownerServiceRequest('POST', validated.data);
    if (typeof result.id !== 'string' || !/^[\w-]{1,128}$/.test(result.id)) throw new Error('No se pudo confirmar el servicio creado. Recargá la lista antes de reintentar.');
    return result.id;
}

export async function updateService(serviceId: string, serviceData: Partial<NewServiceData>) {
    if (!/^[\w-]{1,128}$/.test(serviceId)) throw new Error('El servicio no es válido.');
    const { businessId: _businessId, ...mutableData } = serviceData;
    const validated = validateServiceWrite(mutableData, false);
    if (!validated.data) throw new Error(validated.error || 'Los datos del servicio no son válidos.');
    await ownerServiceRequest('PATCH', { serviceId, ...validated.data });
}

export async function deleteService(serviceId: string): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(serviceId)) throw new Error('El servicio no es válido.');
    await ownerServiceRequest('DELETE', { serviceId });
}

async function ownerServiceRequest(method: 'POST' | 'PATCH' | 'DELETE', data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = firebaseAuth?.currentUser;
    if (!user) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
    const token = await user.getIdToken();
    const payload = serializeCanchaPayload(data);
    const operation = method === 'POST'
        ? await prepareOwnerOperation({ uid: user.uid, operation: 'owner-service-create', payload })
        : null;
    const response = await fetch('/api/owner/services', { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(operation ? { 'X-Idempotency-Key': operation.key } : {}) }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 409 && body.error === 'Service has active reservations') throw new Error('SERVICE_HAS_ACTIVE_RESERVATIONS');
        throw new Error(resourceErrorMessage(body.error, 'No se pudo guardar el servicio. Recargá el listado antes de reintentar.'));
    }
    if (operation) clearOwnerOperation(operation);
    return body;
}

export async function getCanchas(businessId: string): Promise<Cancha[]> {
    if (!db) return [];
    const ownerId = businessId || firebaseAuth?.currentUser?.uid;
    if (!ownerId) throw new Error('Debes iniciar sesión para cargar el catálogo.');
    return readOwnerCatalog(ownerId, 'canchas');
}

export async function getCanchaById(canchaId: string): Promise<Cancha | null> {
    if (!db) return null;
    const canchaDocRef = doc(db, 'canchas', canchaId);
    const docSnap = await getDoc(canchaDocRef);
    if (!docSnap.exists()) return null;
    const data = docSnap.data();
    return {
        id: docSnap.id,
        ...data,
        unavailableDates: (data.unavailableDates || []).map((d: any) => d instanceof Timestamp ? d.toDate() : new Date(d)),
    } as Cancha;
}

export async function createCancha(canchaData: NewCanchaData): Promise<string> {
    const dataToSave: any = assertCanchaData(canchaData, true);
    if (dataToSave.status === 'Activo' && !dataToSave.workingHours) {
        throw new Error('Configurá la disponibilidad antes de activar una cancha.');
    }
    delete dataToSave.businessId;
    const result = await ownerCanchaRequest('/api/owner/canchas', 'POST', dataToSave);
    return result.id as string;
}

export async function updateCancha(canchaId: string, canchaData: Partial<NewCanchaData>): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(canchaId)) throw new Error('La cancha no es válida.');
    const dataToSave: any = assertCanchaData(canchaData, false);
    delete dataToSave.businessId;
    await ownerCanchaRequest('/api/owner/canchas', 'PATCH', { canchaId, ...dataToSave });
}

export async function deleteCancha(canchaId: string): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(canchaId)) throw new Error('La cancha no es válida.');
    await ownerCanchaRequest('/api/owner/canchas', 'DELETE', { canchaId });
}

function serializeCanchaPayload(data: Record<string, unknown>): Record<string, unknown> {
    if (!Array.isArray(data.unavailableDates)) return data;
    return {
        ...data,
        unavailableDates: data.unavailableDates.map(date => date instanceof Date ? date.toISOString() : date),
    };
}

async function ownerCanchaRequest(path: string, method: 'POST' | 'PATCH' | 'DELETE', data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = firebaseAuth?.currentUser;
    if (!user) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
    const token = await user.getIdToken();
    const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(serializeCanchaPayload(data)),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 409 && payload.error === 'Cancha has active reservations') {
            throw new Error('CANCHA_HAS_ACTIVE_RESERVATIONS');
        }
        throw new Error(resourceErrorMessage(payload.error, 'No se pudo guardar la cancha. Recargá el listado antes de reintentar.'));
    }
    return payload;
}

export async function getSpaces(businessId: string): Promise<Space[]> {
    if (!db) return [];
    const ownerId = businessId || firebaseAuth?.currentUser?.uid;
    if (!ownerId) throw new Error('Debes iniciar sesión para cargar el catálogo.');
    return readOwnerCatalog(ownerId, 'spaces');
}

export async function createSpace(spaceData: NewSpaceData): Promise<string> {
    const { businessId: _businessId, ...mutableData } = spaceData;
    const result = await ownerSpaceRequest('POST', mutableData);
    if (typeof result.id !== 'string' || !/^[\w-]{1,128}$/.test(result.id)) {
        throw new Error('No se pudo confirmar el espacio creado. Recargá la lista antes de reintentar.');
    }
    return result.id;
}

export async function updateSpace(spaceId: string, spaceData: Partial<NewSpaceData>): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(spaceId)) throw new Error('El espacio no es válido.');
    const { businessId: _businessId, ...mutableData } = spaceData;
    await ownerSpaceRequest('PATCH', { spaceId, ...mutableData });
}

export async function deleteSpace(spaceId: string): Promise<void> {
    if (!/^[\w-]{1,128}$/.test(spaceId)) throw new Error('El espacio no es válido.');
    await ownerSpaceRequest('DELETE', { spaceId });
}

async function ownerSpaceRequest(method: 'POST' | 'PATCH' | 'DELETE', data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const user = firebaseAuth?.currentUser;
    if (!user) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
    const token = await user.getIdToken();
    const response = await fetch('/api/owner/spaces', {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(serializeCanchaPayload(data)),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 409 && payload.error === 'Space has active reservations') {
            throw new Error('SPACE_HAS_ACTIVE_RESERVATIONS');
        }
        throw new Error(resourceErrorMessage(payload.error, 'No se pudo guardar el espacio. Recargá el listado antes de reintentar.'));
    }
    return payload;
}


export async function getAppointments(businessId?: string): Promise<Appointment[]> {
    if (!db) return [];
    const uid = businessId || firebaseAuth?.currentUser?.uid;
    if (!uid) throw new Error('Iniciá sesión para cargar la agenda.');
    return readOwnerAppointments(uid);
}

export function onAppointmentsUpdate(businessId: string, callback: (appointments: Appointment[]) => void, onError?: (error: Error) => void): () => void {
    if (!db) return () => {};
    return subscribeOwnerAppointments(businessId, callback, onError);
}

export async function getAppointmentsNeedingReminders(hoursBefore: number = 24): Promise<Appointment[]> {
    if (!db) return [];
    
    const now = new Date();
    // We fetch appointments in a window to avoid missing any. 
    // e.g., if cron runs at 10:05, we want to catch the appointment at 10:00 the next day.
    const startTime = new Date(now.getTime() + (hoursBefore - 1) * 60 * 60 * 1000);
    const endTime = new Date(now.getTime() + (hoursBefore + 1) * 60 * 60 * 1000);
    
    const appointmentsCollection = collection(db, 'appointments');
    const q = query(
        appointmentsCollection, 
        where("status", "==", "Confirmado"),
        where("date", ">=", startTime),
        where("date", "<=", endTime)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
        return [];
    }

    return snapshot.docs.map(docToAppointment);
}

export async function createAppointment(appointmentData: NewAppointmentData): Promise<string> {
    const resourceId = appointmentData.spaceId || appointmentData.canchaId || appointmentData.serviceId;
    if (!resourceId) throw new Error('Selecciona un recurso válido.');
    const result = await ownerAppointmentRequest('/api/owner/appointments', {
        method: 'POST',
        body: JSON.stringify({
            client: appointmentData.client,
            clientPhone: appointmentData.clientPhone,
            clientEmail: appointmentData.clientEmail,
            serviceId: appointmentData.canchaId || appointmentData.spaceId ? undefined : resourceId,
            canchaId: appointmentData.canchaId,
            spaceId: appointmentData.spaceId,
            durationMinutes: appointmentData.durationMinutes,
            dateKey: toLocalDateKey(appointmentData.date),
            time: appointmentData.time,
            status: appointmentData.status,
        }),
    });
    return result.id as string;
}

export async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus): Promise<void> {
    await ownerAppointmentRequest(`/api/owner/appointments/${encodeURIComponent(appointmentId)}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
    });
}

export async function rescheduleAppointment(appointmentId: string, newDate: Date, newTime: string): Promise<Appointment | null> {
    const result = await ownerAppointmentRequest(`/api/owner/appointments/${encodeURIComponent(appointmentId)}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({ dateKey: toLocalDateKey(newDate), time: newTime }),
    });
    return result.appointment ? { ...result.appointment, date: new Date(result.appointment.date) } as Appointment : null;
}

function toLocalDateKey(date: Date): string {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Fecha inválida.');
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function ownerAppointmentRequest(path: string, init: RequestInit): Promise<Record<string, any>> {
    const user = firebaseAuth?.currentUser;
    if (!user) throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
    const token = await user.getIdToken();
    const operation = path === '/api/owner/appointments' && init.method === 'POST'
        ? await prepareOwnerOperation({ uid: user.uid, operation: 'owner-appointment-create', payload: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
        : null;
    const response = await fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(operation ? { 'X-Idempotency-Key': operation.key } : {}), ...(init.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'No se pudo actualizar el turno.');
    if (operation) clearOwnerOperation(operation);
    return payload;
}

export async function getAppointmentById(appointmentId: string): Promise<Appointment | null> {
    if (!db) return null;
    const appointmentDocRef = doc(db, 'appointments', appointmentId);
    const appointmentDocSnap = await getDoc(appointmentDocRef);

    if (appointmentDocSnap.exists()) {
        const data = appointmentDocSnap.data();
        let date;
        if (data.date && data.date instanceof Timestamp) {
            date = data.date.toDate();
        } else if (data.date) {
            date = new Date(data.date);
        } else {
            // If there's no date, we can't consider this a valid appointment.
            return null;
        }
        return {
            id: appointmentDocSnap.id,
            ...data,
            date: date,
        } as Appointment;
    } else {
        return null;
    }
}

export async function getBusinessProfile(businessId: string): Promise<BusinessProfile | null> {
    if (!db) return null;
    return readOwnerProfile(businessId);
}

export async function getBusinessProfileBySlug(slug: string): Promise<BusinessProfile | null> {
    if (!db) return null;
    const businessId = await getBusinessIdBySlug(slug);
    if (!businessId) return null;
    const businessProfile = await getBusinessProfile(businessId);
    if (businessProfile) {
        businessProfile.services = await getServices(businessId);
    }
    return businessProfile;
}

type MembershipToSave = {
    type: 'trial' | 'pro' | 'lifetime';
    startsAt: Timestamp | null;
    expiresAt: Timestamp | null;
};

export async function updateBusinessProfile(businessId: string, data: Partial<BusinessProfile>): Promise<{ created: boolean }> {
    const currentUser = firebaseAuth?.currentUser;
    if (!currentUser) throw new Error('Debes iniciar sesión para guardar el perfil.');
    if (businessId && businessId !== currentUser.uid) throw new Error('No puedes modificar otro negocio.');
    const token = await currentUser.getIdToken();
    const appCheckHeaders = await publicAppCheckHeaders({ consume: true });
    const response = await fetch('/api/business/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...appCheckHeaders },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo guardar el perfil.');
    }
    const result = await response.json().catch(() => null);
    return { created: result?.created === true };
}


export async function deleteBusinessProfile(businessId: string): Promise<void> {
    if (!db) throw new Error("Firebase is not configured.");
    const businessDocRef = doc(db, 'businesses', businessId);
    await deleteDoc(businessDocRef);
}

// Function to completely delete a user's business data from Firestore.
export async function deleteBusinessData(userId: string): Promise<void> {
    if (!db) throw new Error("Firestore is not configured.");

    const batch = writeBatch(db);

    // 1. Get all associated documents to find and delete related images from Storage
    const businessProfile = await getBusinessProfile(userId);
    const services = await getServices(userId);

    // Safely delete profile logo
    if (businessProfile?.logo && businessProfile.logo.includes('firebasestorage')) {
        await deleteFile(businessProfile.logo);
    }

    // Safely delete service photos
    if (services && services.length > 0) {
        const imageDeletionPromises = services
            .filter(service => service.photo && service.photo.includes('firebasestorage'))
            .map(service => deleteFile(service.photo!));
        if (imageDeletionPromises.length > 0) {
            await Promise.all(imageDeletionPromises);
        }

        // 2. Delete all services documents
        for (const service of services) {
            const serviceDocRef = doc(db, 'services', service.id);
            batch.delete(serviceDocRef);
        }
    }


    // 3. Delete business profile document
    const businessDocRef = doc(db, 'businesses', userId);
    batch.delete(businessDocRef);


    // 4. Delete all appointments
    const appointmentsCollection = collection(db, 'appointments');
    const appointmentsQuery = query(appointmentsCollection, where("businessId", "==", userId));
    const appointmentsSnapshot = await getDocs(appointmentsQuery);
    appointmentsSnapshot.forEach(doc => batch.delete(doc.ref));

    // 5. Delete all clients
    const clientsCollection = collection(db, 'clients');
    const clientsQuery = query(clientsCollection, where("businessId", "==", userId));
    const clientsSnapshot = await getDocs(clientsQuery);
    clientsSnapshot.forEach(doc => batch.delete(doc.ref));

    await batch.commit();
}

// New function to delete ALL business data from the database.
export async function deleteAllBusinessData(): Promise<{ success: boolean; message: string }> {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    const response = await fetch('/api/admin/delete-all-data', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
    });
    return response.json();
}


export async function seedDataForUser(userId: string, userEmail: string): Promise<{ success: boolean; message: string }> {
    if (!userId || !userEmail) {
        return { success: false, message: "User ID and Email are required." };
    }
    if (!db) {
        throw new Error("Firestore is not configured. Cannot seed data.");
    }

    try {
        // 1. Delete all existing data for the user first
        await deleteBusinessData(userId);

        // 2. Create new seeded data
        const batch = writeBatch(db);

        // Create expired membership profile
        const now = new Date();
        const createdAt = subDays(now, 45); // Created 45 days ago
        const startsAt = subDays(now, 15);
        const expiresAt = addMonths(startsAt, 1);
        
        const businessProfile: Omit<BusinessProfile, 'id'> = {
            email: userEmail,
            createdAt: Timestamp.fromDate(createdAt),
            name: "Barbería Los Hermanos",
            slug: `barberia-${userId.substring(0, 5)}`,
            description: "La mejor barbería de la ciudad. Estilo clásico y moderno para el hombre de hoy.",
            logo: "https://placehold.co/128x128.png",
            address: {
                street: "Av. Corrientes",
                number: "1234",
                city: "Buenos Aires",
                province: "CABA",
                postalCode: "C1043AAV",
                country: "Argentina",
            },
            status: 'active',
            location: { lat: -34.6037, lng: -58.3816 },
            whatsappButtonEnabled: true,
            whatsappNumber: "+5491122334455",
            theme: 'ocaso',
            bookingSettings: {
                autoConfirm: true,
                bookingHorizonDays: 30,
                bookingLeadTimeHours: 2,
                appointmentBufferMinutes: 15,
            },
            membership: {
                type: 'pro',
                startsAt: Timestamp.fromDate(startsAt),
                expiresAt: Timestamp.fromDate(expiresAt),
            },
        };
        const businessDocRef = doc(db, 'businesses', userId);
        batch.set(businessDocRef, businessProfile);

        // Create services
        const servicesToCreate = [
            { name: "Corte de Pelo", duration: "30", price: "2500", photo: "https://placehold.co/128x128.png", status: 'Activo' },
            { name: "Corte y Barba", duration: "45", price: "3500", photo: "https://placehold.co/128x128.png", status: 'Activo' },
            { name: "Afeitado Clásico", duration: "30", price: "2000", photo: "https://placehold.co/128x128.png", status: 'Pausado' },
        ];
        servicesToCreate.forEach(service => {
            const serviceDocRef = doc(collection(db as Firestore, 'services'));
            batch.set(serviceDocRef, { ...service, businessId: userId });
        });

        // Create clients
        const clientsToCreate = [
            { name: "Juan Pérez", phone: "+5491133445566", email: "juan.perez@example.com", lastAppointment: subDays(new Date(), 5) },
            { name: "Carlos García", phone: "+5491177889900", email: "carlos.garcia@example.com", lastAppointment: subDays(new Date(), 20) },
        ];
        clientsToCreate.forEach(client => {
            const clientDocRef = doc(collection(db as Firestore, 'clients'));
            batch.set(clientDocRef, { ...client, businessId: userId, avatar: `https://placehold.co/40x40.png/EBF4F4/71717A?text=${client.name.substring(0,2)}` });
        });

        await batch.commit();
        
        return { success: true, message: `Se han creado datos de prueba para el usuario ${userEmail}.` };
    } catch (error) {
        console.error("Error seeding data for user:", error);
        return { success: false, message: "Ocurrió un error al crear los datos de prueba." };
    }
}


export async function geocodeAddress(address: Address): Promise<{ lat: number; lng: number } | null> {
    const { street, number, city, postalCode, country } = address;
    const addressString = `${street} ${number}, ${city}, ${postalCode}, ${country}`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addressString)}&format=json&limit=1`;

    try {
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
        const data = await response.json();
        
        if (data && data.length > 0) {
            const { lat, lon } = data[0];
            return { lat: parseFloat(lat), lng: parseFloat(lon) };
        }
        return null;
    } catch (error) {
        console.error("Geocoding API error:", error);
        return null;
    }
}

export async function reverseGeocode({ lat, lng }: { lat: number, lng: number }): Promise<Partial<Address> | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();

        if (data && data.address) {
            const addr = data.address;
            return {
                street: addr.road || '',
                number: addr.house_number || '',
                city: addr.city || addr.town || addr.village || '',
                province: addr.state || '',
                postalCode: addr.postcode || '',
                country: addr.country || ''
            };
        }
        return null;
    } catch (error) {
        console.error("Reverse geocoding API error:", error);
        return null;
    }
}


export async function getProvinces(name: string): Promise<GeorefSuggestion[]> {
  if (!name) return [];
  const url = `https://apis.datos.gob.ar/georef/api/provincias?nombre=${encodeURIComponent(name)}&campos=id,nombre&max=5`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.provincias.map((p: any) => ({ id: p.id, nombre: p.nombre }));
  } catch (error) {
    console.error("Error fetching provinces:", error);
    return [];
  }
}

export async function getCities(name: string, provinceId: string): Promise<GeorefSuggestion[]> {
  if (!name || !provinceId) return [];
  const url = `https://apis.datos.gob.ar/georef/api/localidades?nombre=${encodeURIComponent(name)}&provincia=${provinceId}&campos=id,nombre&max=10`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    return data.localidades.map((l: any) => ({ 
      id: l.id, 
      nombre: l.nombre,
    }));
  } catch (error) {
    console.error("Error fetching cities:", error);
    return [];
  }
}


export async function getStreetSuggestions(street: string, provinceId: string, cityId: string): Promise<GeorefSuggestion[]> {
  if (!street || !provinceId || !cityId) return [];

  const url = `https://apis.datos.gob.ar/georef/api/calles?nombre=${encodeURIComponent(street)}&provincia=${provinceId}&localidad_censal_id=${cityId}&max=5`;
  
  try {
     const response = await fetch(url);
     const data = await response.json();

    if (data && data.calles) {
        return data.calles.map((s: any) => ({ 
            id: s.id, 
            nombre: s.nombre,
            nomenclatura: s.nomenclatura
        }));
    }
    return [];
  } catch (error) {
    console.error("Error fetching address suggestions:", error);
    return [];
  }
}

// Function to get all clients for a business - robust version
export async function getClients(businessId: string): Promise<Client[]> {
    return readOwnerClients(businessId);
}

// Function to update a client's data. It creates the client if it doesn't exist.
export async function updateClient(clientId: string, clientData: Partial<Client> & { businessId?: string, phone?: string }) {
    const ownerId = firebaseAuth?.currentUser?.uid;
    if (!ownerId || clientData.businessId && clientData.businessId !== ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) {
        throw new Error('Iniciá sesión desde la cuenta del negocio para guardar el cliente.');
    }
    const verifyOwner = () => {
        if (firebaseAuth?.currentUser?.uid !== ownerId) throw new Error('Tu sesión cambió. Volvé a cargar el cliente.');
    };
    const token = await firebaseAuth!.currentUser!.getIdToken();
    verifyOwner();
    // Server-owned timestamps and historical appointments cannot be overwritten by this form.
    const payload = Object.fromEntries(['name', 'phone', 'email', 'avatar']
        .filter(key => clientData[key as keyof typeof clientData] !== undefined)
        .map(key => [key, clientData[key as keyof typeof clientData]]));
    const send = (path: string, method: string) => fetch(path, {
        method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    let result = await send(`/api/v1/owner/clients/${encodeURIComponent(clientId)}`, 'PATCH');
    verifyOwner();
    if (result.status === 404 && clientData.name && clientData.phone) {
        // Materialize a legacy appointment-only client through the existing deterministic phone identity.
        result = await send('/api/v1/owner/clients', 'POST');
        verifyOwner();
    }
    if (!result.ok) throw new Error('No se pudo guardar el cliente. Volvé a cargarlo antes de intentar nuevamente.');
}

// Uploads a file (as a Blob or File) to Firebase Storage and returns the public URL.
// Optimiza automáticamente la resolución y formato (WebP) en el cliente.
// Storage is the only supported image store. Persisting a data URL in Firestore
// can exceed document limits and is rejected by the profile API.
class ImageUploadOwnerChanged extends Error {
  constructor() { super('Tu sesión cambió. Volvé a seleccionar la imagen desde tu cuenta actual.'); }
}

export async function uploadFile(
  file: File | Blob,
  folder: 'logos' | 'services' | 'avatars' | 'canchas' | 'spaces'
): Promise<string> {
  const ownerId = firebaseAuth?.currentUser?.uid;
  if (!ownerId) throw new Error('Iniciá sesión para subir una imagen.');
  const verifyOwner = () => {
    if (firebaseAuth?.currentUser?.uid !== ownerId) throw new ImageUploadOwnerChanged();
  };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Seleccioná una imagen JPG, PNG o WebP de hasta 10 MB.');
  }
  if (!storage || !db) throw new Error('El almacenamiento de imágenes no está disponible. Intentá nuevamente más tarde.');
  // UX preflight only: Storage rules independently enforce the same entitlement.
  const business = await getBusinessProfile(ownerId);
  if (!business || !isBusinessOperational(business)) {
    throw new Error('Tu membresía no está activa. Revisá la sección Membresía antes de subir imágenes.');
  }
  let fileToUpload: Blob = file;

  // Intentar optimizar y comprimir si estamos en el navegador
  if (typeof window !== 'undefined' && file.type && file.type.startsWith('image/')) {
      const maxDim = folder === 'logos' ? 800 : folder === 'avatars' ? 400 : 1000;
      const optimized = await optimizeImage(file, {
        maxWidth: maxDim,
        maxHeight: maxDim,
        quality: 0.82,
        format: 'image/webp'
      });
      fileToUpload = optimized.blob;
  }

  if (!storage) {
    throw new Error("El almacenamiento de imágenes no está disponible. Intenta nuevamente más tarde.");
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(fileToUpload.type) || fileToUpload.size > 2 * 1024 * 1024) {
    throw new Error('La imagen optimizada supera los 2 MB. Probá una imagen de menor resolución.');
  }
  verifyOwner();
  const token = await firebaseAuth!.currentUser!.getIdToken();
  const attestation = await publicAppCheckHeaders({ consume: true });
  verifyOwner();
  const authorization = await fetch('/api/owner/images/authorize', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...attestation, 'X-Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ category: folder, contentType: fileToUpload.type, byteSize: fileToUpload.size }),
  });
  verifyOwner();
  if (!authorization.ok) {
    throw new Error(authorization.status === 429
      ? 'Alcanzaste el límite temporal de imágenes. Esperá unos minutos antes de intentar otra vez.'
      : 'No se pudo autorizar la imagen. Volvé a seleccionarla desde tu cuenta.');
  }
  const permit: unknown = await authorization.json();
  verifyOwner();
  const grant = permit as { permitId?: unknown; storagePath?: unknown; expiresAt?: unknown } | null;
  const extension = fileToUpload.type === 'image/jpeg' ? 'jpg' : fileToUpload.type.split('/')[1];
  if (!grant || typeof grant.permitId !== 'string' || !/^[a-f0-9]{64}$/.test(grant.permitId) ||
      grant.storagePath !== `businesses/${ownerId}/${folder}/g_${grant.permitId}.${extension}` ||
      typeof grant.expiresAt !== 'string' || !(Date.parse(grant.expiresAt) > Date.now())) {
    throw new Error('El permiso de imagen no es válido o venció. Volvé a seleccionar la imagen.');
  }
  const storageRef = ref(storage, grant.storagePath);

  verifyOwner();
  try {
    const snapshot = await uploadBytes(storageRef, fileToUpload, { contentType: fileToUpload.type, customMetadata: { imagePermitId: grant.permitId } });
    verifyOwner();
    const downloadUrl = await getDownloadURL(snapshot.ref);
    verifyOwner();
    return downloadUrl;
  } catch (error) {
    if (error instanceof ImageUploadOwnerChanged) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code === 'storage/unauthenticated') throw new Error('Tu sesión venció. Volvé a iniciar sesión para subir la imagen.');
    if (code === 'storage/unauthorized') throw new Error('No se pudo autorizar la carga. Revisá tu membresía o contactá al soporte desde tu cuenta.');
    if (code === 'storage/retry-limit-exceeded') throw new Error('La carga tardó demasiado. Revisá tu conexión e intentá nuevamente.');
    throw new Error('No se pudo subir la imagen. Intentá nuevamente; si continúa, contactá al soporte desde tu cuenta.');
  }
}

// Deletes a file from Firebase Storage using its URL. This function is more robust and won't crash the app.
export async function deleteFile(fileUrl: string): Promise<void> {
  if (!storage || !fileUrl || fileUrl.startsWith('data:') || !fileUrl.includes('firebasestorage.googleapis.com')) {
    return;
  }
  // A failed acknowledgement may follow a committed resource save. Governed
  // objects are reclaimed only by the server after checking active references.
  try {
    const path = decodeURIComponent(new URL(fileUrl).pathname);
    if (/\/g_[a-f0-9]{64}\.(jpg|png|webp)$/.test(path)) return;
  } catch { return; }
  try {
    const fileRef = ref(storage, fileUrl);
    await deleteObject(fileRef);
  } catch (error: any) {
    console.warn('Could not delete an image from storage.', error.code);
  }
}

// Get all businesses for the admin panel
export async function getAllBusinesses(): Promise<BusinessProfile[]> {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    if (!token) throw new Error('Authentication required.');
    const response = await fetch('/api/admin/businesses', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
    });
    if (!response.ok) throw new Error('Could not load businesses.');
    const payload = await response.json();
    return (payload.businesses as BusinessProfile[]).map((business) => ({
        ...business,
        createdAt: business.createdAt ? new Date(business.createdAt as unknown as string) : undefined,
        lastModified: business.lastModified ? new Date(business.lastModified as unknown as string) : undefined,
        membership: business.membership ? {
            ...business.membership,
            startsAt: business.membership.startsAt ? new Date(business.membership.startsAt as unknown as string) : null,
            expiresAt: business.membership.expiresAt ? new Date(business.membership.expiresAt as unknown as string) : null,
        } : undefined,
    })).sort((a, b) => (b.createdAt instanceof Date ? b.createdAt.getTime() : 0) - (a.createdAt instanceof Date ? a.createdAt.getTime() : 0));
}

export async function updateBusinessMembership(businessId: string, membership: Partial<Membership>): Promise<void> {
    const token = await firebaseAuth?.currentUser?.getIdToken();
    const response = await fetch('/api/admin/update-membership', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ businessId, membership }),
    });

    if (!response.ok) {
        const errorResult = await response.json();
        throw new Error(errorResult.message || 'Failed to update membership via API.');
    }
}
    
