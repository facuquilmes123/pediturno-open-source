export type AppointmentLifecycleStatus = 'Confirmado' | 'Pendiente' | 'Completado' | 'Cancelado';

const transitions: Record<AppointmentLifecycleStatus, ReadonlySet<AppointmentLifecycleStatus>> = {
  Pendiente: new Set(['Confirmado', 'Completado', 'Cancelado']),
  Confirmado: new Set(['Completado', 'Cancelado']),
  Completado: new Set(),
  Cancelado: new Set(),
};

export function canTransitionAppointmentStatus(current: unknown, next: unknown): boolean {
  if (!isAppointmentLifecycleStatus(current) || !isAppointmentLifecycleStatus(next)) return false;
  return current === next || transitions[current].has(next);
}

export function canRescheduleAppointmentStatus(status: unknown): status is 'Confirmado' | 'Pendiente' {
  return status === 'Confirmado' || status === 'Pendiente';
}

export function isAppointmentLifecycleStatus(status: unknown): status is AppointmentLifecycleStatus {
  return status === 'Confirmado' || status === 'Pendiente' || status === 'Completado' || status === 'Cancelado';
}
