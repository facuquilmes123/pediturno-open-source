
"use client";

import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { es } from 'date-fns/locale';
import { isSameDay, addDays } from "date-fns";
import { Loader2, DownloadCloud, CalendarIcon, ClockIcon, PlusCircle, Trash2 } from "lucide-react";
import { validateReservableWorkingHours } from '@/lib/cancha-validation';
import { useToast } from "@/hooks/use-toast";
import HolidaysModal, { Holiday } from "@/components/HolidaysModal";
import { Service, Cancha, WorkingHours } from '@/services/data';
import { ScrollArea } from './ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from './ui/switch';
import { Timestamp } from 'firebase/firestore';

const weekDays = [
    { id: 'Domingo', label: 'D', dayIndex: 0 },
    { id: 'Lunes', label: 'L', dayIndex: 1 },
    { id: 'Martes', label: 'M', dayIndex: 2 },
    { id: 'Miércoles', label: 'X', dayIndex: 3 },
    { id: 'Jueves', label: 'J', dayIndex: 4 },
    { id: 'Viernes', label: 'V', dayIndex: 5 },
    { id: 'Sábado', label: 'S', dayIndex: 6 },
];

interface AvailabilitySettingsModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    service?: Service | null;
    cancha?: Cancha | null;
    onSave: (id: string, data: { workingHours?: WorkingHours, unavailableDates?: Date[] }) => Promise<void>;
    defaultTab?: 'weekly' | 'blocked';
}

