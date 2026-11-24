import { parseArsInput } from '@/lib/ars-input';
export const CANCHA_DURATIONS = [30, 60, 90, 120, 150, 180] as const;
export const CANCHA_SPORTS = ['futbol', 'padel', 'tenis', 'otro'] as const;

export type CanchaDuration = typeof CANCHA_DURATIONS[number];
export type CanchaSport = typeof CANCHA_SPORTS[number];
export type CanchaStatus = 'Activo' | 'Pausado';
export type WorkingHoursInput = Record<number, { slots: Array<{ start: string; end: string }>; isAlternating?: boolean }>;

export type CanchaWriteInput = {
  name?: string;
  price?: string;
  duration?: CanchaDuration;
  status?: CanchaStatus;
  photo?: string;
  sport?: CanchaSport;
  workingHours?: WorkingHoursInput;
  unavailableDates?: unknown[];
  bookingBufferMinutes?: number | null;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CANCHA_FIELDS = new Set(['name', 'price', 'duration', 'status', 'photo', 'sport', 'workingHours', 'unavailableDates', 'bookingBufferMinutes']);

export function normalizeCanchaPrice(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const normalized = trimmed.includes(',') || /^\s*\$/.test(trimmed) || /^\d{1,3}(?:\.\d{3})+$/.test(trimmed)
    ? parseArsInput(trimmed) : trimmed;
  if (normalized === null) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return null;
  return amount.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/** The public booking API only supports same-day, non-overlapping slots. */
export function validateWorkingHours(workingHours: unknown, requireAtLeastOneDay = false): string | null {
  if (!workingHours || typeof workingHours !== 'object' || Array.isArray(workingHours)) {
    return requireAtLeastOneDay ? 'Configurá al menos un día y horario disponible.' : null;
  }
  const entries = Object.entries(workingHours as Record<string, unknown>);
  if (requireAtLeastOneDay && entries.length === 0) return 'Configurá al menos un día y horario disponible.';

  for (const [day, config] of entries) {
    const dayIndex = Number(day);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6 || !config || typeof config !== 'object') {
      return 'Uno de los días configurados no es válido.';
    }
    const slots = (config as { slots?: unknown }).slots;
    if (!Array.isArray(slots) || slots.length === 0 || slots.length > 2) {
      return 'Cada día habilitado debe tener uno o dos rangos horarios.';
    }
    const ranges: Array<{ start: number; end: number }> = [];
    for (const slot of slots) {
      const start = (slot as { start?: unknown })?.start;
      const end = (slot as { end?: unknown })?.end;
      if (!TIME_PATTERN.test(String(start)) || !TIME_PATTERN.test(String(end))) {
        return 'Cada horario debe indicar una hora de inicio y una de finalización válidas.';
      }
      const startMinutes = Number(String(start).slice(0, 2)) * 60 + Number(String(start).slice(3));
      const endMinutes = Number(String(end).slice(0, 2)) * 60 + Number(String(end).slice(3));
      if (endMinutes <= startMinutes) {
        return 'Los horarios deben terminar después de comenzar; los turnos no pueden cruzar medianoche.';
      }
      ranges.push({ start: startMinutes, end: endMinutes });
    }
    ranges.sort((a, b) => a.start - b.start);
    if (ranges.some((range, index) => index > 0 && range.start < ranges[index - 1].end)) {
      return 'Los rangos de un mismo día no pueden superponerse.';
    }
  }
  return null;
}

function validUnavailableDate(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(new Date(value).getTime());
}

/** A valid schedule must fit at least one complete appointment. */
export function validateReservableWorkingHours(workingHours: unknown, duration: unknown): string | null {
  const error = validateWorkingHours(workingHours, true);
  if (error) return error;
  const minutes = Number(duration);
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 1440) return 'Revisá la duración del turno.';
  const fits = Object.values(workingHours as WorkingHoursInput).some(day => day.slots.some(slot => {
    const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    return toMinutes(slot.end) - toMinutes(slot.start) >= minutes;
  }));
  return fits ? null : 'Configurá al menos un rango horario que alcance para la duración completa del turno.';
}

export function validateCanchaWrite(input: unknown, requireAllFields: boolean): { data?: CanchaWriteInput; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid cancha details' };
  const raw = input as Record<string, unknown>;
  if (Object.keys(raw).some(key => !CANCHA_FIELDS.has(key))) return { error: 'Invalid cancha details' };
  if (!requireAllFields && Object.keys(raw).length === 0) return { error: 'Invalid cancha details' };

  const data: CanchaWriteInput = {};
  if (requireAllFields || raw.name !== undefined) {
    if (typeof raw.name !== 'string') return { error: 'Invalid cancha name' };
    const name = raw.name.trim();
    if (name.length < 2 || name.length > 80 || /[\u0000-\u001F\u007F]/.test(name)) return { error: 'Invalid cancha name' };
    data.name = name;
  }
  if (requireAllFields || raw.price !== undefined) {
    const price = normalizeCanchaPrice(raw.price);
    if (!price) return { error: 'Invalid cancha price' };
    data.price = price;
  }
  if (requireAllFields || raw.duration !== undefined) {
    if (!CANCHA_DURATIONS.includes(raw.duration as CanchaDuration)) return { error: 'Invalid cancha duration' };
    data.duration = raw.duration as CanchaDuration;
  }
  if (requireAllFields || raw.status !== undefined) {
    if (raw.status !== 'Activo' && raw.status !== 'Pausado') return { error: 'Invalid cancha status' };
    data.status = raw.status;
  }
  if (raw.sport !== undefined) {
    if (!CANCHA_SPORTS.includes(raw.sport as CanchaSport)) return { error: 'Invalid cancha sport' };
    data.sport = raw.sport as CanchaSport;
  }
  if (raw.photo !== undefined) {
    if (typeof raw.photo !== 'string' || raw.photo.length > 2048 || !/^https:\/\//.test(raw.photo)) return { error: 'Invalid cancha image' };
    data.photo = raw.photo;
  }
  if (raw.workingHours !== undefined) {
    const hoursError = validateWorkingHours(raw.workingHours, false);
    if (hoursError) return { error: hoursError };
    data.workingHours = raw.workingHours as WorkingHoursInput;
  }
  if (raw.unavailableDates !== undefined) {
    if (!Array.isArray(raw.unavailableDates) || raw.unavailableDates.length > 366 || raw.unavailableDates.some(date => !validUnavailableDate(date))) {
      return { error: 'Invalid unavailable dates' };
    }
    data.unavailableDates = raw.unavailableDates;
  }
  if (raw.bookingBufferMinutes !== undefined) {
    if (raw.bookingBufferMinutes !== null && (!Number.isInteger(raw.bookingBufferMinutes) || (raw.bookingBufferMinutes as number) < 0 || (raw.bookingBufferMinutes as number) > 240)) {
      return { error: 'Invalid booking buffer' };
    }
    data.bookingBufferMinutes = raw.bookingBufferMinutes as number | null;
  }
  return { data };
}
