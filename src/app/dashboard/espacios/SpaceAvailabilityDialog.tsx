"use client";

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Loader2, Plus, Trash2 } from 'lucide-react';
import { es } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Space, WorkingHours } from '@/services/data';

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function slotMinutes(start: string, end: string) {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const from = startHour * 60 + startMinute;
  const to = endHour * 60 + endMinute;
  if (![from, to].every(Number.isFinite)) return 0;
  if (to === from) return start === '00:00' && end === '00:00' ? 1440 : 0;
  return to > from ? to - from : 1440 - from + to;
}

export function validateSpaceAvailability(space: Space, workingHours: WorkingHours): string | null {
  const slots = Object.values(workingHours).flatMap((day) => day?.slots || []);
  if (slots.length === 0) return 'Configurá al menos un día y una franja disponible.';
  if (slots.some((slot) => [slot.start, slot.end].some((value) => Number(value.split(':')[1]) % 10 !== 0))) return 'Los horarios deben usar intervalos de 10 minutos.';
  if (slots.some((slot) => slotMinutes(slot.start, slot.end) <= 0)) return 'Revisá que todos los horarios sean válidos.';
  if (Object.values(workingHours).some((day) => day?.slots?.length > 1 && day.slots.some((slot) => slot.start === '00:00' && slot.end === '00:00'))) {
    return 'Una jornada completa de 00:00 a 00:00 debe ser la única franja de ese día.';
  }
  const unsupported = space.packages.filter((item) => !slots.some((slot) => slotMinutes(slot.start, slot.end) >= item.durationMinutes));
  if (unsupported.length > 0) {
    const labels = unsupported.map((item) => item.durationMinutes === 1440 ? 'jornada completa' : `${item.durationMinutes / 60} horas`).join(', ');
    return `Agregá una franja suficientemente extensa para: ${labels}.`;
  }
  return null;
}

interface Props {
  open: boolean;
  space: Space | null;
  onOpenChange: (open: boolean) => void;
  onSave: (spaceId: string, data: { workingHours: WorkingHours; unavailableDates: Date[] }) => Promise<void>;
}

export default function SpaceAvailabilityDialog({ open, space, onOpenChange, onSave }: Props) {
  const [workingHours, setWorkingHours] = useState<WorkingHours>({});
  const [unavailableDates, setUnavailableDates] = useState<Date[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !space) return;
    setWorkingHours(structuredClone(space.workingHours || {}));
    setUnavailableDates((space.unavailableDates || []).map((date) => new Date(date)));
  }, [open, space]);

  const error = useMemo(() => space ? validateSpaceAvailability(space, workingHours) : null, [space, workingHours]);

  const toggleDay = (dayIndex: number, checked: boolean) => {
    setWorkingHours((current) => {
      const next = { ...current };
      if (checked) next[dayIndex] = next[dayIndex]?.slots?.length ? next[dayIndex] : { slots: [{ start: '09:00', end: '21:00' }] };
      else delete next[dayIndex];
      return next;
    });
  };

  const updateSlot = (dayIndex: number, slotIndex: number, key: 'start' | 'end', value: string) => {
    setWorkingHours((current) => {
      const day = current[dayIndex] || { slots: [] };
      const slots = day.slots.map((slot, index) => index === slotIndex ? { ...slot, [key]: value } : slot);
      return { ...current, [dayIndex]: { ...day, slots } };
    });
  };

  const addSlot = (dayIndex: number) => setWorkingHours((current) => {
    const day = current[dayIndex] || { slots: [] };
    if (day.slots.length >= 2) return current;
    return { ...current, [dayIndex]: { ...day, slots: [...day.slots, { start: '18:00', end: '02:00' }] } };
  });

  const removeSlot = (dayIndex: number, slotIndex: number) => setWorkingHours((current) => {
    const day = current[dayIndex];
    if (!day) return current;
    const slots = day.slots.filter((_, index) => index !== slotIndex);
    const next = { ...current };
    if (slots.length === 0) delete next[dayIndex];
    else next[dayIndex] = { ...day, slots };
    return next;
  });

  const save = async () => {
    if (!space || error) return;
    setSaving(true);
    try {
      await onSave(space.id, { workingHours, unavailableDates });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Disponibilidad de {space?.name}</DialogTitle>
          <DialogDescription>
            Definí cuándo puede comenzar una reserva. Si la hora final es menor que la inicial, la franja termina al día siguiente.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="weekly">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="weekly"><Clock3 className="mr-2 h-4 w-4" />Horario semanal</TabsTrigger>
            <TabsTrigger value="blocked"><CalendarDays className="mr-2 h-4 w-4" />Fechas bloqueadas</TabsTrigger>
          </TabsList>
          <TabsContent value="weekly" className="space-y-3 pt-2">
            {DAYS.map((label, dayIndex) => {
              const slots = workingHours[dayIndex]?.slots || [];
              const enabled = slots.length > 0;
              return (
                <section key={label} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Checkbox id={`space-day-${dayIndex}`} checked={enabled} onCheckedChange={(value) => toggleDay(dayIndex, value === true)} />
                    <Label htmlFor={`space-day-${dayIndex}`} className="font-semibold">{label}</Label>
                  </div>
                  {enabled && (
                    <div className="mt-3 space-y-3">
                      {slots.map((slot, slotIndex) => {
                        const crossesMidnight = slot.end < slot.start;
                        return (
                          <div key={`${dayIndex}-${slotIndex}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                            <div className="space-y-1"><Label htmlFor={`space-start-${dayIndex}-${slotIndex}`}>Desde</Label><Input id={`space-start-${dayIndex}-${slotIndex}`} type="time" step={600} value={slot.start} onChange={(event) => updateSlot(dayIndex, slotIndex, 'start', event.target.value)} /></div>
                            <div className="space-y-1"><Label htmlFor={`space-end-${dayIndex}-${slotIndex}`}>Hasta {crossesMidnight ? '(+1 día)' : ''}</Label><Input id={`space-end-${dayIndex}-${slotIndex}`} type="time" step={600} value={slot.end} onChange={(event) => updateSlot(dayIndex, slotIndex, 'end', event.target.value)} /></div>
                            <Button type="button" variant="ghost" size="icon" aria-label={`Eliminar franja de ${label}`} onClick={() => removeSlot(dayIndex, slotIndex)}><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        );
                      })}
                      {slots.length < 2 && <Button type="button" variant="outline" size="sm" onClick={() => addSlot(dayIndex)}><Plus className="mr-2 h-4 w-4" />Agregar otra franja</Button>}
                      <p className="text-xs text-muted-foreground">Usá horarios en intervalos de 10 minutos.</p>
                    </div>
                  )}
                </section>
              );
            })}
          </TabsContent>
          <TabsContent value="blocked" className="pt-3">
            <p className="mb-3 text-sm text-muted-foreground">Elegí feriados, eventos privados o días de mantenimiento en los que el espacio no debe ofrecerse.</p>
            <div className="flex justify-center rounded-lg border"><Calendar mode="multiple" locale={es} selected={unavailableDates} onSelect={(dates) => setUnavailableDates(dates || [])} /></div>
          </TabsContent>
        </Tabs>

        <div role="status" aria-live="polite" className={`rounded-lg border p-3 text-sm ${error ? 'border-amber-500/40 bg-amber-500/10' : 'border-emerald-500/40 bg-emerald-500/10'}`}>
          {error || 'Los paquetes configurados caben dentro de la disponibilidad.'}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !!error}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar disponibilidad</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
