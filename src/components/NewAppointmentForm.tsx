

"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, User, Mail, Phone, CheckCircle, AlertCircle, Calendar as CalendarIcon } from "lucide-react";
import { Cancha, Appointment, Space } from "@/services/data";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { es } from 'date-fns/locale';
import { format, startOfToday, set, addMinutes, isSameDay } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InputWithIcon from "./ui/InputWithIcon";
import PhoneInput from "./ui/PhoneInput";


const PHONE_REGEX = /^\+?\d{10,}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isCanchaSlotAvailable({
    canchaId,
    date,
    time,
    canchas,
    appointments,
}: {
    canchaId: string;
    date: Date;
    time: string;
    canchas: Cancha[];
    appointments: Appointment[];
}) {
    const currentCancha = canchas.find(item => item.id === canchaId);
    if (!currentCancha) return false;

    const canchaDuration = Number(currentCancha.duration);
    const [hours, timeMinutes] = time.split(':').map(Number);
    if (!Number.isInteger(canchaDuration) || canchaDuration <= 0 || !Number.isInteger(hours) || !Number.isInteger(timeMinutes)) return false;

    const newApptStart = set(date, { hours, minutes: timeMinutes, seconds: 0, milliseconds: 0 });
    const newApptEnd = addMinutes(newApptStart, canchaDuration);

    return !appointments.some(existingAppt => {
        if (!isSameDay(existingAppt.date, date) || existingAppt.status === 'Cancelado') return false;
        const isSameCancha = existingAppt.canchaId === canchaId ||
            (!existingAppt.canchaId && existingAppt.cancha === currentCancha.name);
        if (!isSameCancha) return false;

        const existingDuration = Number(existingAppt.durationMinutes) || canchaDuration;
        const [existingHours, existingMinutes] = existingAppt.time.split(':').map(Number);
        const existingApptStart = set(existingAppt.date, {
            hours: existingHours,
            minutes: existingMinutes,
            seconds: 0,
            milliseconds: 0,
        });
        const existingApptEnd = addMinutes(existingApptStart, existingDuration);
        return newApptStart < existingApptEnd && newApptEnd > existingApptStart;
    });
}

export function isSpaceSlotAvailable({ spaceId, durationMinutes, date, time, spaces, appointments, businessBufferMinutes = 0 }: {
    spaceId: string; durationMinutes: number; date: Date; time: string; spaces: Space[]; appointments: Appointment[]; businessBufferMinutes?: number;
}) {
    const space = spaces.find((item) => item.id === spaceId);
    if (!space || !space.packages.some((item) => item.durationMinutes === durationMinutes)) return false;
    const [hours, minutes] = time.split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes % 10 !== 0) return false;
    const eventStart = set(date, { hours, minutes, seconds: 0, milliseconds: 0 });
    const buffer = space.bookingBufferMinutes ?? businessBufferMinutes;
    const protectedStart = addMinutes(eventStart, -space.preparationMinutes);
    const protectedEnd = addMinutes(eventStart, durationMinutes + space.cleanupMinutes + buffer);
    return !appointments.some((appointment) => {
        const sameSpace = appointment.spaceId === spaceId || (!appointment.spaceId && appointment.space === space.name);
        if (!sameSpace || appointment.status === 'Cancelado') return false;
        const occupiedStart = appointment.occupiedStartAt ? new Date(appointment.occupiedStartAt) : null;
        const occupiedEnd = appointment.occupiedEndAt ? new Date(appointment.occupiedEndAt) : null;
        if (occupiedStart && occupiedEnd && Number.isFinite(occupiedStart.getTime()) && Number.isFinite(occupiedEnd.getTime())) {
            return protectedStart < occupiedEnd && protectedEnd > occupiedStart;
        }
        const [existingHour, existingMinute] = appointment.time.split(':').map(Number);
        const existingStart = set(new Date(appointment.date), { hours: existingHour, minutes: existingMinute, seconds: 0, milliseconds: 0 });
        const existingProtectedStart = addMinutes(existingStart, -(appointment.preparationMinutesAtBooking ?? appointment.preparationMinutes ?? space.preparationMinutes));
        const existingProtectedEnd = addMinutes(existingStart, (appointment.durationMinutes || durationMinutes) + (appointment.cleanupMinutesAtBooking ?? appointment.cleanupMinutes ?? space.cleanupMinutes) + (appointment.bookingBufferMinutesAtBooking ?? appointment.bookingBufferMinutes ?? buffer));
        return protectedStart < existingProtectedEnd && protectedEnd > existingProtectedStart;
    });
}

