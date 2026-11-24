"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Clock, MapPin, Map, Loader2, PartyPopper, CheckCircle, AlertCircle, Instagram, Facebook, Globe, XIcon, Youtube, Linkedin, Tally1, Link as LinkIcon, Calendar as CalendarIcon, Check, Image as ImageIcon, Store, ArrowLeft, ArrowRight, Edit, Sun, Moon, Sunset, Trophy, Award, Building2, Users } from "lucide-react";
import { BusinessProfile, Service, SocialLink, SocialLinkType, Appointment, Cancha, Space, SpacePackage } from "@/services/data";
import { Skeleton } from "@/components/ui/skeleton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import Image from "next/image";
import BookingPageFooter from '@/components/BookingPageFooter';
import { es } from 'date-fns/locale';
import { format, isSameDay, addMinutes, addDays, getWeek, addHours } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ThemeStyle, themes, ThemeName } from "@/lib/themes";
import dynamic from 'next/dynamic';
import AppointmentForm from "@/components/AppointmentForm";
import { AddToCalendarButton } from 'add-to-calendar-button-react';
import { publicAppCheckHeaders } from '@/lib/app-check-client';
import { publicBookingFailureMessage } from '@/lib/public-booking-error';
import { BUSINESS_TIME_ZONE, dateKeyInZone, localTimeToUtc, shiftDateKey } from '@/lib/booking-constraints';
import { calendarDayInZone, clockTimeInZone } from '@/lib/booking-clock';

const StaticMap = dynamic(() => import('@/components/StaticMap'), { 
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />
});

type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type AvailableSlot = { key: string; time: string; date: Date };

export function finishPublicBooking(payload: unknown, navigate: (url: string) => void, confirm: () => void) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid booking response');
  const result = payload as Record<string, unknown>;
  if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)) throw new Error('Invalid booking response');
  if ('depositOrderId' in result) {
    if (typeof result.depositOrderId !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(result.depositOrderId)) throw new Error('Invalid deposit response');
    // The pending payment page reads server state; a checkout URL never proves payment.
    navigate(`https://pediturno.com/pago/${result.depositOrderId}`);
    return;
  }
  confirm();
}

export function bookingSelectionFromSlot(slot: AvailableSlot) {
  return { dateKey: format(slot.date, 'yyyy-MM-dd'), time: slot.time };
}

export function nextCandidateAfterConflict(intervalEnd: Date, preparationMinutes: number) {
  return addMinutes(intervalEnd, preparationMinutes);
}

const socialIcons: { [key in SocialLinkType]: React.ComponentType<{ className?: string }> } = {
  instagram: Instagram,
  facebook: Facebook,
  website: Globe,
  tiktok: Tally1,
  x: XIcon,
  youtube: Youtube,
  linkedin: Linkedin,
  custom: LinkIcon,
};

