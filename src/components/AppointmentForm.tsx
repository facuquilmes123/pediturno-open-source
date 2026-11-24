
"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, User, Mail, Phone, Calendar as CalendarIcon, Clock, CheckCircle, Search, UserPlus } from "lucide-react";
import { Service, Appointment, Client } from "@/services/data";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import InputWithIcon from "./ui/InputWithIcon";
import PhoneInput from "./ui/PhoneInput";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Calendar } from "./ui/calendar";
import { format, startOfToday, set, addMinutes, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandInput, CommandGroup, CommandItem } from "@/components/ui/command";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Label } from "./ui/label";

const CLIENT_DATA_KEY = 'pediturno-client-data';

const phoneRegex = new RegExp(/^\+?\d{10,}$/);

const formSchema = z.object({
    name: z.string().min(3, { message: "El nombre debe tener al menos 3 caracteres." }),
    phone: z.string().regex(phoneRegex, { message: "Número de teléfono inválido." }),
    email: z.string().email({ message: "Formato de email incorrecto." }).optional().or(z.literal('')),
    serviceId: z.string().optional(),
    date: z.date().optional(),
    time: z.string().optional(),
});

type AppointmentFormValues = z.infer<typeof formSchema>;

interface AppointmentFormProps {
    isBooking: boolean;
    onConfirmBooking: (clientData: { name: string; phone: string; email: string }, serviceId: string, date: Date, time: string, existingClientId?: string) => void;
    onCancel?: () => void;
    context: 'clientBooking' | 'adminCreation';
    // For admin creation
    services?: Service[];
    allAppointments?: Appointment[];
    clients?: Client[];
    // For client booking
    bookingData?: {
        service: Service | null;
        date: Date | undefined;
        slot: string | null;
        resourceType?: 'service' | 'cancha' | 'space';
    }
}

