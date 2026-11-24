import { normalizeCanchaPrice, validateWorkingHours, type WorkingHoursInput } from '@/lib/cancha-validation';
import { isDateKey } from '@/lib/booking-constraints';

export type ServiceWriteInput = {
  name?: string;
  duration?: string;
  price?: string;
  status?: 'Activo' | 'Pausado';
  photo?: string;
  workingHours?: WorkingHoursInput;
  unavailableDates?: unknown[];
  bookingBufferMinutes?: number | null;
};

const FIELDS = new Set(['name', 'duration', 'price', 'status', 'photo', 'workingHours', 'unavailableDates', 'bookingBufferMinutes']);

export function validateServiceWrite(input: unknown, requireAllFields: boolean): { data?: ServiceWriteInput; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid service details' };
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !FIELDS.has(key)) || (!requireAllFields && Object.keys(raw).length === 0)) return { error: 'Invalid service details' };
  const data: ServiceWriteInput = {};
  if (requireAllFields || raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.trim().length < 2 || raw.name.trim().length > 80 || /[\u0000-\u001F\u007F]/.test(raw.name)) return { error: 'Invalid service name' };
    data.name = raw.name.trim();
  }
  if (requireAllFields || raw.duration !== undefined) {
    if (typeof raw.duration !== 'string' || !/^\d{1,4}$/.test(raw.duration) || Number(raw.duration) < 10 || Number(raw.duration) > 1440) return { error: 'Invalid service duration' };
    data.duration = String(Number(raw.duration));
  }
  if (requireAllFields || raw.price !== undefined) {
    const price = normalizeCanchaPrice(raw.price);
    if (!price) return { error: 'Invalid service price' };
    data.price = price;
  }
  if (requireAllFields || raw.status !== undefined) {
    if (raw.status !== 'Activo' && raw.status !== 'Pausado') return { error: 'Invalid service status' };
    data.status = raw.status;
  }
  if (raw.photo !== undefined) {
    if (typeof raw.photo !== 'string' || raw.photo.length > 2048 || !/^https:\/\//.test(raw.photo)) return { error: 'Invalid service image' };
    data.photo = raw.photo;
  }
  if (raw.workingHours !== undefined) {
    const error = validateWorkingHours(raw.workingHours, false);
    if (error) return { error };
    data.workingHours = raw.workingHours as WorkingHoursInput;
  }
  if (raw.unavailableDates !== undefined) {
    const validDate = (value: unknown) => value instanceof Date ? Number.isFinite(value.getTime())
      : typeof value === 'string' && isDateKey(value.slice(0, 10)) &&
        (value.length === 10 || value[10] === 'T' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)));
    if (!Array.isArray(raw.unavailableDates) || raw.unavailableDates.length > 366 || raw.unavailableDates.some(value => !validDate(value))) return { error: 'Invalid unavailable dates' };
    data.unavailableDates = raw.unavailableDates;
  }
  if (raw.bookingBufferMinutes !== undefined) {
    if (raw.bookingBufferMinutes !== null && (!Number.isInteger(raw.bookingBufferMinutes) || (raw.bookingBufferMinutes as number) < 0 || (raw.bookingBufferMinutes as number) > 240)) return { error: 'Invalid booking buffer' };
    data.bookingBufferMinutes = raw.bookingBufferMinutes as number | null;
  }
  return { data };
}
