
"use client"
import { useState, useEffect, useCallback } from "react"
import jsPDF from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Appointment, updateAppointmentStatus, BusinessProfile, onAppointmentsUpdate, getBusinessProfile } from "@/services/data"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuthRedirect"
import { es } from 'date-fns/locale';
import { isSameDay, format, isBefore, startOfToday, subDays, addDays, isAfter, isToday } from 'date-fns';
import { CalendarIcon, ChevronRight, Mail, Loader2, CheckCircle, XCircle, Download, Bell } from 'lucide-react';
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useSearchParams } from 'next/navigation'
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"


export default function CalendarClientPage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const searchParams = useSearchParams()

  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);

  const [isActionAlertOpen, setIsActionAlertOpen] = useState(false);
  const [appointmentToAction, setAppointmentToAction] = useState<Appointment | null>(null);
  const [actionType, setActionType] = useState<'cancel' | 'complete' | null>(null);
  
  // Reminder Modal State
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [selectedAppointmentsForReminder, setSelectedAppointmentsForReminder] = useState<Set<string>>(new Set());
  const [isSendingReminders, setIsSendingReminders] = useState(false);

  const requestOwnerNotification = useCallback(async (appointmentId: string, kind: 'cancellation' | 'reminder') => {
    if (!user) throw new Error('Authentication required');
    const token = await user.getIdToken();
    const response = await fetch('/api/owner/appointments/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ appointmentId, kind }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'sent') throw new Error('Notification unavailable');
    return payload as { status: 'sent'; repeated: boolean };
  }, [user]);
  
  useEffect(() => {
    // Set initial date only on client-side to prevent hydration mismatch
    const dateParam = searchParams.get('date');
    if (dateParam) {
        const date = new Date(dateParam);
        if (!isNaN(date.getTime())) {
            setSelectedDate(date);
        } else {
            setSelectedDate(new Date());
        }
    } else {
        setSelectedDate(new Date());
    }
  }, [searchParams]);

  useEffect(() => {
    if (user && !authLoading) {
      setIsLoading(true);
      // Set up the real-time listener for updates.
      const unsubscribe = onAppointmentsUpdate(user.uid, (updatedAppointments) => {
        setAllAppointments(updatedAppointments.sort((a,b) => a.time.localeCompare(b.time)));
        setIsLoading(false);
      }, () => {
        setIsLoading(false);
        toast({ variant: 'destructive', title: 'No se pudo actualizar la agenda', description: 'Volvé a intentar en unos momentos.' });
      });
      
      // Fetch the business profile on client.
      getBusinessProfile(user.uid).then(setBusinessProfile).catch(() => { toast({ variant: 'destructive', title: 'No se pudo cargar el perfil' }); });

      return () => unsubscribe();
    } else if (!authLoading) {
        // Handle case where there is no user but auth is not loading anymore
        setIsLoading(false);
    }
  }, [user, authLoading, toast]);

  const handleExportPDF = async () => {
        if (!businessProfile || allAppointments.length === 0) {
            toast({ variant: 'destructive', title: 'No hay datos para exportar.' });
            return;
        }
        setIsExporting(true);

        const doc = new jsPDF();
        const tableData = allAppointments.map(appt => [
            format(appt.date, 'dd/MM/yyyy'),
            appt.time,
            appt.client,
            appt.service || appt.cancha || appt.space || '',
            appt.status,
        ]);

        // Add header
        if (businessProfile.logo && !businessProfile.logo.includes('placehold')) {
            try {
                const response = await fetch(businessProfile.logo);
                const blob = await response.blob();
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                await new Promise(resolve => reader.onload = resolve);
                const logoDataUrl = reader.result as string;
                doc.addImage(logoDataUrl, 'PNG', 15, 12, 20, 20);
            } catch (e) {
                 console.error("Could not load business logo for PDF", e);
            }
        }
        
        doc.setFontSize(20);
        doc.text(`Reporte de Turnos - ${businessProfile.name}`, 40, 25);
        doc.setFontSize(10);
        doc.text(`Generado el: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 15, 40);

        autoTable(doc, {
            startY: 45,
            head: [['Fecha', 'Hora', 'Cliente', 'Servicio', 'Estado']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [30, 30, 30] },
        });

        doc.save(`turnos-${businessProfile.slug || 'pediturno'}.pdf`);
        setIsExporting(false);
  };


  const handleUpdateStatus = async () => {
    if (!appointmentToAction || !appointmentToAction.id || !actionType) return;
    
    const newStatus = actionType === 'cancel' ? 'Cancelado' : 'Completado';
    const appointmentId = appointmentToAction.id;
    
    setIsUpdating(appointmentId);
    setIsActionAlertOpen(false);

    try {
      await updateAppointmentStatus(appointmentId, newStatus);
      toast({
        title: "¡Éxito!",
        description: `El turno ha sido marcado como ${newStatus.toLowerCase()}.`,
      });

      if (actionType === 'cancel' && appointmentToAction.clientEmail) {
          try {
            await requestOwnerNotification(appointmentId, 'cancellation');
            toast({ title: 'Correo enviado', description: 'La notificación de cancelación fue aceptada por el servicio de correo.' });
          } catch {
            toast({ variant: 'destructive', title: 'Turno cancelado', description: 'No se pudo entregar el correo de cancelación.' });
          }
      }

    } catch (error) {
      console.error(`Failed to ${actionType} appointment:`, error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo actualizar el estado del turno."
      });
    } finally {
      setIsUpdating(null);
      setAppointmentToAction(null);
      setActionType(null);
    }
  };
  
  const handleSendReminders = async () => {
        setIsSendingReminders(true);

        const appointmentsToSend = allAppointments.filter(appt => selectedAppointmentsForReminder.has(appt.id!));
        
        const promises = appointmentsToSend.map(appt => requestOwnerNotification(appt.id!, 'reminder'));
        
        try {
            const results = await Promise.allSettled(promises);
            const successfulCount = results.filter(r => r.status === 'fulfilled').length;

            if (successfulCount > 0) {
                toast({
                    title: '¡Recordatorios enviados!',
                    description: `Se enviaron ${successfulCount} de ${appointmentsToSend.length} recordatorios.`,
                });
            }

            const failedCount = appointmentsToSend.length - successfulCount;
            if (failedCount > 0) {
                toast({
                    variant: 'destructive',
                    title: 'Algunos recordatorios fallaron',
                    description: `No se pudieron enviar ${failedCount} recordatorios. Revisa la consola para más detalles.`,
                });
            }

            setIsReminderModalOpen(false);
            setSelectedAppointmentsForReminder(new Set());
        } catch (error) {
             console.error("Error sending reminders:", error);
        } finally {
            setIsSendingReminders(false);
        }
    };

  
  const openActionDialog = (appointment: Appointment, type: 'cancel' | 'complete') => {
    setAppointmentToAction(appointment);
    setActionType(type);
    setIsActionAlertOpen(true);
  };

  const appointmentsForSelectedDay = selectedDate
    ? allAppointments.filter(
        (appt) => isSameDay(appt.date, selectedDate as Date)
      )
    : []
  
   const daysWithAppointments = allAppointments.map(appt => appt.date);
   
   const getStatusStyles = (status: Appointment['status']) => {
        switch (status) {
            case 'Confirmado':
                return {
                    badge: 'default',
                    border: 'border-primary',
                    badgeClass: ''
                };
            case 'Pendiente':
                return {
                    badge: 'secondary',
                    border: 'border-yellow-500',
                    badgeClass: ''
                };
            case 'Completado':
                 return {
                    badge: 'default',
                    border: 'border-green-500',
                    badgeClass: 'bg-green-600 hover:bg-green-700'
                };
            case 'Cancelado':
                return {
                    badge: 'destructive',
                    border: 'border-destructive',
                    badgeClass: ''
                };
            default:
                return {
                    badge: 'outline',
                    border: 'border-border',
                    badgeClass: ''
                };
        }
    };
    
    const alertInfo = actionType === 'cancel' ? {
        title: "¿Estás seguro de cancelar?",
        description: `Esta acción no se puede deshacer. El turno para ${appointmentToAction?.client} será cancelado. Se enviará un correo de notificación al cliente si proveyó uno.`,
        buttonText: "Sí, cancelar turno",
        buttonClass: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    } : {
        title: "¿Marcar como completado?",
        description: `Esto marcará el turno de ${appointmentToAction?.client} como finalizado y ayudará a tus estadísticas.`,
        buttonText: "Sí, marcar completado",
        buttonClass: "bg-green-600 text-white hover:bg-green-700"
    }
    
    const today = startOfToday();
    const activeAppointmentsForReminder = allAppointments.filter(
        (appt) =>
            (appt.status === 'Confirmado' || appt.status === 'Pendiente') &&
            appt.clientEmail &&
            !isBefore(appt.date, today)
    );

  if (isLoading) {
    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-16 w-16 rounded-full" />
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-64" />
                        <Skeleton className="h-5 w-96" />
                    </div>
                </div>
                <Skeleton className="h-10 w-36" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-1">
                    <Skeleton className="h-[350px] w-full" />
                </div>
                <div className="lg:col-span-2">
                    <Skeleton className="h-96 w-full" />
                </div>
            </div>
        </div>
    );
  }

  return (
    <>
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
            <div className="p-3 bg-secondary rounded-full">
                <CalendarIcon className="h-8 w-8 text-foreground"/>
            </div>
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Calendario de Turnos</h1>
                <p className="text-muted-foreground">
                    Visualiza y gestiona todos tus turnos desde una vista centralizada.
                </p>
            </div>
        </div>
         <div className="flex flex-wrap gap-2">
            <Button onClick={() => setIsReminderModalOpen(true)} disabled={activeAppointmentsForReminder.length === 0} variant="outline">
                <Bell className="mr-2 h-4 w-4" />
                Recordar Turno
            </Button>
            <Button onClick={handleExportPDF} disabled={isExporting || allAppointments.length === 0} variant="outline">
                {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Exportar a PDF
            </Button>
        </div>
      </div>
      
       <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-1">
          <Card>
            <CardContent className="p-0 md:p-2 flex justify-center">
              <Calendar
                locale={es}
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                className="w-full max-w-md"
                fromYear={new Date().getFullYear() - 5}
                toYear={new Date().getFullYear() + 5}
                modifiers={{
                  withAppointments: daysWithAppointments,
                }}
                modifiersClassNames={{
                  withAppointments: "bg-primary/20 rounded-full text-primary-foreground font-bold"
                }}
                classNames={{
                  day_selected: "bg-primary text-primary-foreground hover:bg-primary/90",
                  day_today: "bg-accent text-accent-foreground",
                  day_outside: "day-outside text-muted-foreground opacity-50",
                  day_disabled: "text-muted-foreground opacity-50",
                }}
                disabled={(date) => isBefore(date, subDays(new Date(), 365)) || isAfter(date, addDays(new Date(), 365))}
              />
            </CardContent>
          </Card>
           <div className="flex items-center justify-center pt-2 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-primary/30 mr-2"></span> Días con turnos
            </div>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                Turnos para {selectedDate ? format(selectedDate, "d 'de' MMMM 'de' yyyy", { locale: es }) : "..."}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {appointmentsForSelectedDay.length > 0 ? (
                appointmentsForSelectedDay.map((appt) => {
                  const statusStyles = getStatusStyles(appt.status);
                  const isActionDisabled = appt.status === 'Completado' || appt.status === 'Cancelado';
                  return (
                    <div key={appt.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 p-3 sm:p-4 rounded-lg border-l-4", statusStyles.border, "bg-card shadow-sm")}>
                      <div className="flex items-center sm:justify-center sm:w-20">
                        <span className="text-xl sm:text-2xl font-bold text-foreground">{appt.time}</span>
                      </div>
                      <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto flex items-start gap-3 min-w-0">
                        <Avatar className="h-12 w-12 hidden sm:flex">
                          <AvatarImage src={appt.avatar} data-ai-hint="person face" />
                          <AvatarFallback>{appt.client.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-3">
                                <Avatar className="h-9 w-9 shrink-0 sm:hidden">
                                  <AvatarImage src={appt.avatar} data-ai-hint="person face" />
                                  <AvatarFallback>{appt.client.substring(0, 2)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                    <p className="font-semibold text-base">{appt.client}</p>
                                    <p className="text-sm text-muted-foreground">{appt.service || appt.cancha || appt.space || 'Reserva'}</p>
                                    {appt.paymentStatus === 'pending' && <p className="text-xs text-amber-700">Esperando pago de seña</p>}
                                    {appt.paymentStatus === 'paid' && <p className="text-xs text-green-700">Seña acreditada</p>}
                                    {appt.paymentReviewRequired && <p className="text-xs text-destructive">Revisar pago en Mercado Pago</p>}
                                </div>
                            </div>

                          {appt.clientEmail && (
                            <div className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5 min-w-0">
                              <Mail className="h-3 w-3 flex-shrink-0" />
                              <span className="min-w-0 [overflow-wrap:anywhere]">{appt.clientEmail}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="col-start-2 row-start-1 sm:col-start-3 flex items-center sm:flex-col gap-2 justify-end">
                        <Badge variant={statusStyles.badge as any} className={cn(statusStyles.badgeClass, "whitespace-nowrap")}>
                          {appt.status}
                        </Badge>
                        {isUpdating === appt.id ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" className="h-8 w-8 p-0" disabled={isActionDisabled}>
                                <span className="sr-only">Abrir menú</span>
                                <ChevronRight className="h-5 w-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => openActionDialog(appt, 'complete')} disabled={isActionDisabled}>
                                <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
                                <span>Marcar Completado</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                                onClick={() => openActionDialog(appt, 'cancel')}
                                disabled={isActionDisabled}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                <span>Cancelar Turno</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No hay turnos para este día.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <AlertDialog open={isActionAlertOpen} onOpenChange={setIsActionAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>{alertInfo.title}</AlertDialogTitle>
            <AlertDialogDescription>
               {alertInfo.description}
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel disabled={!!isUpdating}>Volver</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleUpdateStatus} 
              disabled={!!isUpdating}
              className={alertInfo.buttonClass}
            >
                {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {alertInfo.buttonText}
            </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
    
     <Dialog open={isReminderModalOpen} onOpenChange={setIsReminderModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar Recordatorio de Turno</DialogTitle>
            <DialogDescription>
              Selecciona los turnos a los que deseas enviar un recordatorio por email. Solo se muestran los turnos activos con un email válido.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
             <ScrollArea className="h-72 w-full rounded-md border">
                 <div className="p-4 space-y-2">
                    {activeAppointmentsForReminder.length > 0 ? activeAppointmentsForReminder.map(appt => (
                        <div key={appt.id} className="flex items-center space-x-3 rounded-md p-2 hover:bg-accent/50">
                            <Checkbox 
                                id={`reminder-${appt.id}`}
                                onCheckedChange={(checked) => {
                                    setSelectedAppointmentsForReminder(prev => {
                                        const newSet = new Set(prev);
                                        if(checked) newSet.add(appt.id!);
                                        else newSet.delete(appt.id!);
                                        return newSet;
                                    })
                                }}
                                checked={selectedAppointmentsForReminder.has(appt.id!)}
                                />
                            <label htmlFor={`reminder-${appt.id}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex-grow cursor-pointer">
                                {appt.client} - {appt.service || appt.cancha || appt.space || 'Reserva'}
                                <p className="text-xs text-muted-foreground">
                                    {format(appt.date, "PP", { locale: es })} a las {appt.time}hs
                                </p>
                            </label>
                        </div>
                    )) : (
                        <div className="text-center text-sm text-muted-foreground py-10">
                            No hay turnos activos con email para recordar.
                        </div>
                    )}
                 </div>
            </ScrollArea>
          </div>
          <DialogFooter>
             <Button variant="secondary" onClick={() => setIsReminderModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSendReminders}
              disabled={isSendingReminders || selectedAppointmentsForReminder.size === 0}
            >
              {isSendingReminders && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enviar {selectedAppointmentsForReminder.size > 0 ? `(${selectedAppointmentsForReminder.size})` : ''} Recordatorios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