interface NewAppointmentFormProps {
    isBooking: boolean;
    onConfirmBooking: (clientData: { name: string; phone: string; email: string }, resourceId: string, date: Date, time: string, durationMinutes?: number) => void;
    onCancel?: () => void;
    canchas: Cancha[];
    spaces?: Space[];
    resourceType?: 'cancha' | 'space';
    businessBufferMinutes?: number;
    allAppointments: Appointment[];
}

export default function NewAppointmentForm({
    isBooking,
    onConfirmBooking,
    onCancel,
    canchas,
    spaces = [],
    resourceType = 'cancha',
    businessBufferMinutes = 0,
    allAppointments,
}: NewAppointmentFormProps) {
    const { toast } = useToast();

    const [clientName, setClientName] = useState("");
    const [clientEmail, setClientEmail] = useState("");
    const [clientPhone, setClientPhone] = useState("");
    
    const [resourceId, setResourceId] = useState('');
    const [durationMinutes, setDurationMinutes] = useState('');
    const [date, setDate] = useState<Date | undefined>(undefined);
    const [time, setTime] = useState('');

    useEffect(() => {
        // Set initial date only on client-side to prevent hydration mismatch
        setDate(new Date());
    }, []);

    const isPhoneValid = useMemo(() => PHONE_REGEX.test(clientPhone.replace(/\s/g, '')), [clientPhone]);
    const isEmailValid = useMemo(() => !clientEmail || EMAIL_REGEX.test(clientEmail), [clientEmail]);

    const isSlotAvailable = useMemo(() => {
        if (!resourceId || !date || !time || !allAppointments) {
            return true;
        }
        if (resourceType === 'space') {
            return !!durationMinutes && isSpaceSlotAvailable({ spaceId: resourceId, durationMinutes: Number(durationMinutes), date, time, spaces, appointments: allAppointments, businessBufferMinutes });
        }
        return isCanchaSlotAvailable({
            canchaId: resourceId,
            date,
            time,
            canchas,
            appointments: allAppointments,
        });
    }, [resourceId, durationMinutes, date, time, allAppointments, canchas, spaces, resourceType, businessBufferMinutes]);


    const handleConfirm = () => {
        if (!clientName || !clientPhone || !clientEmail || !date || !time || !resourceId || (resourceType === 'space' && !durationMinutes)) {
             toast({ variant: 'destructive', title: 'Faltan datos', description: 'Por favor, completa todos los campos.' });
             return;
         }
        if (!isPhoneValid || !isEmailValid) {
            toast({ variant: 'destructive', title: 'Datos inválidos', description: 'Por favor, revisa el formato del teléfono y el correo.' });
            return;
        }
         if (!isSlotAvailable) {
             toast({ variant: 'destructive', title: 'Horario no disponible', description: `El horario se superpone con otra reserva de ${resourceType === 'space' ? 'este espacio' : 'esta cancha'}.` });
            return;
         }

        onConfirmBooking({ name: clientName, phone: clientPhone, email: clientEmail }, resourceId, date, time, resourceType === 'space' ? Number(durationMinutes) : undefined);
    };

    const isConfirmDisabled = isBooking || !clientName || !clientPhone || !isPhoneValid || !clientEmail || !isEmailValid || !resourceId || (resourceType === 'space' && !durationMinutes) || !date || !time || !isSlotAvailable;
    
    return (
        <div className="grid gap-4 py-4">
            <div className="grid gap-2">
                <Label htmlFor="client-name">Cliente</Label>
                <InputWithIcon icon={User} id="client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre y Apellido"/>
            </div>
            <div className="grid gap-2">
                <Label htmlFor="resource">{resourceType === 'space' ? 'Espacio' : 'Cancha'}</Label>
                <Select value={resourceId} onValueChange={(value) => { setResourceId(value); setDurationMinutes(''); }}>
                    <SelectTrigger id="resource">
                        <SelectValue placeholder={resourceType === 'space' ? 'Seleccionar espacio' : 'Seleccionar cancha'} />
                    </SelectTrigger>
                    <SelectContent>
                        {(resourceType === 'space' ? spaces : canchas).map((resource) => <SelectItem key={resource.id} value={resource.id}>{resource.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            {resourceType === 'space' && resourceId && <div className="grid gap-2"><Label htmlFor="space-package">Duración</Label><Select value={durationMinutes} onValueChange={setDurationMinutes}><SelectTrigger id="space-package"><SelectValue placeholder="Seleccionar paquete" /></SelectTrigger><SelectContent>{spaces.find((space) => space.id === resourceId)?.packages.map((item) => <SelectItem key={item.durationMinutes} value={String(item.durationMinutes)}>{item.durationMinutes === 1440 ? 'Jornada completa' : `${item.durationMinutes / 60} horas`} · $ {item.price}</SelectItem>)}</SelectContent></Select></div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="date">Fecha</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={cn("justify-start text-left font-normal", !date && "text-muted-foreground")}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {date ? format(date, "PPP", { locale: es }) : <span>Elige una fecha</span>}
                        </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={date}
                            onSelect={(d) => setDate(d || undefined)}
                            initialFocus
                            locale={es}
                            disabled={(d) => d < startOfToday()}
                        />
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="time">Hora</Label>
                    <Input id="time" type="time" step={resourceType === 'space' ? 600 : 60} value={time} onChange={(e) => setTime(e.target.value)} />
                    {resourceType === 'space' && <p className="text-xs text-muted-foreground">Elegí una hora en intervalos de 10 minutos.</p>}
                </div>
            </div>
            {!isSlotAvailable && date && time && (
                <p className="text-sm text-destructive text-center">Este horario se superpone con otra reserva {resourceType === 'space' ? 'del espacio seleccionado' : 'de la cancha seleccionada'}.</p>
            )}
            <div className="grid gap-2">
                <Label htmlFor="clientPhone">Nº de WhatsApp</Label>
                <PhoneInput value={clientPhone} onChange={setClientPhone} />
                    {!isPhoneValid && clientPhone && (
                        <p className="text-xs text-destructive">Formato incorrecto. Incluye el código de país y el número.</p>
                    )}
            </div>
            <div className="grid gap-2">
                    <Label htmlFor="email">Email para notificaciones</Label>
                    <InputWithIcon 
                    icon={Mail}
                    id="email"
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="tu@email.com (obligatorio)"
                    error={!isEmailValid && !!clientEmail}
                    suffix={clientEmail ? (isEmailValid ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-destructive" />) : null}
                />
                    {!isEmailValid && clientEmail && (
                    <p className="text-xs text-destructive">Email inválido.</p>
                )}
                    {!clientEmail && (
                        <p className="text-xs text-muted-foreground">El email es requerido para recibir confirmaciones.</p>
                    )}
            </div>

            <div className={cn("flex gap-2 pt-2", onCancel ? "flex-col sm:flex-row sm:justify-end" : "justify-center")}>
                {onCancel && <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onCancel} disabled={isBooking}>Cancelar</Button>}
                <Button onClick={handleConfirm} disabled={isConfirmDisabled} className="w-full sm:w-auto">
                    {isBooking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Agendar Reserva
                </Button>
            </div>
        </div>
    );
}
