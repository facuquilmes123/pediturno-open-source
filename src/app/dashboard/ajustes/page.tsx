

"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/useAuthRedirect"
import { useToast } from "@/hooks/use-toast"
import { getBusinessProfile, updateBusinessProfile, BusinessProfile, BookingSettings, getAppointments, updateAppointmentStatus, Appointment, Service } from "@/services/data"
import { Loader2, Check, Settings, Mail, AlertCircle, CheckCircle, X, Info } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import UnsavedChangesProvider, { useUnsavedChanges } from "@/components/UnsavedChangesProvider"
import InputWithIcon from "@/components/ui/InputWithIcon"
import AvailabilitySettingsModal from "@/components/AvailabilitySettingsModal"
import { useDashboard } from "@/context/DashboardContext"
import { useSearchParams } from "next/navigation"
import MercadoPagoSettingsCard from "@/components/MercadoPagoSettingsCard"
import PwaInstallBanner from '@/components/PwaInstallBanner';
import NotificationPermissionBanner from '@/components/NotificationPermissionBanner';


const defaultBookingSettings: BookingSettings = {
    bookingLeadTimeHours: 24,
    bookingHorizonDays: 30,
    autoConfirm: true,
    appointmentBufferMinutes: 0,
    remindersEnabled: true,
    newAppointmentNotificationsEnabled: false,
    notificationEmail: '',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AjustesContent() {
    const { user } = useAuth();
    const { refetchProfileAndServices } = useDashboard();
    const { toast } = useToast();
    
    const [profile, setProfile] = useState<BusinessProfile | null>(null);
    const [bookingSettings, setBookingSettings] = useState<BookingSettings>(defaultBookingSettings);
    const [initialState, setInitialState] = useState<any>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isUpdatingAppointment, setIsUpdatingAppointment] = useState<string | null>(null);
    const [pendingAppointments, setPendingAppointments] = useState<Appointment[]>([]);
    const [isNotificationEmailValid, setIsNotificationEmailValid] = useState(true);
    const isSpaces = profile?.businessType === 'spaces';

    const { hasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();
    const searchParams = useSearchParams();

    useEffect(() => {
        const mpStatus = searchParams.get('mp_status');
        const mpError = searchParams.get('mp_error');
        if (mpStatus === 'connected') {
            toast({
                title: "¡Mercado Pago Vinculado!",
                description: "Tu cuenta quedó vinculada. Configurá el tipo y valor de la seña en esta pantalla cuando el servicio esté habilitado.",
            });
        } else if (mpError) {
            toast({
                variant: "destructive",
                title: "Error de vinculación",
                description: `No se pudo conectar con Mercado Pago: ${mpError}`,
            });
        }
    }, [searchParams, toast]);

    useEffect(() => {
        if(initialState) {
            const hasChanged = JSON.stringify(initialState.bookingSettings) !== JSON.stringify(bookingSettings);
            setHasUnsavedChanges(hasChanged);
        }
    }, [bookingSettings, initialState, setHasUnsavedChanges]);


    const isSaveDisabled = isSaving || isLoading || !hasUnsavedChanges || (bookingSettings.newAppointmentNotificationsEnabled && !isNotificationEmailValid);
    
    const loadProfileData = useCallback(async () => {
        if (!user) return;
        try {
            setIsLoading(true);
            const data = await getBusinessProfile(user.uid);
            if (data) {
                setProfile(data);
                const loadedBookingSettings = data.bookingSettings ? { ...defaultBookingSettings, ...data.bookingSettings } : defaultBookingSettings;
                setBookingSettings(loadedBookingSettings);
                setInitialState({ bookingSettings: loadedBookingSettings });
            }
        } catch (error) {
            console.error("Failed to load business profile:", error);
            toast({ variant: "destructive", title: "Error", description: "No se pudo cargar la configuración de disponibilidad." });
        } finally {
            setIsLoading(false);
        }
    }, [user, toast]);

    const loadPendingAppointments = useCallback(async () => {
        if (!user) return;
        try {
            const allAppointments = await getAppointments(user.uid);
            setPendingAppointments(allAppointments.filter(a => a.status === 'Pendiente'));
        } catch (error) {
            console.error("Failed to load pending appointments:", error);
            toast({ variant: "destructive", title: "Error", description: "No se pudieron cargar los turnos pendientes." });
        }
    }, [user, toast]);

    useEffect(() => {
        if (user) {
            loadProfileData();
            loadPendingAppointments();
        }
    }, [user, loadProfileData, loadPendingAppointments]);
    
     useEffect(() => {
        if (bookingSettings.newAppointmentNotificationsEnabled && bookingSettings.notificationEmail) {
            setIsNotificationEmailValid(EMAIL_REGEX.test(bookingSettings.notificationEmail));
        } else {
            setIsNotificationEmailValid(true);
        }
    }, [bookingSettings.notificationEmail, bookingSettings.newAppointmentNotificationsEnabled]);

     const handleBookingSettingChange = (field: keyof BookingSettings, value: string | number | boolean) => {
        const isNumericField = ['bookingLeadTimeHours', 'bookingHorizonDays', 'appointmentBufferMinutes'].includes(field);
        
        let processedValue = value;
        if (isNumericField && typeof value === 'string') {
             processedValue = parseInt(value, 10);
             if (isNaN(processedValue as number)) {
                 processedValue = 0; // or some default/fallback
             }
        }
    
        setBookingSettings(prev => ({ ...prev, [field]: processedValue }));
    };

     const handleBookingToggleChange = (field: keyof BookingSettings, enabled: boolean, defaultValue: number) => {
        if (enabled) {
            const currentValue = bookingSettings[field] as number | undefined;
            setBookingSettings(prev => ({ ...prev, [field]: (currentValue && currentValue > 0) ? currentValue : defaultValue }));
        } else {
            setBookingSettings(prev => ({ ...prev, [field]: 0 }));
        }
    };
    
     const handleUpdateAppointmentStatus = async (appointmentId: string, newStatus: 'Confirmado' | 'Cancelado') => {
        setIsUpdatingAppointment(appointmentId);
        try {
            await updateAppointmentStatus(appointmentId, newStatus);
            
            toast({
                title: "¡Éxito!",
                description: `El turno ha sido ${newStatus === 'Confirmado' ? 'confirmado' : 'rechazado'}.`,
            });
            
             if (newStatus === 'Confirmado' && user) {
                 try {
                     const token = await user.getIdToken();
                     const notification = await fetch('/api/owner/appointments/notify', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                         body: JSON.stringify({ appointmentId, kind: 'confirmation' }),
                     });
                     if (!notification.ok) throw new Error('Confirmation queue unavailable');
                     toast({ title: 'Correo programado', description: 'La confirmación se enviará cuando el servicio de entrega la procese.' });
                 } catch {
                     toast({ variant: 'destructive', title: 'Turno confirmado', description: 'No se pudo programar el correo de confirmación.' });
                 }
             }
           
            loadPendingAppointments(); // Refresh the list
        } catch (error) {
             console.error(`Failed to ${newStatus} appointment:`, error);
            toast({ variant: "destructive", title: "Error", description: "No se pudo actualizar el estado del turno." });
        } finally {
            setIsUpdatingAppointment(null);
        }
    };


    const handleSaveSettings = async () => {
        if (!user) return;
         if (bookingSettings.newAppointmentNotificationsEnabled && !isNotificationEmailValid) {
            toast({
                variant: 'destructive',
                title: 'Email inválido',
                description: 'Por favor, corrige el formato del email para notificaciones antes de guardar.'
            });
            return;
        }

        if (!Number.isInteger(bookingSettings.bookingHorizonDays) || bookingSettings.bookingHorizonDays < 1 || bookingSettings.bookingHorizonDays > 365 ||
            !Number.isInteger(bookingSettings.bookingLeadTimeHours) || bookingSettings.bookingLeadTimeHours < 0 || bookingSettings.bookingLeadTimeHours > 720 ||
            !Number.isInteger(bookingSettings.appointmentBufferMinutes ?? 0) || (bookingSettings.appointmentBufferMinutes ?? 0) < 0 || (bookingSettings.appointmentBufferMinutes ?? 0) > 240 || (isSpaces && (bookingSettings.appointmentBufferMinutes ?? 0) % 10 !== 0)) {
            toast({ variant: 'destructive', title: 'Revisá los límites', description: `Horizonte: 1–365 días. Anticipación: 0–720 horas. Intervalo: 0–240 minutos${isSpaces ? ', en bloques de 10' : ''}.` });
            return;
        }
        setIsSaving(true);
        try {
            const dataToSave: Partial<BusinessProfile> = { bookingSettings };
            await updateBusinessProfile(user.uid, dataToSave);
            toast({
                title: "¡Éxito!",
                description: "Tu configuración se ha guardado correctamente.",
            });
            setInitialState({ bookingSettings }); // Update initial state after saving
            setHasUnsavedChanges(false);
            refetchProfileAndServices(); // Refetch global context
        } catch (error) {
            console.error("Failed to save settings:", error);
            toast({ variant: "destructive", title: "Error", description: "No se pudieron guardar los cambios." });
        } finally {
            setIsSaving(false);
        }
    };


  return (
    <>
    <TooltipProvider>
    <div className="flex flex-col gap-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
            <div className="p-3 bg-secondary rounded-full">
                <Settings className="h-8 w-8 text-foreground"/>
            </div>
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Ajustes de Reserva</h1>
                <p className="text-muted-foreground">
                    Configura las reglas y automatizaciones para la toma de turnos.
                </p>
            </div>
        </div>
         <Button onClick={handleSaveSettings} disabled={isSaveDisabled}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Guardar Cambios
        </Button>
      </div>
      
        {isLoading ? (
            <div className="space-y-6">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-32 w-full" />
            </div>
        ) : (
        <>
            <PwaInstallBanner alwaysShow />
            <NotificationPermissionBanner settings />
            <Card>
                <CardHeader>
                <CardTitle>Reglas de Reserva</CardTitle>
                <CardDescription>
                    Define las condiciones y automatizaciones para tus reservas online.
                </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-4 rounded-lg border p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <Label htmlFor="lead-time-enabled" className="text-base font-medium">Antelación Mínima</Label>
                                <p className="text-xs text-muted-foreground mt-1">Evita que los clientes reserven a último momento.</p>
                            </div>
                            <Switch
                                id="lead-time-enabled"
                                checked={(bookingSettings.bookingLeadTimeHours ?? 0) > 0}
                                onCheckedChange={(checked) => handleBookingToggleChange('bookingLeadTimeHours', checked, 24)}
                            />
                        </div>
                        {(bookingSettings.bookingLeadTimeHours ?? 0) > 0 && (
                            <div className="grid gap-2 pt-2 border-t">
                                <Label htmlFor="bookingLeadTime">Antelación en horas</Label>
                                <Input 
                                    id="bookingLeadTime" 
                                    type="number"
                                    min="1"
                                    value={bookingSettings.bookingLeadTimeHours || ''}
                                    onChange={(e) => handleBookingSettingChange('bookingLeadTimeHours', e.target.value)}
                                    placeholder="Ej: 24" 
                                />
                            </div>
                        )}
                    </div>
                    <div className="space-y-4 rounded-lg border p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <Label htmlFor="bookingHorizon" className="text-base font-medium">Horizonte de Reserva</Label>
                                <p className="text-xs text-muted-foreground mt-1">Definí entre 1 y 365 días de anticipación máxima para reservar.</p>
                            </div>
                        </div>
                        {(
                            <div className="grid gap-2 pt-2 border-t">
                                <Label htmlFor="bookingHorizon">Horizonte en días</Label>
                                <Input 
                                    id="bookingHorizon" 
                                    type="number" 
                                    min="1" max="365"
                                    value={bookingSettings.bookingHorizonDays || ''}
                                    onChange={(e) => handleBookingSettingChange('bookingHorizonDays', e.target.value)}
                                    placeholder="Ej: 30" 
                                />
                            </div>
                        )}
                    </div>
                    <div className="space-y-4 rounded-lg border p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <Label htmlFor="buffer-enabled" className="text-base font-medium">Intervalo entre Turnos</Label>
                                <p className="text-xs text-muted-foreground mt-1">Tiempo extra que se bloqueará en tu calendario después de cada turno.</p>
                            </div>
                            <Switch
                                id="buffer-enabled"
                                checked={(bookingSettings.appointmentBufferMinutes ?? 0) > 0}
                                onCheckedChange={(checked) => handleBookingToggleChange('appointmentBufferMinutes', checked, isSpaces ? 20 : 15)}
                            />
                        </div>
                        {(bookingSettings.appointmentBufferMinutes ?? 0) > 0 && (
                            <div className="grid gap-2 pt-2 border-t">
                                <Label htmlFor="appointmentBuffer">Intervalo en minutos</Label>
                                <Input 
                                    id="appointmentBuffer" 
                                    type="number" 
                                    min="0" max="240" step={isSpaces ? 10 : 1}
                                    value={bookingSettings.appointmentBufferMinutes || ''}
                                    onChange={(e) => handleBookingSettingChange('appointmentBufferMinutes', e.target.value)}
                                    placeholder={isSpaces ? 'Ej: 20' : 'Ej: 15'}
                                />
                                {isSpaces && <p className="text-xs text-muted-foreground">Para Espacios, usá intervalos de 10 minutos.</p>}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="flex items-center gap-2">
                             <Label htmlFor="autoConfirm" className="text-base font-medium">Confirmación Automática de Turnos</Label>
                             <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Si está activo, los turnos se confirman al instante.<br/>Si no, quedan pendientes de tu aprobación en esta misma página.</p>
                                </TooltipContent>
                                </Tooltip>
                        </div>
                        <Switch 
                            id="autoConfirm"
                            checked={bookingSettings.autoConfirm}
                            onCheckedChange={(checked) => handleBookingSettingChange('autoConfirm', checked)}
                        />
                    </div>
                    
                    <div className="space-y-4 rounded-lg border p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Label htmlFor="new-appointment-notifications" className="text-base font-medium">Recibir email por cada nuevo turno</Label>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Se enviará una notificación a tu correo <br/>cada vez que un cliente agende un nuevo turno.</p>
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                            <Switch 
                                id="new-appointment-notifications"
                                checked={bookingSettings.newAppointmentNotificationsEnabled}
                                onCheckedChange={(checked) => handleBookingSettingChange('newAppointmentNotificationsEnabled', checked)}
                            />
                        </div>
                        {bookingSettings.newAppointmentNotificationsEnabled && (
                            <div className="grid gap-2 pt-2 border-t">
                                <Label htmlFor="notificationEmail">Email para notificaciones</Label>
                                <InputWithIcon 
                                    icon={Mail}
                                    id="notificationEmail" 
                                    type="email"
                                    value={bookingSettings.notificationEmail || ''}
                                    onChange={(e) => handleBookingSettingChange('notificationEmail', e.target.value)}
                                    placeholder="tuemail@negocio.com"
                                    error={!isNotificationEmailValid}
                                    suffix={bookingSettings.notificationEmail ? (isNotificationEmailValid ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-destructive" />) : null}
                                />
                                {!isNotificationEmailValid && bookingSettings.notificationEmail && (
                                    <p className="text-xs text-destructive">Formato de email incorrecto.</p>
                                )}
                            </div>
                        )}
                    </div>

                    
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center justify-between rounded-lg border p-4 opacity-50 cursor-not-allowed">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Label htmlFor="remindersEnabled" className="text-base font-medium">Recordatorios por Email 24hs Antes</Label>
                                        <Badge variant="secondary">Próximamente</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">Si está activo, tus clientes recibirán un recordatorio de su turno por correo.</p>
                                </div>
                                <Switch 
                                    id="remindersEnabled"
                                    checked={false}
                                    disabled
                                />
                            </div>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Esta funcionalidad estará disponible próximamente.</p>
                        </TooltipContent>
                    </Tooltip>
                    

                </CardContent>
            </Card>

            {profile && user && (
                <MercadoPagoSettingsCard 
                    profile={profile} 
                    userId={user.uid} 
                    onProfileUpdated={loadProfileData} 
                />
            )}
            
            {!bookingSettings.autoConfirm && (
                <Card>
                    <CardHeader>
                        <CardTitle>Turnos Pendientes de Aprobación</CardTitle>
                        <CardDescription>
                            Aprueba o rechaza los turnos solicitados por tus clientes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Cliente</TableHead>
                                        <TableHead>Servicio</TableHead>
                                        <TableHead className="hidden sm:table-cell">Fecha</TableHead>
                                        <TableHead className="hidden sm:table-cell">Hora</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pendingAppointments.length > 0 ? (
                                        pendingAppointments.map(appt => (
                                            <TableRow key={appt.id} className="hover:bg-accent/50">
                                                <TableCell className="font-medium">{appt.client}</TableCell>
                                                <TableCell>{appt.service || appt.cancha || appt.space || 'Reserva'}</TableCell>
                                                <TableCell className="hidden sm:table-cell">{appt.date.toLocaleDateString('es-ES')}</TableCell>
                                                <TableCell className="hidden sm:table-cell">{appt.time}</TableCell>
                                                <TableCell className="text-right">
                                                    {isUpdatingAppointment === appt.id ? (
                                                        <Loader2 className="h-5 w-5 animate-spin ml-auto" />
                                                    ) : (
                                                        <div className="flex gap-2 justify-end">
                                                            <Button size="icon" variant="outline" aria-label={`Aprobar reserva de ${appt.client}`} className="h-8 w-8 text-green-600 hover:text-green-600 hover:bg-green-50" onClick={() => handleUpdateAppointmentStatus(appt.id!, 'Confirmado')}>
                                                                <Check className="h-4 w-4"/>
                                                            </Button>
                                                            <Button size="icon" variant="outline" aria-label={`Rechazar reserva de ${appt.client}`} className="h-8 w-8 text-destructive hover:text-destructive hover:bg-red-50" onClick={() => handleUpdateAppointmentStatus(appt.id!, 'Cancelado')}>
                                                                <X className="h-4 w-4"/>
                                                            </Button>
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center h-24">
                                                No tienes turnos pendientes de aprobación.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </>
        )}
    </div>
    </TooltipProvider>
    </>
  )
}

export default function AjustesPage() {
    return (
        <UnsavedChangesProvider>
            <AjustesContent />
        </UnsavedChangesProvider>
    );
}
