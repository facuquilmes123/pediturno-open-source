type AppointmentResource = { canchaId?: unknown; cancha?: unknown };

/** Matches both current cancha IDs and pre-migration cancha-name records. */
export function sameAppointmentResource(
  existing: AppointmentResource,
  canchaId?: unknown,
  canchaName?: unknown,
): boolean {
  if (typeof canchaId === 'string' && canchaId) {
    return existing.canchaId === canchaId ||
      (!existing.canchaId && typeof canchaName === 'string' && existing.cancha === canchaName);
  }
  return !existing.canchaId && !existing.cancha;
}