export default function AvailabilitySettingsModal({ isOpen, onOpenChange, service, cancha, onSave, defaultTab = 'weekly' }: AvailabilitySettingsModalProps) {
    const { toast } = useToast();
    const target = service || cancha;

    const [unavailableDates, setUnavailableDates] = useState<Date[]>([]);
    const [workingHours, setWorkingHours] = useState<WorkingHours>({});
    const [openDays, setOpenDays] = useState<string[]>([]);

    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingHolidays, setIsFetchingHolidays] = useState(false);
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [isHolidaysModalOpen, setIsHolidaysModalOpen] = useState(false);

    useEffect(() => {
        if (isOpen && target) {
            const dates = target.unavailableDates?.map((d: Date | Timestamp) => d instanceof Timestamp ? d.toDate() : d) || [];
            setUnavailableDates(dates);
            
            const initialWorkingHours: WorkingHours = {};
            if (target.workingHours) {
                Object.entries(target.workingHours).forEach(([day, value]: [string, any]) => {
                    const dayIndex = parseInt(day, 10);
                     if (value && value.slots) {
                        initialWorkingHours[dayIndex] = {
                            slots: value.slots,
                            isAlternating: value.isAlternating || false
                        };
                    } else if (Array.isArray(value)) {
                        initialWorkingHours[dayIndex] = {
                            slots: value,
                            isAlternating: false
                        };
                    }
                });
            }
            setWorkingHours(initialWorkingHours);
            setOpenDays([]);
        }
    }, [isOpen, target]);

     const handleDayToggle = (dayId: string, dayIndex: number, checked: boolean) => {
        setWorkingHours(prev => {
            const newWorkingHours = { ...prev };
            if (checked) {
                if (!newWorkingHours[dayIndex] || newWorkingHours[dayIndex].slots.length === 0) {
                     newWorkingHours[dayIndex] = { slots: [{ start: '09:00', end: '18:00' }], isAlternating: false };
                }
            } else {
                delete newWorkingHours[dayIndex];
            }
            return newWorkingHours;
        });
        setOpenDays(prev => checked
            ? (prev.includes(dayId) ? prev : [...prev, dayId])
            : prev.filter(openDay => openDay !== dayId));
    };
    
    const handleAlternatingToggle = (dayIndex: number, checked: boolean) => {
        setWorkingHours(prev => {
            const newWorkingHours = { ...prev };
            if (newWorkingHours[dayIndex]) {
                newWorkingHours[dayIndex] = { ...newWorkingHours[dayIndex], isAlternating: checked };
            }
            return newWorkingHours;
        });
    }

    const handleAddTimeSlot = (dayIndex: number) => {
        setWorkingHours(prev => {
            const dayConfig = prev[dayIndex] ? {...prev[dayIndex]} : { slots: [], isAlternating: false };
            if (dayConfig.slots.length < 2) {
                dayConfig.slots.push({ start: '16:00', end: '20:00' });
            }
            return { ...prev, [dayIndex]: dayConfig };
        });
    };
    
    const handleRemoveTimeSlot = (dayIndex: number, slotIndex: number) => {
        setWorkingHours(prev => {
            const dayConfig = { ...(prev[dayIndex] || { slots: [] }) };
            dayConfig.slots.splice(slotIndex, 1);
             if (dayConfig.slots.length === 0) {
                 const newWorkingHours = { ...prev };
                 delete newWorkingHours[dayIndex];
                 return newWorkingHours;
            }
            return { ...prev, [dayIndex]: dayConfig };
        });
    };

    const handleWorkingHoursChange = useCallback((dayIndex: number, slotIndex: number, type: 'start' | 'end', value: string) => {
        setWorkingHours(prev => {
            const dayConfig = { ...(prev[dayIndex] || { slots: [] }) };
            dayConfig.slots[slotIndex] = { ...dayConfig.slots[slotIndex], [type]: value };
            return { ...prev, [dayIndex]: dayConfig };
        });
    }, []);


    const handleFetchHolidays = async () => {
        setIsFetchingHolidays(true);
        try {
            const response = await fetch('https://api.argentinadatos.com/v1/feriados');
            const holidaysData = await response.json();
            const formattedHolidays = holidaysData.map((h: any) => ({
                id: h.fecha,
                date: addDays(new Date(h.fecha), 1),
                name: h.nombre,
            }));
            setHolidays(formattedHolidays);
            setIsHolidaysModalOpen(true);
        } catch (error) {
            console.error("Failed to fetch holidays:", error);
            toast({ variant: "destructive", title: "Error", description: "No se pudieron importar los feriados." });
        } finally {
            setIsFetchingHolidays(false);
        }
    };

    const handleAddHolidays = (selectedHolidays: Date[]) => {
        const currentDates = unavailableDates || [];
        const newDates = selectedHolidays.filter(hd => !currentDates.some(ud => isSameDay(ud, hd)));
        setUnavailableDates([...currentDates, ...newDates]);
        toast({
            title: "Feriados importados",
            description: `${newDates.length} nuevos feriados se agregaron a tus días no disponibles.`,
        });
        setIsHolidaysModalOpen(false);
    };

    const handleSaveAvailability = async () => {
        if (!target) return;
        const validationError = validateReservableWorkingHours(workingHours, target?.duration);
        if (validationError) {
            toast({ variant: 'destructive', title: 'Revisá los horarios', description: validationError });
            return;
        }
        setIsSaving(true);
        try {
            await onSave(target.id, { workingHours, unavailableDates });
        } finally {
            setIsSaving(false);
        }
    };

    const title = target ? `Disponibilidad para "${target.name}"` : "Disponibilidad";
    const availabilityMissing = validateReservableWorkingHours(workingHours, target?.duration);
    const description = "Define tus días y horas de trabajo específicas. Si no defines nada, no estará disponible para reservar.";

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onOpenChange}>
                <DialogContent className="max-w-md md:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                        <DialogDescription>{description}</DialogDescription>
                    </DialogHeader>
                    
                    <div role="status" aria-live="polite" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                        {availabilityMissing || (target?.status === 'Pausado' ? 'Los horarios son válidos. Después de guardarlos, activá el recurso desde su tarjeta para completar este paso.' : 'Los horarios son válidos y el recurso está activo.')}
                    </div>
                    <Tabs defaultValue={defaultTab} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="weekly">
                                <ClockIcon className="mr-2 h-4 w-4"/>
                                Horario Semanal
                            </TabsTrigger>
                            <TabsTrigger value="blocked">
                                <CalendarIcon className="mr-2 h-4 w-4"/>
                                Fechas Bloq.
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="weekly">
                           <ScrollArea className="h-80 pr-3">
                             <Accordion type="multiple" value={openDays} onValueChange={setOpenDays} className="w-full">
                                {weekDays.map(({ id, dayIndex }) => {
                                    const dayConfig = workingHours[dayIndex];
                                    const daySlots = dayConfig?.slots || [];
                                    const isDayActive = daySlots.length > 0;
                                    const isAlternating = dayConfig?.isAlternating || false;

                                    return (
                                        <AccordionItem value={id} key={id} className="border-b">
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-2 py-3">
                                                    <Checkbox 
                                                        id={`available-${id}`}
                                                        checked={isDayActive}
                                                        onCheckedChange={(checked) => handleDayToggle(id, dayIndex, !!checked)}
                                                        />
                                                    <Label htmlFor={`available-${id}`} className="cursor-pointer whitespace-nowrap text-base font-medium">{id}</Label>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <AccordionTrigger className="py-3 hover:no-underline">
                                                        <span className="text-sm font-normal text-muted-foreground">
                                                            {isDayActive ? `${daySlots.length} ${daySlots.length === 1 ? 'turno' : 'turnos'}` : 'Configurar horarios'}
                                                            <span className="sr-only"> de {id}</span>
                                                        </span>
                                                    </AccordionTrigger>
                                                </div>
                                            </div>
                                            <AccordionContent>
                                                <div className="space-y-4 pt-2 pb-4">
                                                    <div className="flex items-center space-x-2 rounded-lg bg-secondary/50 p-3">
                                                        <Switch 
                                                            id={`alternating-${id}`} 
                                                            checked={isAlternating}
                                                            onCheckedChange={(checked) => handleAlternatingToggle(dayIndex, checked)}
                                                            disabled={!isDayActive}
                                                        />
                                                        <Label htmlFor={`alternating-${id}`}>Día alternado (ej: una semana sí, una no)</Label>
                                                    </div>
                                                {daySlots.map((slot, slotIndex) => (
                                                    <div key={slotIndex} className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                                                        <div className="grid gap-1.5">
                                                            <Label htmlFor={`start-${id}-${slotIndex}`} className="text-xs">Desde</Label>
                                                            <Input 
                                                                id={`start-${id}-${slotIndex}`}
                                                                type="time" 
                                                                value={slot.start}
                                                                onChange={(e) => handleWorkingHoursChange(dayIndex, slotIndex, 'start', e.target.value)}
                                                                disabled={!isDayActive}
                                                            />
                                                        </div>
                                                        <div className="flex items-end gap-2">
                                                            <div className="grid gap-1.5 flex-grow">
                                                                <Label htmlFor={`end-${id}-${slotIndex}`} className="text-xs">Hasta</Label>
                                                                <Input 
                                                                    id={`end-${id}-${slotIndex}`}
                                                                    type="time" 
                                                                    value={slot.end}
                                                                    onChange={(e) => handleWorkingHoursChange(dayIndex, slotIndex, 'end', e.target.value)}
                                                                    disabled={!isDayActive}
                                                                />
                                                            </div>
                                                            {slotIndex > 0 && (
                                                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Eliminar segundo turno de ${id}`} onClick={() => handleRemoveTimeSlot(dayIndex, slotIndex)}>
                                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                {daySlots.length < 2 && isDayActive && (
                                                    <Button type="button" variant="outline" size="sm" onClick={() => handleAddTimeSlot(dayIndex)}>
                                                        <PlusCircle className="mr-2 h-4 w-4"/>
                                                        Añadir segundo turno
                                                    </Button>
                                                )}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    )
                                })}
                            </Accordion>
                           </ScrollArea>
                        </TabsContent>
                        <TabsContent value="blocked">
                             <div className="space-y-4 pt-2">
                                <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={handleFetchHolidays}
                                    disabled={isFetchingHolidays}
                                    className="w-full"
                                >
                                    {isFetchingHolidays ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />}
                                    Volcar Feriados Nacionales
                                </Button>
                                <div className="rounded-md border">
                                    <Calendar
                                        mode="multiple"
                                        locale={es}
                                        selected={unavailableDates}
                                        onSelect={(dates) => setUnavailableDates(dates || [])}
                                    />
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                    
                    <DialogFooter className="pt-4">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancelar</Button>
                        <Button onClick={handleSaveAvailability} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar Disponibilidad
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <HolidaysModal
                isOpen={isHolidaysModalOpen}
                onOpenChange={setIsHolidaysModalOpen}
                holidays={holidays}
                onConfirm={handleAddHolidays}
            />
        </>
    );
}
