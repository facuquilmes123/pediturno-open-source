import { normalizeCanchaPrice, type WorkingHoursInput } from '@/lib/cancha-validation';
import { isTime, minutes } from '@/lib/booking-constraints';
import { hasReservableSpaceWorkingHours } from '@/lib/space-availability';

export const SPACE_CATEGORIES = ['salon', 'quincho', 'sum', 'quinta', 'terraza', 'jardin', 'auditorio', 'capacitacion', 'estudio_fotografico', 'otro'] as const;
export const SPACE_DURATIONS = [240, 480, 720, 1440] as const;
export type SpaceCategory = typeof SPACE_CATEGORIES[number];
export type SpaceDuration = typeof SPACE_DURATIONS[number];
export type SpaceStatus = 'Activo' | 'Pausado';
export type SpacePackage = { durationMinutes: SpaceDuration; price: string };

export type SpaceWriteInput = {
  name?: string;
  category?: SpaceCategory;
  description?: string;
  capacity?: number;
  packages?: SpacePackage[];
  preparationMinutes?: number;
  cleanupMinutes?: number;
  bookingBufferMinutes?: number | null;
  status?: SpaceStatus;
  photo?: string;
  photos?: string[];
  workingHours?: WorkingHoursInput;
  unavailableDates?: unknown[];
};

const FIELDS = new Set([
  'name', 'category', 'description', 'capacity', 'packages', 'preparationMinutes', 'cleanupMinutes',
  'bookingBufferMinutes', 'status', 'photo', 'photos', 'workingHours', 'unavailableDates',
]);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function validUnavailableDate(value: unknown): boolean {
  return value instanceof Date
    ? Number.isFinite(value.getTime())
    : typeof value === 'string' && value.length <= 40 && Number.isFinite(new Date(value).getTime());
}

function validImage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2048 && /^https:\/\//.test(value);
}

/** Space schedules accept an end on the following day (`18:00` to `02:00`). */
export function validateSpaceWorkingHours(workingHours: unknown, requireAtLeastOneDay = false): string | null {
  if (!workingHours || typeof workingHours !== 'object' || Array.isArray(workingHours)) {
    return requireAtLeastOneDay ? 'Configurá al menos un día y horario disponible.' : null;
  }
  const entries = Object.entries(workingHours as Record<string, unknown>);
  if (requireAtLeastOneDay && entries.length === 0) return 'Configurá al menos un día y horario disponible.';
  for (const [day, config] of entries) {
    const index = Number(day);
    if (!Number.isInteger(index) || index < 0 || index > 6 || !config || typeof config !== 'object') return 'Uno de los días configurados no es válido.';
    const slots = (config as { slots?: unknown }).slots;
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > 2) return 'Cada día habilitado debe tener uno o dos rangos horarios.';
    const regular: Array<{ start: number; end: number }> = [];
    for (const slot of slots) {
      const start = (slot as { start?: unknown })?.start;
      const end = (slot as { end?: unknown })?.end;
      if (!TIME_PATTERN.test(String(start)) || !TIME_PATTERN.test(String(end)) || !isTime(start) || !isTime(end)) return 'Cada horario debe indicar una hora de inicio y una de finalización válidas.';
      const from = minutes(start);
      const to = minutes(end);
      if (from % 10 !== 0 || to % 10 !== 0) return 'Los horarios de Espacios deben usar intervalos de 10 minutos.';
      // In the Espacios model only midnight-to-midnight expresses a full day.
      if (from === to && from !== 0) return 'Para una jornada completa usá 00:00 a 00:00.';
      if (from === to && slots.length > 1) return 'Un horario de 24 horas debe ser el único rango de ese día.';
      // Ranges that cross midnight are intentionally allowed. Combining more
      // than one of them is ambiguous for a compact weekly editor.
      if (to <= from && slots.length > 1) return 'Un horario que cruza medianoche debe ser el único rango de ese día.';
      if (to > from) regular.push({ start: from, end: to });
    }
    regular.sort((a, b) => a.start - b.start);
    if (regular.some((range, position) => position > 0 && range.start < regular[position - 1].end)) return 'Los rangos de un mismo día no pueden superponerse.';
  }
  return null;
}

export function validateReservableSpaceWorkingHours(workingHours: unknown, packages: unknown): string | null {
  const hoursError = validateSpaceWorkingHours(workingHours, true);
  if (hoursError) return hoursError;
  const durations = Array.isArray(packages) ? packages.map(item => Number((item as SpacePackage).durationMinutes)) : [];
  return hasReservableSpaceWorkingHours(workingHours, durations)
    ? null
    : 'Configurá al menos un rango horario que alcance para el paquete más largo.';
}