// --- NUEVO: Skeleton visual para horarios ---
function SlotsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {['Mañana','Tarde','Noche'].map((_, idx) => (
        <div key={idx} className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((__, i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface BookingClientPageProps {
  businessData: BusinessProfile | null;
  services: Service[];
  canchas?: Cancha[];
  spaces?: Space[];
  businessId: string | null;
  showBusinessHeader?: boolean;
  demoMode?: boolean;
}

type AppointmentWithResourceId = Appointment & { canchaId?: string; spaceId?: string; durationMinutes?: number; preparationMinutes?: number; cleanupMinutes?: number; bookingBufferMinutes?: number };

/**
 * Keeps resource availability scoped to the selected cancha. Older appointments
 * only have the display name, so they use that as a migration fallback.
 */
export function appointmentsForSelectedResource(
  appointments: Appointment[],
  selectedCancha: Cancha | null,
  selectedSpace: Space | null = null,
): Appointment[] {
  if (selectedSpace) {
    return appointments.filter((appointment) => {
      const spaceId = (appointment as AppointmentWithResourceId).spaceId;
      return spaceId ? spaceId === selectedSpace.id : appointment.space === selectedSpace.name;
    });
  }
  if (!selectedCancha) {
    return appointments.filter((appointment) => !(appointment as AppointmentWithResourceId).canchaId && !(appointment as AppointmentWithResourceId).spaceId && !appointment.cancha && !appointment.space);
  }

  return appointments.filter((appointment) => {
    const canchaId = (appointment as AppointmentWithResourceId).canchaId;
    return canchaId ? canchaId === selectedCancha.id : appointment.cancha === selectedCancha.name;
  });
}

export default function BookingClientPage({ businessData: initialBusinessData, services: initialServices, canchas: initialCanchas = [], spaces: initialSpaces = [], businessId: initialBusinessId, showBusinessHeader = true, demoMode = false }: BookingClientPageProps) {
  const searchParams = useSearchParams();
  const appointmentToRescheduleId = searchParams.get('reschedule');
  const slug = initialBusinessData?.slug;

  const [businessData, setBusinessData] = useState(initialBusinessData);
  const [services, setServices] = useState(initialServices);
  const [canchas, setCanchas] = useState(initialCanchas);
  const [spaces] = useState(initialSpaces);
  const [businessId, setBusinessId] = useState(initialBusinessId);
  const businessTimeZone = businessData?.timeZone || BUSINESS_TIME_ZONE;
  const [clockRevision, setClockRevision] = useState(0);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [loadedAvailabilityKey, setLoadedAvailabilityKey] = useState<string | null>(null);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const availabilityKey = businessId && selectedDate ? `${businessId}:${format(selectedDate, 'yyyy-MM-dd')}` : null;
  const availabilityVerified = demoMode || (availabilityKey !== null && loadedAvailabilityKey === availabilityKey && !availabilityError);
  const [isOpen, setIsOpen] = useState(false);
  const [timeChecked, setTimeChecked] = useState(false);
  
  // Reschedule state
  const isRescheduleMode = false;

  // Booking state
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedCancha, setSelectedCancha] = useState<Cancha | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<Space | null>(null);
  const [selectedSpacePackage, setSelectedSpacePackage] = useState<SpacePackage | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const bookingInFlightRef = useRef(false);
  const bookingIdempotencyKeyRef = useRef<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [isSlotsLoading, setIsSlotsLoading] = useState(false);

  const { toast } = useToast();
  const isSportsBusiness = businessData?.businessType === 'sports_facility';
  const isSpacesBusiness = businessData?.businessType === 'spaces';
  const isCanchaReservation = isSportsBusiness || selectedCancha !== null;
  const isSpaceReservation = isSpacesBusiness || selectedSpace !== null;

  const selectCancha = useCallback((cancha: Cancha) => {
    setSelectedSpace(null);
    setSelectedSpacePackage(null);
    setSelectedCancha(cancha);
    setSelectedService({
      id: cancha.id,
      name: cancha.name,
      duration: String(cancha.duration || 60),
      price: cancha.price,
      status: 'Activo',
      businessId: cancha.businessId,
      photo: cancha.photo,
      workingHours: cancha.workingHours,
      unavailableDates: cancha.unavailableDates,
    });
  }, []);

  const selectService = useCallback((service: Service) => {
    setSelectedCancha(null);
    setSelectedSpace(null);
    setSelectedSpacePackage(null);
    setSelectedService(service);
  }, []);

  const selectSpace = useCallback((space: Space, selectedPackage: SpacePackage) => {
    setSelectedCancha(null);
    setSelectedSpace(space);
    setSelectedSpacePackage(selectedPackage);
    setSelectedService({
      id: space.id,
      name: space.name,
      duration: String(selectedPackage.durationMinutes),
      price: selectedPackage.price,
      status: 'Activo',
      businessId: space.businessId,
      photo: space.photo,
      workingHours: space.workingHours,
      unavailableDates: space.unavailableDates,
      bookingBufferMinutes: space.bookingBufferMinutes,
    });
  }, []);

  const activateWithKeyboard = (event: React.KeyboardEvent, onActivate: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  };

  useEffect(() => {
    // Set initial date only on client-side to prevent hydration mismatch
    setSelectedDate(calendarDayInZone(new Date(), businessTimeZone));
    const refresh = () => setClockRevision(value => value + 1);
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [businessTimeZone]);

  useEffect(() => {
    bookingIdempotencyKeyRef.current = null;
  }, [selectedDate, selectedSlot?.key, selectedService?.id, selectedCancha?.id, selectedSpace?.id, selectedSpacePackage?.durationMinutes]);
  
  useEffect(() => {
    if (!appointmentToRescheduleId) return;
    toast({
      variant: 'destructive',
      title: 'Reprogramación no disponible',
      description: 'Solicita un nuevo enlace seguro para reprogramar tu turno.',
    });
    window.history.replaceState({}, '', `/${slug || ''}`);
  }, [appointmentToRescheduleId, slug, toast]);

  useEffect(() => {
    if (demoMode || !businessId || !selectedDate) {
      setAppointments([]);
      setIsLoading(false);
      return;
    }

    const availabilityBusinessId = businessId;
    const availabilityDate = selectedDate;
    let active = true;
    const controller = new AbortController();

    async function loadAvailability() {
      setIsLoading(true);
      setLoadedAvailabilityKey(null);
      setAvailabilityError(null);
      try {
        const dateKey = format(availabilityDate, 'yyyy-MM-dd');
        const appCheckHeaders = await publicAppCheckHeaders();
        const response = await fetch(`/api/public/availability?businessId=${encodeURIComponent(availabilityBusinessId)}&date=${dateKey}`, {
          cache: 'no-store',
          signal: controller.signal,
          headers: appCheckHeaders,
        });
        if (!response.ok) throw new Error('Availability unavailable');
        const payload = await response.json();
        if (!active) return;
        if (!Array.isArray(payload.appointments)) throw new Error('Invalid availability response');
        setLoadedAvailabilityKey(`${availabilityBusinessId}:${dateKey}`);
        setAppointments(payload.appointments.map((appointment: Omit<Appointment, 'date'> & { date: string }) => ({
          ...appointment,
          avatar: '',
          client: '',
          clientPhone: '',
          businessId: availabilityBusinessId,
          date: new Date(appointment.date),
        })));
      } catch (error) {
        if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
          setAppointments([]);
          setLoadedAvailabilityKey(null);
          setAvailabilityError('No se pudo verificar la disponibilidad. Reintentá antes de elegir un horario.');
          toast({ variant: 'destructive', title: 'Horarios no disponibles', description: 'Vuelve a intentarlo en unos instantes.' });
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadAvailability();
    return () => {
      active = false;
      controller.abort();
    };
  }, [businessId, selectedDate, toast, demoMode, availabilityRevision]);

  const checkOpenStatus = useCallback(() => {
    if (!businessData) return;

    const hoursToCheck = selectedService?.workingHours;
    if (!hoursToCheck) return;

    const now = new Date();
    const day = calendarDayInZone(now, businessTimeZone).getDay() as DayOfWeek;
    
    const currentDayConfig = hoursToCheck[day];
    const currentDayHours = currentDayConfig?.slots;

    if (currentDayConfig?.isAlternating) {
      const weekNumber = getWeek(calendarDayInZone(now, businessTimeZone), { weekStartsOn: 1 });
      if (weekNumber % 2 !== 0) { // Example: available on even weeks
        setIsOpen(false);
        setTimeChecked(true);
        return;
      }
    }

    const [hours, minutes] = clockTimeInZone(now, businessTimeZone).split(':').map(Number);
    const currentTime = hours + minutes / 60;
    
    if (currentDayHours && Array.isArray(currentDayHours)) {
      for (const slot of currentDayHours) {
        const [openHour, openMinute] = slot.start.split(':').map(Number);
        const [closeHour, closeMinute] = slot.end.split(':').map(Number);
        const openTime = openHour + openMinute / 60;
        const closeTime = closeHour + closeMinute / 60;
        if (currentTime >= openTime && currentTime < closeTime) {
          setIsOpen(true);
          setTimeChecked(true);
          return;
        }
      }
    }
    
    setIsOpen(false);
    setTimeChecked(true);

  }, [businessData, selectedService, businessTimeZone]);

  useEffect(() => {
    checkOpenStatus();
    const interval = setInterval(checkOpenStatus, 60000);
    return () => clearInterval(interval);

  }, [checkOpenStatus]);
  
  useEffect(() => {
    if (!selectedDate || !selectedService || !businessData || !availabilityVerified) {
      setAvailableSlots([]);
      return;
    }

    setIsSlotsLoading(true);

    const calculateSlots = () => {
      const workingHours = selectedService.workingHours;
      if (!workingHours) {
        setAvailableSlots([]);
        setIsSlotsLoading(false);
        return;
      }

      const dayOfWeek = selectedDate.getDay() as DayOfWeek;
      const dayConfig = workingHours[dayOfWeek];
      const dayWorkingSlots = dayConfig?.slots;
      
      const bookingLeadTimeHours = businessData.bookingSettings?.bookingLeadTimeHours ?? 0;
      const earliestBookingTime = addHours(new Date(), bookingLeadTimeHours);

      if (dayConfig?.isAlternating) {
        const weekNumber = getWeek(selectedDate, { weekStartsOn: 1 });
        if (weekNumber % 2 !== 0) { // Example: not available on odd weeks
          setAvailableSlots([]);
          setIsSlotsLoading(false);
          return;
        }
      }
      
      if (!dayWorkingSlots || !Array.isArray(dayWorkingSlots) || dayWorkingSlots.length === 0) {
        setAvailableSlots([]);
        setIsSlotsLoading(false);
        return;
      }

      const dayAppointments = appointmentsForSelectedResource(appointments, selectedCancha, selectedSpace)
        .filter((appt) => appt.status !== 'Cancelado');

      
      const appointmentBufferMinutes = selectedService.bookingBufferMinutes ?? businessData.bookingSettings?.appointmentBufferMinutes ?? 0;
      const preparationMinutes = selectedSpace?.preparationMinutes || 0;
      const cleanupMinutes = selectedSpace?.cleanupMinutes || 0;

      const occupiedIntervals: { start: Date; end: Date }[] = [];
      dayAppointments.forEach(appt => {
        const occupiedStartAt = appt.occupiedStartAt ? new Date(appt.occupiedStartAt) : null;
        const occupiedEndAt = appt.occupiedEndAt ? new Date(appt.occupiedEndAt) : null;
        if (occupiedStartAt && occupiedEndAt && Number.isFinite(occupiedStartAt.getTime()) && Number.isFinite(occupiedEndAt.getTime()) && occupiedEndAt > occupiedStartAt) {
          occupiedIntervals.push({ start: occupiedStartAt, end: occupiedEndAt });
          return;
        }
        const [startHour, startMinute] = appt.time.split(':').map(Number);
        const apptService = services.find(s => s.name === appt.service);
        const storedDuration = Number((appt as AppointmentWithResourceId).durationMinutes);
        const duration = Number.isFinite(storedDuration) && storedDuration > 0
          ? storedDuration
          : selectedCancha && appt.cancha
          ? selectedCancha.duration
          : apptService ? parseInt(apptService.duration, 10) : 30;

        const snapshot = appt as AppointmentWithResourceId;
        // Availability serializes date as a date-only wall-clock value at noon.
        const startTime = localTimeToUtc(format(appt.date, 'yyyy-MM-dd'), `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`, businessTimeZone);
        const protectedStart = addMinutes(startTime, -(snapshot.preparationMinutes ?? preparationMinutes));
        const endTime = addMinutes(startTime, duration + (snapshot.cleanupMinutes ?? cleanupMinutes) + (snapshot.bookingBufferMinutes ?? appointmentBufferMinutes));
        occupiedIntervals.push({ start: protectedStart, end: endTime });
      });
      
      const availableSlotsList: AvailableSlot[] = [];
      const serviceDurationMinutes = parseInt(selectedService.duration, 10) || 30;

      for (const slot of dayWorkingSlots) {
        const dateKey = format(selectedDate, 'yyyy-MM-dd');
        let potentialSlotTime = localTimeToUtc(dateKey, slot.start, businessTimeZone);
        let endDateKey = dateKey;
        if (selectedSpace && (slot.end < slot.start || (slot.start === '00:00' && slot.end === '00:00'))) {
          endDateKey = shiftDateKey(dateKey, 1);
        }
        const dayEndTime = localTimeToUtc(endDateKey, slot.end, businessTimeZone);

        while (potentialSlotTime < dayEndTime) {
          const potentialSlotEnd = addMinutes(potentialSlotTime, serviceDurationMinutes);
          const protectedSlotStart = addMinutes(potentialSlotTime, -preparationMinutes);
          const protectedSlotEnd = addMinutes(potentialSlotEnd, cleanupMinutes + appointmentBufferMinutes);

          if (potentialSlotEnd > dayEndTime) {
            break; 
          }
          
          if (potentialSlotTime <= earliestBookingTime) {
            potentialSlotTime = addMinutes(potentialSlotTime, serviceDurationMinutes + cleanupMinutes + appointmentBufferMinutes);
            continue; 
          }
          
          let isSlotAvailable = true;
          for (const interval of occupiedIntervals) {
            if (protectedSlotStart < interval.end && protectedSlotEnd > interval.start) {
              isSlotAvailable = false;
              potentialSlotTime = nextCandidateAfterConflict(interval.end, preparationMinutes);
              break;
            }
          }

          if (!isSlotAvailable) {
            continue; 
          }

          const time = clockTimeInZone(potentialSlotTime, businessTimeZone);
          availableSlotsList.push({ key: `${dateKeyInZone(potentialSlotTime, businessTimeZone)}T${time}`, time, date: calendarDayInZone(potentialSlotTime, businessTimeZone) });
          potentialSlotTime = addMinutes(potentialSlotTime, serviceDurationMinutes + cleanupMinutes + appointmentBufferMinutes);
        }
      }
      setAvailableSlots(availableSlotsList);
      setIsSlotsLoading(false);
    }

    // Pequeño delay para que el UI pinte el estado de carga antes del cálculo
    const timer = setTimeout(calculateSlots, 150);

    return () => clearTimeout(timer);

  }, [selectedDate, selectedService, selectedCancha, selectedSpace, appointments, businessData, services, businessTimeZone, clockRevision, availabilityVerified]);

  useEffect(() => {
    if (!isSlotsLoading && !bookingSuccess && selectedSlot && !availableSlots.some(slot => slot.key === selectedSlot.key)) {
      setSelectedSlot(null);
      setIsConfirmModalOpen(false);
    }
  }, [availableSlots, isSlotsLoading, bookingSuccess, selectedSlot]);

  const groupedSlots = useMemo(() => {
    const morning: AvailableSlot[] = [];
    const afternoon: AvailableSlot[] = [];
    const night: AvailableSlot[] = [];

    availableSlots.forEach(slot => {
      const hour = parseInt(slot.time.split(':')[0], 10);
      if (hour < 12) {
        morning.push(slot);
      } else if (hour < 18) {
        afternoon.push(slot);
      } else {
        night.push(slot);
      }
    });

    return { morning, afternoon, night };
  }, [availableSlots]);

  const whatsAppUrl = businessData?.whatsappButtonEnabled && businessData.whatsappNumber
    ? `https://wa.me/${businessData.whatsappNumber.replace(/\D/g, '')}`
    : '';
  
  const getFormattedAddress = () => {
    if (!businessData?.address) return '';
    const { street, number, city, province, postalCode } = businessData.address;
    const parts = [
      street && number ? `${street} ${number}` : street,
      city,
      province,
      postalCode
    ].filter(Boolean); 
    return parts.join(', ');
  }

  const getGoogleMapsUrl = () => {
    if (businessData?.location?.lat && businessData?.location?.lng) {
      return `https://maps.google.com/?daddr=${businessData.location.lat},${businessData.location.lng}`;
    }
    const address = getFormattedAddress();
    if (!address) return '';
    return `https://maps.google.com/?daddr=${encodeURIComponent(address)}`;
  }
  
  const handleRescheduleBooking = async () => {
    toast({
      variant: 'destructive',
      title: 'Reprogramación no disponible',
      description: 'Solicita un nuevo enlace seguro para reprogramar tu turno.',
    });
  }

  const handleConfirmBooking = async (clientData: { name: string; phone: string; email: string }) => {
    if (!businessId || !selectedService || !selectedDate || !selectedSlot || !clientData.email) {
      toast({
        variant: 'destructive',
        title: 'Error Inesperado',
        description: 'Faltan datos de la reserva. Por favor, reinicia el proceso.'
      });
      return;
    }

    const earliest = addHours(new Date(), businessData?.bookingSettings?.bookingLeadTimeHours ?? 0);
    if (localTimeToUtc(format(selectedSlot.date, 'yyyy-MM-dd'), selectedSlot.time, businessTimeZone) <= earliest) {
      setSelectedSlot(null);
      setIsConfirmModalOpen(false);
      setClockRevision(value => value + 1);
      toast({ title: 'Ese horario ya pasó', description: 'Elegí un nuevo horario disponible.' });
      return;
    }
    if (demoMode) { setBookingSuccess(true); return; }
    if (bookingInFlightRef.current || !availabilityVerified) return;
    bookingInFlightRef.current = true;
    setBookingError(null);
    setIsBooking(true);
    try {
      bookingIdempotencyKeyRef.current ??= crypto.randomUUID();
      const appCheckHeaders = await publicAppCheckHeaders({ consume: true });
      const slotSelection = bookingSelectionFromSlot(selectedSlot);
      const bookingResponse = await fetch('/api/public/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...appCheckHeaders },
        body: JSON.stringify({
        businessId: businessId,
        client: clientData.name,
        clientPhone: clientData.phone,
        clientEmail: clientData.email,
        serviceId: selectedCancha || selectedSpace ? undefined : selectedService.id,
        canchaId: selectedCancha?.id,
        spaceId: selectedSpace?.id,
        durationMinutes: selectedSpacePackage?.durationMinutes,
        dateKey: slotSelection.dateKey,
        time: slotSelection.time,
        idempotencyKey: bookingIdempotencyKeyRef.current,
        }),
      });
      if (!bookingResponse.ok) {
        const errorPayload = await bookingResponse.json().catch(() => null);
        if (bookingResponse.status === 409 && errorPayload?.error === 'Slot already booked') {
          throw new Error('SLOT_TAKEN');
        }
        if (bookingResponse.status === 401 && errorPayload?.error === 'Request verification failed') {
          throw new Error('PUBLIC_APP_CHECK_REJECTED');
        }
        throw new Error(errorPayload?.error || 'Booking unavailable');
      }
      finishPublicBooking(await bookingResponse.json(), url => window.location.assign(url), () => setBookingSuccess(true));
      bookingIdempotencyKeyRef.current = null;
    } catch (error) {
      if (error instanceof Error && error.message === 'SLOT_TAKEN') {
        setAvailableSlots(slots => slots.filter(slot => slot.key !== selectedSlot.key));
        setSelectedSlot(null);
        setIsConfirmModalOpen(false);
        toast({
          variant: 'destructive',
          title: 'Ese horario acaba de ocuparse',
          description: 'Elegí otro horario disponible para completar la reserva.',
        });
        return;
      }
      // Fixed diagnostics only; provider errors may include sensitive request context.
      console.error('Public booking failed');
      const guidance = publicBookingFailureMessage(error);
      setBookingError(guidance || 'No se pudo verificar o guardar la reserva. Tus datos siguen cargados; volvé a intentarlo.');
      toast({
        variant: 'destructive',
        title: 'Error al reservar',
        description: guidance || (isSpaceReservation
          ? 'No se pudo crear la reserva del espacio. Por favor, intentá de nuevo más tarde.'
          : isCanchaReservation
          ? 'No se pudo crear la reserva de cancha. Por favor, intenta de nuevo más tarde.'
          : 'No se pudo crear el turno. Por favor, intenta de nuevo más tarde.')
      });
    } finally {
      bookingInFlightRef.current = false;
      setIsBooking(false);
    }
  }
  
  const resetBookingFlow = () => {
    setIsConfirmModalOpen(false);
    setBookingSuccess(false);
    setSelectedService(null);
    setSelectedCancha(null);
    setSelectedSpace(null);
    setSelectedSpacePackage(null);
    setSelectedSlot(null);
    bookingIdempotencyKeyRef.current = null;
    setSelectedDate(calendarDayInZone(new Date(), businessTimeZone));
  }

  const handleDialogChange = (open: boolean) => {
    if (!open) {
      if (bookingSuccess) {
        resetBookingFlow();
      } else {
        setIsConfirmModalOpen(false);
      }
    } else {
      setIsConfirmModalOpen(true);
    }
  }

  const isBookingButtonDisabled = !selectedService || !selectedDate || !selectedSlot || !availabilityVerified || isLoading;
  
  const isAutoConfirm = businessData?.bookingSettings?.autoConfirm ?? true;
  const successTitle = isRescheduleMode
    ? (isCanchaReservation ? '¡Reserva reprogramada!' : '¡Turno reagendado!')
    : (isAutoConfirm ? '¡Reserva Confirmada!' : '¡Solicitud Recibida!');
  const successDescription = isRescheduleMode 
    ? (isSpaceReservation
      ? "Tu reserva de espacio fue reprogramada. Recibirás un correo con los detalles."
      : isCanchaReservation
      ? "Tu reserva de cancha ha sido reprogramada con éxito. Recibirás un nuevo correo con los detalles."
      : "Tu turno ha sido reagendado con éxito. Recibirás un nuevo correo con los detalles.")
    : (isAutoConfirm 
      ? (isSpaceReservation
        ? "Tu reserva de espacio fue confirmada. Recibirás un correo con los detalles."
        : isCanchaReservation
        ? "Tu reserva de cancha ha sido confirmada. Recibirás una confirmación por correo electrónico."
        : "Tu turno ha sido agendado con éxito. Recibirás una confirmación por correo electrónico.")
      : (isSpaceReservation
        ? "Tu solicitud de reserva fue enviada. Recibirás por correo los datos de la solicitud; el negocio todavía debe aprobarla."
        : isCanchaReservation
        ? "Tu solicitud de reserva de cancha fue enviada. Recibirás por correo los datos de la solicitud; el negocio todavía debe aprobarla."
        : "Tu solicitud de turno fue enviada. Recibirás por correo los datos de la solicitud; el negocio todavía debe aprobarla."));

  const getCalendarEndDate = () => {
    if (!selectedDate || !selectedSlot || !selectedService) return dateKeyInZone(new Date(), businessTimeZone);
    const startDate = localTimeToUtc(format(selectedSlot.date, 'yyyy-MM-dd'), selectedSlot.time, businessTimeZone);
    const endDate = addMinutes(startDate, parseInt(selectedService.duration, 10));
    return dateKeyInZone(endDate, businessTimeZone);
  }
  
  const getCalendarEndTime = () => {
    if (!selectedDate || !selectedSlot || !selectedService) return '00:00';
    const startDate = localTimeToUtc(format(selectedSlot.date, 'yyyy-MM-dd'), selectedSlot.time, businessTimeZone);
    const endDate = addMinutes(startDate, parseInt(selectedService.duration, 10));
    return clockTimeInZone(endDate, businessTimeZone);
  }

  if (isLoading && appointments.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-secondary">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!businessData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-secondary text-center p-4">
        <Store className="h-16 w-16 text-muted-foreground mb-4" />
        <h1 className="text-4xl font-bold font-headline">Negocio no disponible</h1>
        <p className="text-muted-foreground mt-4 max-w-lg">El enlace de reserva que has seguido no existe, ha sido movido o el negocio no se encuentra activo actualmente.</p>
        <Button asChild className="mt-6">
          <Link href="/">Volver al Inicio</Link>
        </Button>
      </div>
    )
  }

  const selectedThemeName = businessData.theme;
  const activeTheme = selectedThemeName === 'custom' 
    ? null
    : themes[selectedThemeName as ThemeName] || themes.menta;

  const displayWorkingHours = selectedService?.workingHours ?? (demoMode ? (services[0] ?? canchas[0] ?? spaces[0])?.workingHours : undefined);
  const weekDays = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const simulateDemoContact = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    toast({ title: 'Contacto de ejemplo', description: 'En tu página, este botón abrirá tu WhatsApp, red social o ubicación. Esta demo usa datos ficticios y no contacta a nadie.' });
  };

  return (
    <div className="bg-background min-h-screen">
      <ThemeStyle theme={activeTheme} customTheme={selectedThemeName === 'custom' ? businessData.customTheme : null} />
      <main className={cn("container mx-auto max-w-2xl p-4 sm:p-6 md:p-8 transition-all", selectedSlot && selectedDate && selectedService && "pb-24 sm:pb-8")}>
        {showBusinessHeader && <header className="flex flex-col items-center text-center">
          {businessData.logo ? (
            <div className="relative mb-5 flex items-center justify-center">
              <div className="relative max-w-[280px] max-h-[140px] min-w-[96px] min-h-[96px] p-2.5 rounded-2xl border-2 border-border/80 bg-card/90 backdrop-blur-md shadow-xl flex items-center justify-center overflow-hidden transition-all duration-300 hover:shadow-2xl">
                <Image
                  src={businessData.logo}
                  alt={`Logo de ${businessData.name}`}
                  width={280}
                  height={140}
                  unoptimized
                  className="max-h-[120px] w-auto max-w-full object-contain rounded-xl"
                  data-ai-hint="logo"
                />
              </div>
            </div>
          ) : (
            <Avatar className="h-24 w-24 mb-4 border-4 border-background shadow-lg">
              <AvatarFallback className="text-3xl font-bold bg-primary/10 text-primary">
                {businessData.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          )}
          <h1 className="text-3xl sm:text-4xl font-bold font-headline">{businessData.name}</h1>
          {businessData.description && (
            <p className="text-muted-foreground mt-2 max-w-prose">{businessData.description}</p>
          )}
        </header>}
        
        <section id="contacto-demo" aria-label="Contacto y redes del negocio" className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {whatsAppUrl && (
            <Button asChild size="lg" className="w-full bg-green-700 text-white hover:bg-green-800 sm:col-span-2">
              <a href={demoMode ? '#contacto-demo' : whatsAppUrl} onClick={demoMode ? simulateDemoContact : undefined} target={demoMode ? undefined : '_blank'} rel="noopener noreferrer">
                <Image src="/images/whatsapp.webp" alt="WhatsApp" width={24} height={24} className="mr-2"/>
                Contactar por WhatsApp
              </a>
            </Button>
          )}

          {businessData.socialLinks?.map(link => {
            const IconComponent = socialIcons[link.type] || LinkIcon;
            const buttonTitle = link.type === 'custom' ? link.title : (link.type.charAt(0).toUpperCase() + link.type.slice(1));
            return (
              <Button key={link.id} asChild size="lg" variant="outline" className="w-full">
                <a href={demoMode ? '#contacto-demo' : link.url} onClick={demoMode ? simulateDemoContact : undefined} target={demoMode ? undefined : '_blank'} rel="noopener noreferrer">
                  <IconComponent className="mr-2 h-5 w-5" />
                  {buttonTitle}
                </a>
              </Button>
            )
          })}
        </section>

        <Card className="mt-8 shadow-md">
          <CardHeader>
            {isRescheduleMode ? (
              <>
                <CardTitle className="flex items-center gap-2">
                  <Edit className="h-6 w-6"/>
                  {isCanchaReservation ? 'Reprogramar Reserva' : 'Reprogramar Turno'}
                </CardTitle>
                <CardDescription>
                  {isCanchaReservation ? 'Seleccioná una nueva fecha y hora para tu reserva.' : 'Selecciona una nueva fecha y hora para tu turno.'}
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle className="flex items-center gap-2">
                  <CalendarIcon className="h-6 w-6"/>
                  {isSpacesBusiness ? 'Reservá tu Espacio' : isSportsBusiness ? 'Reserva tu Cancha' : 'Reserva tu Turno'}
                </CardTitle>
                <CardDescription>
                  {isSpacesBusiness
                    ? 'Elegí el espacio, el bloque de horas, la fecha y el horario de inicio.'
                    : isSportsBusiness
                    ? 'Elegí una cancha, fecha y horario para hacer tu reserva online.'
                    : 'Sigue los pasos para agendar tu cita online.'}
                </CardDescription>
              </>
            )}
            <p className="text-xs text-muted-foreground">{businessTimeZone === BUSINESS_TIME_ZONE ? 'Fechas y horarios en hora argentina (UTC−3).' : `Fechas y horarios en ${businessTimeZone}.`}</p>
          </CardHeader>
          <CardContent>
            {!selectedService ? (
              // Step 1: Selection (Services vs Canchas vs Hybrid)
              <div className="space-y-4">
                {spaces.length > 0 ? (
                  <div className="space-y-4">
                    <div><h3 className="font-semibold text-lg text-foreground">1. Elegí un espacio y su duración</h3><p className="text-sm text-muted-foreground">El precio corresponde al bloque completo. La preparación y limpieza ya se contemplan en la disponibilidad.</p></div>
                    <div className="grid grid-cols-1 gap-4">
                      {spaces.map((space) => (
                        <Card key={space.id} className="overflow-hidden border-2 border-transparent bg-secondary/40">
                          <CardContent className="grid gap-4 p-4 sm:grid-cols-[128px_1fr]">
                            <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-background">
                              {space.photo ? <Image src={space.photo} alt={space.name} fill sizes="128px" className="object-cover" /> : <Building2 className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground" />}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-lg font-semibold">{space.name}</h4>
                              {space.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{space.description}</p>}
                              {space.capacity && <p className="mt-2 flex items-center text-sm text-muted-foreground"><Users className="mr-1 h-4 w-4" />Hasta {space.capacity} personas</p>}
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {space.packages.map((item) => (
                                  <Button key={item.durationMinutes} type="button" variant="outline" className="h-auto justify-between gap-3 px-3 py-2" onClick={() => selectSpace(space, item)} aria-label={`Reservar ${space.name} por ${item.durationMinutes === 1440 ? 'jornada completa' : `${item.durationMinutes / 60} horas`}`}>
                                    <span>{item.durationMinutes === 1440 ? 'Jornada completa' : `${item.durationMinutes / 60} horas`}</span><strong>$ {item.price}</strong>
                                  </Button>
                                ))}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : canchas.length > 0 && services.length > 0 ? (
                  <Tabs defaultValue="canchas" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 mb-4">
                      <TabsTrigger value="canchas" className="flex items-center gap-2">
                        <Trophy className="h-4 w-4" />
                        Canchas Deportivas
                      </TabsTrigger>
                      <TabsTrigger value="services" className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Servicios y Citas
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="canchas" className="space-y-4">
                      <h3 className="font-semibold text-lg text-foreground">1. Selecciona tu Cancha / Espacio</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {canchas.map(cancha => (
                          <Card 
                            key={cancha.id} 
                            onClick={() => selectCancha(cancha)}
                            onKeyDown={(event) => activateWithKeyboard(event, () => selectCancha(cancha))}
                            role="button"
                            tabIndex={0}
                            aria-label={`Seleccionar cancha ${cancha.name}`}
                            className="group relative cursor-pointer border-2 border-transparent bg-secondary/50 hover:bg-accent/80 hover:text-accent-foreground transition-all duration-300 hover:shadow-lg active:scale-[0.98]"
                          >
                            <div className="absolute top-2 right-2 h-5 w-5 bg-background text-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Check className="h-4 w-4"/>
                            </div>
                            <CardContent className="p-4 flex items-center gap-4">
                              {cancha.photo ? (
                                <Image src={cancha.photo} alt={cancha.name} width={80} height={80} className="rounded-lg object-contain bg-secondary/40 h-20 w-20" />
                              ) : (
                                <div className="h-20 w-20 rounded-lg bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                  <Trophy className="h-10 w-10 text-emerald-500" />
                                </div>
                              )}
                              <div className="flex-grow">
                                <h4 className="font-semibold">{cancha.name}</h4>
                                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground group-hover:text-accent-foreground mt-1">
                                  <span className="flex items-center"><Clock className="inline-block h-4 w-4 mr-1" />{cancha.duration || 60} min</span>
                                  <span className="flex items-center font-medium text-emerald-800 dark:text-emerald-400">$ {cancha.price}</span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>

                    <TabsContent value="services" className="space-y-4">
                      <h3 className="font-semibold text-lg text-foreground">1. Selecciona un Servicio</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {services.map(service => (
                          <Card 
                            key={service.id} 
                            onClick={() => selectService(service)}
                            onKeyDown={(event) => activateWithKeyboard(event, () => selectService(service))}
                            role="button"
                            tabIndex={0}
                            aria-label={`Seleccionar servicio ${service.name}`}
                            className="group relative cursor-pointer border-2 border-transparent bg-secondary/50 hover:bg-accent/80 hover:text-accent-foreground transition-all duration-300 hover:shadow-lg active:scale-[0.98]"
                          >
                            <div className="absolute top-2 right-2 h-5 w-5 bg-background text-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <Check className="h-4 w-4"/>
                            </div>
                            <CardContent className="p-4 flex items-center gap-4">
                              {service.photo ? (
                                <Image src={service.photo} alt={service.name} width={80} height={80} className="rounded-lg object-contain bg-secondary/40 h-20 w-20" />
                              ) : (
                                <div className="h-20 w-20 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                                  <ImageIcon className="h-10 w-10 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-grow">
                                <h4 className="font-semibold">{service.name}</h4>
                                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground group-hover:text-accent-foreground mt-1">
                                  <span className="flex items-center"><Clock className="inline-block h-4 w-4 mr-1" />{service.duration} min</span>
                                  <span className="flex items-center">$ {service.price}</span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </TabsContent>
                  </Tabs>
                ) : canchas.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-lg text-foreground mb-4">1. Selecciona tu Cancha / Espacio</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {canchas.map(cancha => (
                        <Card 
                          key={cancha.id} 
                          onClick={() => selectCancha(cancha)}
                          onKeyDown={(event) => activateWithKeyboard(event, () => selectCancha(cancha))}
                          role="button"
                          tabIndex={0}
                          aria-label={`Seleccionar cancha ${cancha.name}`}
                          className="group relative cursor-pointer border-2 border-transparent bg-secondary/50 hover:bg-accent/80 hover:text-accent-foreground transition-all duration-300 hover:shadow-lg active:scale-[0.98]"
                        >
                          <div className="absolute top-2 right-2 h-5 w-5 bg-background text-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Check className="h-4 w-4"/>
                          </div>
                          <CardContent className="p-4 flex items-center gap-4">
                            {cancha.photo ? (
                              <Image src={cancha.photo} alt={cancha.name} width={80} height={80} className="rounded-lg object-contain bg-secondary/40 h-20 w-20" />
                            ) : (
                              <div className="h-20 w-20 rounded-lg bg-emerald-950/20 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                <Trophy className="h-10 w-10 text-emerald-500" />
                              </div>
                            )}
                            <div className="flex-grow">
                              <h4 className="font-semibold">{cancha.name}</h4>
                              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground group-hover:text-accent-foreground mt-1">
                                <span className="flex items-center"><Clock className="inline-block h-4 w-4 mr-1" />{cancha.duration || 60} min</span>
                                <span className="flex items-center font-medium text-emerald-800 dark:text-emerald-400">$ {cancha.price}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : services.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-lg text-foreground mb-4">1. Selecciona un Servicio</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {services.map(service => (
                        <Card 
                          key={service.id} 
                          onClick={() => selectService(service)}
                          onKeyDown={(event) => activateWithKeyboard(event, () => selectService(service))}
                          role="button"
                          tabIndex={0}
                          aria-label={`Seleccionar servicio ${service.name}`}
                          className="group relative cursor-pointer border-2 border-transparent bg-secondary/50 hover:bg-accent/80 hover:text-accent-foreground transition-all duration-300 hover:shadow-lg active:scale-[0.98]"
                        >
                          <div className="absolute top-2 right-2 h-5 w-5 bg-background text-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Check className="h-4 w-4"/>
                          </div>
                          <CardContent className="p-4 flex items-center gap-4">
                            {service.photo ? (
                              <Image src={service.photo} alt={service.name} width={80} height={80} className="rounded-lg object-contain bg-secondary/40 h-20 w-20" />
                            ) : (
                              <div className="h-20 w-20 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                                <ImageIcon className="h-10 w-10 text-muted-foreground" />
                              </div>
                            )}
                            <div className="flex-grow">
                              <h4 className="font-semibold">{service.name}</h4>
                              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground group-hover:text-accent-foreground mt-1">
                                <span className="flex items-center"><Clock className="inline-block h-4 w-4 mr-1" />{service.duration} min</span>
                                <span className="flex items-center">$ {service.price}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed bg-secondary/40 px-6 py-10 text-center" role="status">
                    <Store className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold text-lg text-foreground">Todavía no hay opciones disponibles</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      Este negocio aún no publicó opciones para reservar. Volvé a intentarlo más tarde o usá sus datos de contacto si están disponibles.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              // Step 2: Date and Time Selection
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-lg text-foreground">
                      {isRescheduleMode ? '1. Elige Nueva Fecha y Hora' : '2. Elige Fecha y Hora'}
                    </h3>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setSelectedDate(calendarDayInZone(new Date(), businessTimeZone)); setSelectedSlot(null); }}>
                        Hoy
                      </Button>
                      {!isRescheduleMode && (
                        <Button variant="outline" size="sm" onClick={() => { setSelectedService(null); setSelectedCancha(null); setSelectedSpace(null); setSelectedSpacePackage(null); setSelectedDate(calendarDayInZone(new Date(), businessTimeZone)); setSelectedSlot(null); }}>
                          <ArrowLeft className="mr-2 h-4 w-4"/>
                          {selectedSpace ? 'Cambiar Espacio' : selectedCancha ? 'Cambiar Cancha' : 'Cambiar Servicio'}
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-secondary flex items-center gap-4">
                    {selectedService.photo ? (
                      <Image src={selectedService.photo} alt={selectedService.name} width={48} height={48} className="rounded-md object-contain bg-secondary/40 h-12 w-12" />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-background flex items-center justify-center">
                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold">{selectedService.name}</p>
                      <p className="text-sm text-muted-foreground">{selectedSpacePackage ? (selectedSpacePackage.durationMinutes === 1440 ? 'Jornada completa' : `${selectedSpacePackage.durationMinutes / 60} horas`) : `${selectedService.duration} min`} • $ {selectedService.price}</p>
                      {selectedSpace && <p className="text-xs text-muted-foreground">Preparación {selectedSpace.preparationMinutes} min · Limpieza {selectedSpace.cleanupMinutes} min</p>}
                      {selectedSpace && selectedSlot && <p className="text-xs font-medium">Comienza {format(selectedSlot.date, "EEE d 'de' MMM", { locale: es })} a las {selectedSlot.time} · finaliza {getCalendarEndDate() === format(selectedSlot.date, 'yyyy-MM-dd') ? 'el mismo día' : 'al día siguiente'} a las {getCalendarEndTime()}</p>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row gap-8 items-start">
                  <Calendar
                    locale={es}
                    mode="single"
                    today={calendarDayInZone(new Date(), businessTimeZone)}
                    defaultMonth={selectedDate}
                    selected={selectedDate}
                    onSelect={(date) => {
                      setSelectedDate(date);
                      setSelectedSlot(null); // Reset slot when date changes
                    }}
                    className={cn("rounded-md border mx-auto md:mx-0 flex-1 transition-opacity", isSlotsLoading && "opacity-90")}
                    disabled={(date) => {
                      const today = calendarDayInZone(new Date(), businessTimeZone);
                      if (date < today) return true;

                      const bookingHorizonDays = businessData.bookingSettings?.bookingHorizonDays;
                      if (bookingHorizonDays && bookingHorizonDays > 0) {
                        const maxDate = addDays(today, bookingHorizonDays);
                        if (date > maxDate) return true;
                      }
                      
                      const dayOfWeek = date.getDay();
                      const activeWorkingHours = selectedService?.workingHours;
                      if (!activeWorkingHours) return true;
                      
                      const dayConfig = activeWorkingHours ? activeWorkingHours[dayOfWeek] : undefined;

                      if (dayConfig?.isAlternating) {
                        const weekNumber = getWeek(date, { weekStartsOn: 1 });
                        if (weekNumber % 2 !== 0) { // Example: not available on odd weeks
                          return true;
                        }
                      }

                      if (!dayConfig || !dayConfig.slots || dayConfig.slots.length === 0) return true;
                      
                      const serviceUnavailable = selectedService?.unavailableDates || [];

                      if (serviceUnavailable.some(unavailableDate => isSameDay(date, unavailableDate))) return true;
                      
                      return false;
                    }}
                  />
                  <div
                    className="space-y-4 flex-1 w-full"
                    role="status"
                    aria-live="polite"
                    aria-busy={isSlotsLoading}
                  >
                    {/* Mensaje superior: cargando / cantidad */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground min-h-[24px]">
                      {isSlotsLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Cargando horarios disponibles…</span>
                          <span className="sr-only">Buscando horarios disponibles</span>
                        </>
                      ) : availabilityVerified && availableSlots.length > 0 ? (
                        <>
                          <CheckCircle className="h-4 w-4" />
                          <span>Encontramos {availableSlots.length} horarios para este día</span>
                        </>
                      ) : null}
                    </div>

                    {availabilityError ? (
                      <div role="alert" className="space-y-3 rounded-lg border p-4">
                        <p>{availabilityError}</p>
                        <Button variant="outline" onClick={() => setAvailabilityRevision(value => value + 1)}>Reintentar horarios</Button>
                      </div>
                    ) : isLoading || !availabilityVerified || isSlotsLoading ? (
                      <SlotsSkeleton />
                    ) : availabilityVerified && availableSlots.length > 0 ? (
                      <>
                        {groupedSlots.morning.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-semibold text-sm flex items-center gap-2"><Sun className="h-4 w-4 text-muted-foreground" />Mañana</h4>
                            <div className={cn("grid grid-cols-3 sm:grid-cols-4 gap-2", isSlotsLoading && "pointer-events-none")}>
                              {groupedSlots.morning.map(slot => (
                                <Button 
                                  key={slot.key} 
                                  variant={selectedSlot?.key === slot.key ? "default" : "outline"} 
                                  onClick={() => setSelectedSlot(slot)} 
                                  disabled={!selectedDate} 
                                  className={cn(
                                    "h-11 sm:h-10 text-sm font-semibold transition-all active:scale-95",
                                    selectedSlot?.key === slot.key && "ring-2 ring-primary ring-offset-1"
                                  )}
                                >
                                  {slot.time}{selectedDate && !isSameDay(slot.date, selectedDate) ? ' (+1 día)' : ''}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        {groupedSlots.afternoon.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-semibold text-sm flex items-center gap-2"><Sunset className="h-4 w-4 text-muted-foreground" />Tarde</h4>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {groupedSlots.afternoon.map(slot => (
                                <Button 
                                  key={slot.key} 
                                  variant={selectedSlot?.key === slot.key ? "default" : "outline"} 
                                  onClick={() => setSelectedSlot(slot)} 
                                  disabled={!selectedDate} 
                                  className={cn(
                                    "h-11 sm:h-10 text-sm font-semibold transition-all active:scale-95",
                                    selectedSlot?.key === slot.key && "ring-2 ring-primary ring-offset-1"
                                  )}
                                >
                                  {slot.time}{selectedDate && !isSameDay(slot.date, selectedDate) ? ' (+1 día)' : ''}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        {groupedSlots.night.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-semibold text-sm flex items-center gap-2"><Moon className="h-4 w-4 text-muted-foreground" />Noche</h4>
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {groupedSlots.night.map(slot => (
                                <Button 
                                  key={slot.key} 
                                  variant={selectedSlot?.key === slot.key ? "default" : "outline"} 
                                  onClick={() => setSelectedSlot(slot)} 
                                  disabled={!selectedDate} 
                                  className={cn(
                                    "h-11 sm:h-10 text-sm font-semibold transition-all active:scale-95",
                                    selectedSlot?.key === slot.key && "ring-2 ring-primary ring-offset-1"
                                  )}
                                >
                                  {slot.time}{selectedDate && !isSameDay(slot.date, selectedDate) ? ' (+1 día)' : ''}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="col-span-full text-center text-sm text-muted-foreground p-4 bg-secondary/50 rounded-md space-y-3">
                        <p>{selectedDate
                          ? (isSpaceReservation ? 'No hay horarios disponibles para este espacio en este día.' : isCanchaReservation ? 'No hay horarios disponibles para esta cancha en este día.' : 'No hay turnos disponibles para este día.')
                          : 'Selecciona una fecha para ver los horarios.'}</p>
                        {whatsAppUrl && (
                          <Button asChild size="sm" variant="outline" className="inline-flex">
                            <a href={demoMode ? '#contacto-demo' : whatsAppUrl} onClick={demoMode ? simulateDemoContact : undefined} target={demoMode ? undefined : '_blank'} rel="noopener noreferrer">
                              <Image src="/images/whatsapp.webp" alt="WhatsApp" width={18} height={18} className="mr-2"/>
                              Consultar por WhatsApp
                            </a>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="sr-only" aria-live="polite">
                    {availabilityError ? 'Disponibilidad sin verificar' : isLoading || !availabilityVerified || isSlotsLoading ? 'Calculando horarios' : 'Horarios listos'}
                  </span>
                </div>

                <div className="mt-6">
                  <Button size="lg" className="w-full" disabled={isBookingButtonDisabled} onClick={() => setIsConfirmModalOpen(true)}>
                    {isRescheduleMode ? (isCanchaReservation ? 'Reprogramar Reserva' : 'Reprogramar Turno') : 'Continuar con la Reserva'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-8 shadow-md">
          <CardHeader>
            <CardTitle>Nuestra Ubicación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 mt-1 text-muted-foreground flex-shrink-0" />
              <span>{getFormattedAddress()}</span>
            </div>
            {getFormattedAddress() && (
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={demoMode ? '#contacto-demo' : getGoogleMapsUrl()} onClick={demoMode ? simulateDemoContact : undefined} target={demoMode ? undefined : '_blank'} rel="noopener noreferrer">
                  <Map className="mr-2 h-4 w-4" />
                  Cómo llegar
                </a>
              </Button>
            )}
            {businessData.location && (
              <div className="mt-2 rounded-lg overflow-hidden h-64 border">
                <StaticMap location={businessData.location} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="mt-8 shadow-md">
          <CardHeader>
            <CardTitle>Horario de Atención</CardTitle>
          </CardHeader>
          <CardContent>
            {displayWorkingHours ? (
              <ul className="text-sm space-y-1 text-muted-foreground">
                {weekDays.map((day, index) => {
                  const dayConfig = displayWorkingHours[index as DayOfWeek];
                  const slots = dayConfig?.slots;
                  const hoursText = slots && slots.length > 0
                    ? slots.map(slot => `${slot.start} - ${slot.end}`).join(' y ')
                    : 'Cerrado';
                  
                    return (
                      <li key={day} className="flex justify-between">
                        <span>{day}:</span>
                        <span className="font-medium text-foreground">
                          {hoursText} {dayConfig?.isAlternating ? '(Alternado)' : ''}
                        </span>
                      </li>
                    )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isSpacesBusiness ? 'Elegí un espacio y un paquete para ver sus horarios disponibles.' : isSportsBusiness ? 'Seleccioná una cancha para ver sus horarios disponibles.' : 'Selecciona un servicio para ver su horario de atención.'}
              </p>
            )}
            {timeChecked && (
              <div className="mt-4 flex items-center font-semibold">
                <span className={cn("h-2 w-2 rounded-full mr-2", isOpen ? 'bg-green-500' : 'bg-red-500')}></span>
                <span className="text-foreground">
                  Ahora: {isOpen ? 'Abierto' : 'Cerrado'}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <BookingPageFooter businessType={businessData.businessType} className={selectedSlot && selectedDate && selectedService ? 'pb-24 sm:pb-6' : undefined} />

      {/* Mobile Sticky Bottom Action Bar for Instant Confirmation */}
      {selectedSlot && selectedDate && selectedService && !isConfirmModalOpen && (
        <aside 
          aria-label={isSpaceReservation ? 'Confirmar reserva de espacio seleccionada' : isCanchaReservation ? 'Confirmar reserva de cancha seleccionada' : 'Confirmar turno seleccionado'}
          className="fixed bottom-0 inset-x-0 z-40 p-3 bg-background/95 backdrop-blur-md border-t border-border shadow-2xl sm:hidden flex items-center justify-between gap-3 animate-in slide-in-from-bottom-5 duration-300"
        >
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {isSpaceReservation ? 'Espacio seleccionado' : isCanchaReservation ? 'Cancha seleccionada' : 'Turno seleccionado'}
            </span>
            <span className="text-xs font-bold text-foreground truncate">
              {format(selectedSlot.date, "EEE d 'de' MMM", { locale: es })} • {selectedSlot.time} hs
            </span>
          </div>
          <Button
            size="default"
            onClick={() => setIsConfirmModalOpen(true)}
            className="shrink-0 font-bold shadow-md shadow-primary/20 text-xs px-4 h-10 active:scale-95"
          >
            {isRescheduleMode ? 'Reprogramar' : 'Continuar'} <ArrowRight className="ml-1.5 h-3.5 w-3.5 shrink-0" />
          </Button>
        </aside>
      )}

      <Dialog open={isConfirmModalOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-md">
          {bookingSuccess ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-center text-2xl">{demoMode ? "Reserva de ejemplo completada" : successTitle}</DialogTitle>
                <div className="flex justify-center py-4">
                  <PartyPopper className="h-16 w-16 text-green-500" />
                </div>
                <DialogDescription className="text-center">
                  {demoMode ? "No se creó una reserva ni se envió un correo." : successDescription}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-col-reverse sm:flex-col-reverse gap-2">
                <div className="[&>button]:w-full [&>button]:sm:w-auto [&>button]:justify-center [&>button]:bg-accent [&>button:hover]:bg-accent/90 [&>button]:text-accent-foreground [&>button]:font-semibold">
                  <AddToCalendarButton
                    name={`${isSpaceReservation || isCanchaReservation ? 'Reserva' : 'Turno'} en ${businessData.name}`}
                    description={`${isSpaceReservation || isCanchaReservation ? 'Tu reserva' : 'Tu turno'} para ${selectedService?.name}. ¡Te esperamos!`}
                    startDate={selectedSlot ? format(selectedSlot.date, 'yyyy-MM-dd') : ''}
                    endDate={getCalendarEndDate()}
                    startTime={selectedSlot?.time || ''}
                    endTime={getCalendarEndTime()}
                    timeZone={businessTimeZone}
                    location={getFormattedAddress()}
                    options={['Google', 'Apple', 'iCal', 'Outlook.com', 'Yahoo']}
                    buttonStyle="custom"
                    customCss="data:text/css;base64,Q3VzdG9tIGJ1dHRvbiBzdHlsZXMK"
                    label="Añadir al Calendario"
                    listStyle="modal"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={resetBookingFlow} className="w-full">
                    {isSpaceReservation ? 'Reservar otro espacio' : isCanchaReservation ? 'Reservar otra cancha' : 'Agendar otro turno'}
                  </Button>
                  <Button onClick={resetBookingFlow} className="w-full">
                    Finalizar
                  </Button>
                </div>
              </DialogFooter>
            </>
          ) : (
            isRescheduleMode ? (
              <>
                <DialogHeader>
                  <DialogTitle>{isCanchaReservation ? 'Confirmar reprogramación de reserva' : 'Confirmar Reprogramación'}</DialogTitle>
                  <DialogDescription>
                    {isCanchaReservation
                      ? 'Estás a punto de cambiar tu reserva. ¿Deseas confirmar la nueva fecha y hora?'
                      : 'Estás a punto de cambiar tu turno. ¿Deseas confirmar la nueva fecha y hora?'}
                  </DialogDescription>
                </DialogHeader>
                <Card className="bg-secondary/50">
                  <CardContent className="p-4 text-sm space-y-1">
                    <p><strong>{isSpaceReservation ? 'Espacio:' : isCanchaReservation ? 'Cancha:' : 'Servicio:'}</strong> {selectedService?.name}</p>
                    <p className="flex items-center gap-2"><CalendarIcon className="h-4 w-4"/> {selectedSlot ? format(selectedSlot.date, "PPP", { locale: es }) : ''}</p>
                    <p className="flex items-center gap-2"><Clock className="h-4 w-4"/> {selectedSlot?.time}</p>
                  </CardContent>
                </Card>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsConfirmModalOpen(false)} disabled={isBooking}>
                    Cancelar
                  </Button>
                  <Button onClick={handleRescheduleBooking} disabled={isBooking}>
                    {isBooking ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    Sí, Confirmar
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>{demoMode ? "Probá la confirmación de ejemplo" : "Casi listo, confirma tus datos"}</DialogTitle>
                  <DialogDescription>
                    {demoMode ? 'Usamos un cliente ficticio: no tenés que ingresar datos. Simulá la confirmación; no se guarda una reserva ni se envían mensajes.' : 'Necesitamos tu nombre, WhatsApp y email para finalizar la reserva y enviarte el enlace de gestión.'}
                  </DialogDescription>
                </DialogHeader>
                {bookingError && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{bookingError}</p>}
                {demoMode ? <Button onClick={() => handleConfirmBooking({ name: "Cliente de ejemplo", phone: "1100000000", email: "cliente@example.invalid" })}>Simular confirmación</Button> : <AppointmentForm
                  context="clientBooking"
                  isBooking={isBooking}
                  onConfirmBooking={handleConfirmBooking}
                  bookingData={{
                    service: selectedService,
                    resourceType: selectedSpace ? 'space' : selectedCancha ? 'cancha' : 'service',
                    date: selectedSlot?.date,
                    slot: selectedSlot?.time || null
                  }}
                />}
              </>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