export default function AppointmentForm({
    isBooking,
    onConfirmBooking,
    onCancel,
    context,
    services = [],
    allAppointments = [],
    clients = [],
    bookingData = { service: null, date: undefined, slot: null },
}: AppointmentFormProps) {
    const { toast } = useToast();
    const [clientType, setClientType] = useState<'existing' | 'new'>('existing');
    const [selectedClientId, setSelectedClientId] = useState<string | undefined>(undefined);
     const [isClientPopoverOpen, setIsClientPopoverOpen] = useState(false);
    
    const form = useForm<AppointmentFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            phone: "",
            email: "",
            serviceId: '',
            date: new Date(),
            time: '',
        },
    });

     useEffect(() => {
        if (context === 'clientBooking') {
            try {
                const savedData = localStorage.getItem(CLIENT_DATA_KEY);
                if (savedData) {
                    const { name, phone, email } = JSON.parse(savedData);
                    form.reset({
                        name: name || "",
                        phone: phone || "",
                        email: email || "",
                    });
                }
            } catch (error) {
                console.error("Failed to load client data from localStorage", error);
            }
        }
    }, [form, context]);

    const serviceId = form.watch('serviceId');
    const date = form.watch('date');
    const time = form.watch('time');
    const isCanchaBooking = context === 'clientBooking' && bookingData.resourceType === 'cancha';
    const isSpaceBooking = context === 'clientBooking' && bookingData.resourceType === 'space';
    
    const isSlotAvailable = useMemo(() => {
        if (context !== 'adminCreation' || !serviceId || !date || !time || !allAppointments || !services) {
            return true;
        }
        
        const currentService = services.find(s => s.id === serviceId);
        if (!currentService) return true;

        const serviceDuration = parseInt(currentService.duration, 10);
        const newApptStart = set(date, { 
            hours: parseInt(time.split(':')[0], 10), 
            minutes: parseInt(time.split(':')[1], 10),
            seconds: 0,
            milliseconds: 0
        });
        const newApptEnd = addMinutes(newApptStart, serviceDuration);

        return !allAppointments.some(existingAppt => {
            if (!isSameDay(existingAppt.date, date) || existingAppt.status === 'Cancelado') {
                return false;
            }
            
            const existingService = services.find(s => s.name === existingAppt.service);
            const existingDuration = existingService ? parseInt(existingService.duration, 10) : 30;
            
            const existingApptStart = set(existingAppt.date, { 
                hours: parseInt(existingAppt.time.split(':')[0], 10), 
                minutes: parseInt(existingAppt.time.split(':')[1], 10),
                seconds: 0,
                milliseconds: 0
            });
            const existingApptEnd = addMinutes(existingApptStart, existingDuration);

            return newApptStart < existingApptEnd && newApptEnd > existingApptStart;
        });
    }, [context, serviceId, date, time, allAppointments, services]);


    const handleConfirm = (values: AppointmentFormValues) => {
        const clientEmail = values.email || '';
        
        if (context === 'clientBooking') {
            if (!clientEmail.trim()) {
                form.setError('email', {
                    type: 'manual',
                    message: 'El email es obligatorio para recibir y gestionar tu reserva.',
                });
                return;
            }
            try {
                localStorage.setItem(CLIENT_DATA_KEY, JSON.stringify({ name: values.name, phone: values.phone, email: clientEmail }));
            } catch (error) {
                console.error("Failed to save client data to localStorage", error);
            }

            if (!bookingData.service || !bookingData.date || !bookingData.slot) {
                 toast({ variant: 'destructive', title: 'Error', description: 'Faltan datos de la reserva.' });
                 return;
            }
            onConfirmBooking({ ...values, email: clientEmail }, bookingData.service.id, bookingData.date, bookingData.slot);
        } else { // adminCreation
             if (!isSlotAvailable) {
                toast({ variant: 'destructive', title: 'Horario no disponible', description: 'El horario seleccionado se superpone con otro turno.' });
                return;
            }
            onConfirmBooking({ ...values, email: clientEmail }, values.serviceId!, values.date!, values.time!, selectedClientId);
        }
    };
    
    const isClientBooking = context === 'clientBooking';
    const isAdminCreation = context === 'adminCreation';

    const selectedService = isClientBooking ? bookingData.service : services.find(s => s.id === serviceId);
    const selectedDate = isClientBooking ? bookingData.date : date;
    const selectedSlot = isClientBooking ? bookingData.slot : time;

    const isConfirmDisabled = isBooking || (isAdminCreation && (!serviceId || !date || !time || !isSlotAvailable));
    
    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleConfirm)} className="grid gap-4 py-4">

                {isAdminCreation && (
                    <RadioGroup value={clientType} onValueChange={(value) => {
                        setClientType(value as 'existing' | 'new');
                        setSelectedClientId(undefined);
                        form.reset({ serviceId, date, time, name: '', phone: '', email: '' });
                    }} className="grid grid-cols-2 gap-4">
                        <div>
                            <RadioGroupItem value="existing" id="r1" className="peer sr-only" />
                            <Label htmlFor="r1" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                <Search className="mb-3 h-6 w-6" />
                                Cliente Existente
                            </Label>
                        </div>
                        <div>
                            <RadioGroupItem value="new" id="r2" className="peer sr-only" />
                            <Label htmlFor="r2" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary">
                                <UserPlus className="mb-3 h-6 w-6" />
                                Cliente Nuevo
                            </Label>
                        </div>
                    </RadioGroup>
                )}


                {isAdminCreation && clientType === 'existing' ? (
                     <Popover open={isClientPopoverOpen} onOpenChange={setIsClientPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="w-full justify-between">
                                {selectedClientId ? clients.find(c => c.id === selectedClientId)?.name : "Seleccionar cliente"}
                                <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                                <CommandInput placeholder="Buscar cliente..." />
                                <CommandEmpty>No se encontró ningún cliente.</CommandEmpty>
                                <CommandGroup>
                                {clients.map((client) => (
                                    <CommandItem
                                        key={client.id}
                                        value={client.name}
                                        onSelect={() => {
                                            setSelectedClientId(client.id);
                                            form.setValue('name', client.name);
                                            form.setValue('phone', client.phone);
                                            form.setValue('email', client.email || '');
                                            setIsClientPopoverOpen(false);
                                        }}
                                    >
                                        <CheckCircle className={cn("mr-2 h-4 w-4", selectedClientId === client.id ? "opacity-100" : "opacity-0")} />
                                        {client.name}
                                    </CommandItem>
                                ))}
                                </CommandGroup>
                            </Command>
                        </PopoverContent>
                    </Popover>
                ) : null}

                {(clientType === 'new' || isClientBooking) && (
                     <>
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nombre y Apellido</FormLabel>
                                    <FormControl>
                                        <InputWithIcon icon={User} placeholder="Nombre completo del cliente" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Nº de WhatsApp</FormLabel>
                                    <FormControl>
                                       <PhoneInput id="clientPhone" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="email"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Email del cliente{isClientBooking ? ' (obligatorio)' : ''}</FormLabel>
                                    <FormControl>
                                        <InputWithIcon 
                                            icon={Mail}
                                            type="email"
                                            placeholder="cliente@email.com" 
                                            aria-required={isClientBooking}
                                            {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                     </>
                )}


                 {isAdminCreation && (
                    <>
                        <FormField
                            control={form.control}
                            name="serviceId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Servicio</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger><SelectValue placeholder="Seleccionar servicio" /></SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {services?.map(service => (
                                            <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="date"
                                render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Fecha</FormLabel>
                                    <Popover>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                        <Button
                                            variant={"outline"}
                                            className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
                                        >
                                            {field.value ? (format(field.value, "PPP", { locale: es })) : (<span>Elige una fecha</span>)}
                                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                        </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={field.value}
                                            onSelect={field.onChange}
                                            disabled={(date) => date < startOfToday()}
                                            initialFocus
                                            locale={es}
                                        />
                                    </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="time"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Hora</FormLabel>
                                    <FormControl>
                                    <Input type="time" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                        </div>
                        {!isSlotAvailable && date && time && (
                            <p className="text-sm text-destructive text-center">Este horario se superpone con otro turno existente.</p>
                        )}
                    </>
                )}

                {isClientBooking && selectedDate && selectedSlot && selectedService && (
                <Card className="bg-secondary/50">
                    <CardContent className="p-4 text-sm space-y-1">
                        <p><strong>{isSpaceBooking ? 'Espacio:' : isCanchaBooking ? 'Cancha:' : 'Servicio:'}</strong> {selectedService?.name}</p>
                        <p className="flex items-center gap-2"><CalendarIcon className="h-4 w-4"/> {selectedDate?.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                        <p className="flex items-center gap-2"><Clock className="h-4 w-4"/> {selectedSlot}</p>
                    </CardContent>
                </Card>
                )}
                
                <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
                    {onCancel && <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={onCancel} disabled={isBooking}>Cancelar</Button>}
                    <Button type="submit" disabled={isConfirmDisabled} className="w-full sm:w-auto">
                        {isBooking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isAdminCreation ? 'Agendar Turno' : 'Confirmar Reserva'}
                    </Button>
                </div>
            </form>
        </Form>
    );
}

    

    