export function validateSpaceWrite(input: unknown, requireAllFields: boolean): { data?: SpaceWriteInput; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid space details' };
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !FIELDS.has(key)) || (!requireAllFields && Object.keys(raw).length === 0)) return { error: 'Invalid space details' };
  const data: SpaceWriteInput = {};
  if (requireAllFields || raw.name !== undefined) {
    if (typeof raw.name !== 'string') return { error: 'Invalid space name' };
    const name = raw.name.trim();
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001F\u007F]/.test(name)) return { error: 'Invalid space name' };
    data.name = name;
  }
  if (requireAllFields || raw.category !== undefined) {
    if (!SPACE_CATEGORIES.includes(raw.category as SpaceCategory)) return { error: 'Invalid space category' };
    data.category = raw.category as SpaceCategory;
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string' || raw.description.trim().length > 1200 || /[\u0000-\u001F\u007F]/.test(raw.description)) return { error: 'Invalid space description' };
    data.description = raw.description.trim();
  }
  if (raw.capacity !== undefined) {
    if (!Number.isInteger(raw.capacity) || (raw.capacity as number) < 1 || (raw.capacity as number) > 10_000) return { error: 'Invalid space capacity' };
    data.capacity = raw.capacity as number;
  }
  if (requireAllFields || raw.packages !== undefined) {
    if (!Array.isArray(raw.packages) || raw.packages.length < 1 || raw.packages.length > SPACE_DURATIONS.length) return { error: 'Invalid space packages' };
    const seen = new Set<number>();
    const packages: SpacePackage[] = [];
    for (const value of raw.packages) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value as object).length !== 2) return { error: 'Invalid space packages' };
      const candidate = value as Record<string, unknown>;
      if (!SPACE_DURATIONS.includes(candidate.durationMinutes as SpaceDuration) || seen.has(candidate.durationMinutes as number)) return { error: 'Invalid space packages' };
      const price = normalizeCanchaPrice(candidate.price);
      if (!price) return { error: 'Invalid space package price' };
      seen.add(candidate.durationMinutes as number);
      packages.push({ durationMinutes: candidate.durationMinutes as SpaceDuration, price });
    }
    packages.sort((first, second) => first.durationMinutes - second.durationMinutes);
    data.packages = packages;
  }
  for (const key of ['preparationMinutes', 'cleanupMinutes'] as const) {
    if (requireAllFields || raw[key] !== undefined) {
      if (!Number.isInteger(raw[key]) || (raw[key] as number) < 0 || (raw[key] as number) > 240 || (raw[key] as number) % 10 !== 0) return { error: `Invalid space ${key}` };
      data[key] = raw[key] as number;
    }
  }
  if (raw.bookingBufferMinutes !== undefined) {
    if (raw.bookingBufferMinutes !== null && (!Number.isInteger(raw.bookingBufferMinutes) || (raw.bookingBufferMinutes as number) < 0 || (raw.bookingBufferMinutes as number) > 240 || (raw.bookingBufferMinutes as number) % 10 !== 0)) return { error: 'Invalid booking buffer' };
    data.bookingBufferMinutes = raw.bookingBufferMinutes as number | null;
  }
  if (requireAllFields || raw.status !== undefined) {
    if (raw.status !== 'Activo' && raw.status !== 'Pausado') return { error: 'Invalid space status' };
    data.status = raw.status;
  }
  if (raw.photo !== undefined) {
    if (!validImage(raw.photo)) return { error: 'Invalid space image' };
    data.photo = raw.photo;
  }
  if (raw.photos !== undefined) {
    if (!Array.isArray(raw.photos) || raw.photos.length > 8 || raw.photos.some(photo => !validImage(photo))) return { error: 'Invalid space images' };
    data.photos = [...new Set(raw.photos)];
  }
  if (raw.workingHours !== undefined) {
    const error = validateSpaceWorkingHours(raw.workingHours, false);
    if (error) return { error };
    data.workingHours = raw.workingHours as WorkingHoursInput;
  }
  if (raw.unavailableDates !== undefined) {
    if (!Array.isArray(raw.unavailableDates) || raw.unavailableDates.length > 366 || raw.unavailableDates.some(value => !validUnavailableDate(value))) return { error: 'Invalid unavailable dates' };
    data.unavailableDates = raw.unavailableDates;
  }
  return { data };
}
