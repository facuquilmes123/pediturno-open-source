"use client"
import { validateReservableWorkingHours } from '@/lib/cancha-validation';
import ArsPriceInput from '@/components/ArsPriceInput';
import { formatArsInput } from '@/lib/ars-input';
import OnboardingRequirements from '@/components/OnboardingRequirements';
import { getResourceOnboardingMissingRequirements } from '@/lib/onboarding-requirements';
import { resourceErrorMessage } from '@/lib/resource-errors';

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MoreHorizontal, PlusCircle, Loader2, Upload, Image as ImageIcon, Briefcase, Trash2, Settings, Clock, DollarSign, CalendarDays, CheckCircle, XCircle, CalendarOff } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import { 
    getServices, 
    Service,
    createService,
    updateService,
    deleteService,
    NewServiceData,
    uploadFile,
    deleteFile,
    WorkingHours,
} from "@/services/data"
import { normalizeCanchaPrice } from "@/lib/cancha-validation"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuthRedirect"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import Image from "next/image"
import AvailabilitySettingsModal from "@/components/AvailabilitySettingsModal"
import { useDashboard } from "@/context/DashboardContext"
import { addDays, isSameDay, getWeek, format, startOfToday } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Switch } from '@/components/ui/switch';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // The shared uploader optimizes the final image.

const hasValidServiceAvailability = (workingHours?: WorkingHours, duration?: unknown) =>
    validateReservableWorkingHours(workingHours, duration) === null;

type DayStatus = 'Con Servicios' | 'Cerrado';

const DayAvailabilityCard = ({ services, onManageBlockedDaysClick }: { services: Service[], onManageBlockedDaysClick: () => void }) => {
    
    const getDayStatus = useCallback((date: Date): DayStatus => {
        const dayOfWeek = date.getDay();

        // Check if any service is available on this day
        const hasServiceOnDay = services.some(service => {
            if (service.status !== 'Activo') return false;
            
            // Check if the specific date is blocked for this service
            if (service.unavailableDates?.some(unavailable => isSameDay(date, unavailable))) {
                return false;
            }

            // Check working hours for the day of the week
            const dayConfig = service.workingHours?.[dayOfWeek];
            if (!dayConfig || !dayConfig.slots || dayConfig.slots.length === 0) {
                return false;
            }
            
            // Handle alternating weeks logic
            if (dayConfig.isAlternating) {
                 const weekNumber = getWeek(date, { weekStartsOn: 1 }); // weekStartsOn: 1 for Monday
                 // Assuming availability is on EVEN weeks. If the week is ODD, it's not available.
                 if (weekNumber % 2 !== 0) { 
                    return false;
                }
            }

            // If all checks pass, the service is available on this day
            return true;
        });

        return hasServiceOnDay ? 'Con Servicios' : 'Cerrado';
    }, [services]);

    const weekDays = useMemo(() => {
        const today = startOfToday();
        return Array.from({ length: 7 }).map((_, i) => addDays(today, i));
    }, []);


    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5"/>
                    Disponibilidad de la Próxima Semana
                </CardTitle>
                <CardDescription>
                    Un resumen de tu configuración de disponibilidad para los próximos 7 días.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="space-y-3">
                    {weekDays.map(day => {
                        const status = getDayStatus(day);
                        const isClosed = status === 'Cerrado';
                        const Icon = isClosed ? XCircle : CheckCircle;
                        const iconColor = isClosed ? 'text-muted-foreground' : 'text-green-500';
                        const textColor = isClosed ? 'text-muted-foreground' : 'text-foreground';

                        return (
                            <li key={day.toISOString()} className="flex items-center justify-between p-3 rounded-md bg-secondary/50">
                                <div className="flex flex-col">
                                    <span className="font-semibold capitalize">{format(day, "EEEE d", { locale: es })}</span>
                                    <span className="text-sm text-muted-foreground capitalize">{format(day, "MMMM", { locale: es })}</span>
                                </div>
                                <div className={cn("flex items-center gap-2 font-medium", textColor)}>
                                    <Icon className={cn("h-5 w-5", iconColor)} />
                                    <span>{status}</span>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </CardContent>
             <CardFooter>
                 <Button variant="outline" size="sm" onClick={onManageBlockedDaysClick}>
                    <CalendarOff className="mr-2 h-4 w-4" />
                    Ajustes de Disponibilidad
                </Button>
            </CardFooter>
        </Card>
    );
}

export default function ServiciosPage() {
  const { user } = useAuth();
  const { refetchProfileAndServices } = useDashboard();
  
  const [services, setServices] = useState<Service[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Service Create/Edit Modal
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activatingServiceId, setActivatingServiceId] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);

  // Availability Settings Modal
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);
  const [serviceForAvailability, setServiceForAvailability] = useState<Service | null>(null);
  const [availabilityDefaultTab, setAvailabilityDefaultTab] = useState<'weekly' | 'blocked'>('weekly');


  // Form state
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("");
  const [price, setPrice] = useState("");
  const [useGlobalBuffer, setUseGlobalBuffer] = useState(true);
  const [bookingBufferMinutes, setBookingBufferMinutes] = useState("0");
  const [saveAttempted, setSaveAttempted] = useState(false);
  const formMissing = [
    ...(name.trim().length < 2 || name.trim().length > 80 ? ['El nombre debe tener entre 2 y 80 caracteres.'] : []),
    ...(!/^\d{1,4}$/.test(duration) || Number(duration) < 10 || Number(duration) > 1440 ? ['Indicá una duración entera entre 10 y 1440 minutos.'] : []),
    ...(!normalizeCanchaPrice(price) ? ['Ingresá un precio mayor a 0, con hasta dos decimales (máximo $10.000.000).'] : []),
    ...(!useGlobalBuffer && (!/^\d+$/.test(bookingBufferMinutes) || Number(bookingBufferMinutes) < 0 || Number(bookingBufferMinutes) > 240 || Number(bookingBufferMinutes) % 5 !== 0) ? ['La pausa entre turnos debe estar entre 0 y 240 minutos, en intervalos de 5.'] : []),
  ];
  const [status, setStatus] = useState<'Activo' | 'Pausado'>('Pausado');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const pendingAvailabilityAfterCreateRef = useRef<Service | null>(null);
  
  // Deletion state
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast } = useToast();

  const revokePhotoPreview = () => {
      if (previewObjectUrlRef.current) {
          URL.revokeObjectURL(previewObjectUrlRef.current);
          previewObjectUrlRef.current = null;
      }
  };

  useEffect(() => () => revokePhotoPreview(), []);

  const loadServices = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      const fetchedServices = await getServices(user.uid);
      setServices(fetchedServices);
    } catch (error) {
      console.error("Failed to fetch services:", error);
      toast({
          variant: "destructive",
          title: "Error",
          description: "No se pudieron cargar los servicios.",
      });
    } finally {
      setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
        loadServices();
    }
  }, [user, loadServices]);

  const resetForm = () => {
      setSaveAttempted(false);
      revokePhotoPreview();
      setName("");
      setDuration("");
      setPrice("");
      setUseGlobalBuffer(true);
      setBookingBufferMinutes("0");
      setStatus("Pausado");
      setPhotoPreview(null);
      setPhotoFile(null);
      setEditingService(null);
  }
  
  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > MAX_FILE_SIZE) {
        toast({
            variant: "destructive",
            title: "Imagen no compatible",
            description: "Usá una imagen JPG, PNG o WebP de hasta 10 MB.",
        });
        event.currentTarget.value = '';
        return;
    }
    
    revokePhotoPreview();
    const previewUrl = URL.createObjectURL(file);
    previewObjectUrlRef.current = previewUrl;
    setPhotoFile(file);
    setPhotoPreview(previewUrl);
  };

  const handleOpenEditModal = (service: Service) => {
    revokePhotoPreview();
    setEditingService(service);
    setName(service.name);
    setDuration(service.duration);
    setPrice(service.price);
    setUseGlobalBuffer(service.bookingBufferMinutes == null);
    setBookingBufferMinutes(String(service.bookingBufferMinutes || 0));
    setStatus(service.status);
    setPhotoPreview(service.photo || null);
    setPhotoFile(null); // Reset file input
    setIsServiceModalOpen(true);
  };

  const handleOpenAvailabilityModal = (service: Service, defaultTab: 'weekly' | 'blocked' = 'weekly') => {
    setServiceForAvailability(service);
    setAvailabilityDefaultTab(defaultTab);
    setIsAvailabilityModalOpen(true);
  };
  
  const handleManageBlockedDaysClick = () => {
        if (services.length > 0) {
            handleOpenAvailabilityModal(services[0], 'blocked');
        } else {
            toast({
                variant: 'destructive',
                title: 'No hay servicios',
                description: 'Primero debes crear un servicio para poder configurar su disponibilidad.',
            });
        }
    };

  const openDeleteDialog = (service: Service) => {
    setServiceToDelete(service);
    setIsDeleteAlertOpen(true);
  };

  const handleSaveService = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "No estás autenticado." });
      return;
    }
    setSaveAttempted(true);
    if (formMissing.length > 0) {
      toast({ variant: "destructive", title: "Faltan datos", description: formMissing.join(" ") });
      return;
    }

    if (!editingService && status === 'Activo') {
      toast({ variant: 'destructive', title: 'Configurá la disponibilidad primero', description: 'Creá el servicio pausado, definí sus horarios y activalo cuando esté listo para recibir reservas.' });
      return;
    }
    if (editingService && status === 'Activo' && !hasValidServiceAvailability(editingService.workingHours, duration)) {
      toast({ variant: 'destructive', title: 'Falta disponibilidad', description: 'Definí al menos un horario antes de activar este servicio.' });
      return;
    }

    setIsSaving(true);
    let finalPhotoUrl = editingService?.photo;
    let uploadedPhotoUrl: string | undefined;

    // 1. Handle Photo Upload if a new file is selected
    if (photoFile) {
      setIsUploading(true);
      try {
        uploadedPhotoUrl = await uploadFile(photoFile, 'services');
        finalPhotoUrl = uploadedPhotoUrl;
      } catch (error) {
        console.error("Failed to upload photo:", error);
        toast({
          variant: "destructive",
          title: "Error al subir",
          description: error instanceof Error && error.message.trim()
            ? error.message
            : "No se pudo subir la imagen del servicio.",
        });
        setIsSaving(false);
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    // 2. Prepare service data
    const serviceData: Partial<NewServiceData> & { businessId: string } = {
      name,
      duration,
      price,
      status,
      businessId: user.uid,
      bookingBufferMinutes: useGlobalBuffer ? null : Number(bookingBufferMinutes),
    };

    if (finalPhotoUrl && (!editingService || uploadedPhotoUrl)) {
      serviceData.photo = finalPhotoUrl;
    }


    // 3. Save data to Firestore
    let createdServiceForAvailability: Service | null = null;
    let persisted = false;
    try {
      if (editingService) {
        await updateService(editingService.id, serviceData);
        persisted = true;
        toast({ title: "¡Éxito!", description: "El servicio ha sido actualizado." });
      } else {
        const createdServiceId = await createService(serviceData as NewServiceData);
        persisted = true;
        createdServiceForAvailability = {
          id: createdServiceId,
          businessId: user.uid,
          name,
          duration,
          price,
          status: 'Pausado',
          bookingBufferMinutes: useGlobalBuffer ? null : Number(bookingBufferMinutes),
          ...(finalPhotoUrl ? { photo: finalPhotoUrl } : {}),
        };
        toast({ title: "Servicio creado en pausa", description: "Configurá sus horarios para dejarlo listo para activar." });
      }

      if (uploadedPhotoUrl && editingService?.photo && editingService.photo !== uploadedPhotoUrl) await deleteFile(editingService.photo);

      if (createdServiceForAvailability) {
        pendingAvailabilityAfterCreateRef.current = createdServiceForAvailability;
      }
      setIsServiceModalOpen(false);
      resetForm();
      await Promise.all([loadServices(), refetchProfileAndServices()]);

    } catch (error) {
      if (uploadedPhotoUrl && !persisted) await deleteFile(uploadedPhotoUrl);
      if (persisted) {
        console.error("Failed to refresh after saving service:", error);
        toast({
          title: "Servicio guardado",
          description: "El guardado se completó, pero la pantalla no pudo actualizarse. Recargá la página para ver el estado actual.",
        });
      } else {
        console.error("Failed to save service:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: error instanceof Error ? resourceErrorMessage(error, error.message) : 'No se pudo guardar el servicio.',
        });
      }
    } finally {
      setIsSaving(false);
    }
  }

  const handleActivateService = async (service: Service) => {
    if (!hasValidServiceAvailability(service.workingHours, service.duration)) {
      toast({
        variant: 'destructive',
        title: 'Falta disponibilidad',
        description: 'Configurá al menos un día y horario válido antes de activar este servicio.',
      });
      return;
    }

    setActivatingServiceId(service.id);
    try {
      await updateService(service.id, { status: 'Activo' });
      toast({ title: 'Servicio activo', description: 'Ya puede mostrarse para nuevas reservas.' });
      await Promise.all([loadServices(), refetchProfileAndServices()]);
    } catch (error) {
      console.error("Failed to activate service:", error);
      toast({ variant: 'destructive', title: 'No se pudo activar', description: 'Revisá la disponibilidad e intentá nuevamente.' });
    } finally {
      setActivatingServiceId(null);
    }
  };

    const handleSaveAvailability = async (
        serviceId: string,
        dataToSave: {
            workingHours?: WorkingHours,
            unavailableDates?: Date[]
        }
    ) => {
        setIsSaving(true);
        try {
            await updateService(serviceId, dataToSave);
            toast({
                title: 'Horarios guardados',
                description: 'Si el servicio está pausado, ya podés activarlo desde su tarjeta.',
            });
            setIsAvailabilityModalOpen(false);
            await Promise.all([loadServices(), refetchProfileAndServices()]);
        } catch (error) {
            console.error("Failed to save availability:", error);
            toast({
                variant: 'destructive',
                title: 'Error al guardar',
                description: error instanceof Error ? resourceErrorMessage(error, error.message) : 'No se pudo actualizar la disponibilidad del servicio.',
            });
        } finally {
            setIsSaving(false);
        }
    };
  
  const handleDeleteService = async () => {
    if (!serviceToDelete || !serviceToDelete.id) return;
    
    setIsDeleting(true);
    try {
      await deleteService(serviceToDelete.id);
      if (serviceToDelete.photo) await deleteFile(serviceToDelete.photo).catch(() => {
        console.warn('[service image cleanup] El servicio fue eliminado; queda pendiente limpiar su imagen.');
      });

      toast({
        title: "¡Éxito!",
        description: "El servicio ha sido eliminado exitosamente.",
      });

      await Promise.all([loadServices(), refetchProfileAndServices()]);
    } catch (error) {
      console.error("Failed to delete service:", error);
      toast({
        variant: "destructive",
        title: error instanceof Error && error.message === 'SERVICE_HAS_ACTIVE_RESERVATIONS' ? "No se puede eliminar este servicio" : "Error",
        description: error instanceof Error && error.message === 'SERVICE_HAS_ACTIVE_RESERVATIONS'
          ? "Tiene reservas vigentes o de hoy. Pausalo para ocultarlo de nuevas reservas y conservá las existentes."
          : "No se pudo eliminar el servicio."
      });
    } finally {
      setIsDeleting(false);
      setIsDeleteAlertOpen(false);
      setServiceToDelete(null);
    }
  };


  return (
    <>
    <div className="flex flex-col gap-8">
       <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-secondary rounded-full">
                    <Briefcase className="h-8 w-8 text-foreground"/>
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Tus Servicios</h1>
                    <p className="text-muted-foreground">
                    Agrega, edita y configura la disponibilidad de los servicios que ofreces.
                    </p>
                </div>
            </div>
          <Button size="sm" onClick={() => { resetForm(); setIsServiceModalOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Agregar Servicio
          </Button>
        </div>

      <div className="mt-2">
        <DayAvailabilityCard services={services} onManageBlockedDaysClick={handleManageBlockedDaysClick} />
      </div>


      <OnboardingRequirements requirements={getResourceOnboardingMissingRequirements(services, 'servicio')} title="Para completar este paso" />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Listado de Servicios</CardTitle>
          <CardDescription>
            Desde aquí puedes gestionar los servicios y su disponibilidad horaria individual.
          </CardDescription>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Card key={i}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
                    ))}
                 </div>
            ) : services.length > 0 ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {services.map((service) => {
                        const availabilityReady = hasValidServiceAvailability(service.workingHours, service.duration);
                        const isActivating = activatingServiceId === service.id;
                        return (
                         <Card key={service.id} className="flex flex-col">
                            <CardHeader className="flex-row gap-4 items-start pb-4">
                                <div className="flex-shrink-0">
                                    {service.photo ? (
                                        <Image src={service.photo} alt={service.name} width={64} height={64} className="rounded-lg object-contain bg-secondary/40 h-16 w-16" />
                                    ) : (
                                        <div className="h-16 w-16 rounded-lg bg-secondary flex items-center justify-center">
                                            <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-grow">
                                    <h3 className="font-semibold text-base line-clamp-2">{service.name}</h3>
                                    <Badge variant={service.status === 'Activo' ? 'default' : 'secondary'} className="mt-1">
                                        {service.status}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-grow space-y-2 text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-4 w-4 flex-shrink-0" />
                                    <span>{service.duration} minutos</span>
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <DollarSign className="h-4 w-4 flex-shrink-0" />
                                    <span>{formatArsInput(String(service.price))}</span>
                                </div>
                                {service.status === 'Pausado' && (
                                    <div className={cn(
                                        "rounded-lg border px-3 py-2 text-xs",
                                        availabilityReady
                                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                                            : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                                    )}>
                                        {availabilityReady
                                            ? 'Los horarios están listos. Activá el servicio para publicarlo.'
                                            : 'Todavía no se publica: primero configurá al menos un horario.'}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex-col gap-2 p-4 border-t">
                                 {service.status === 'Pausado' && (
                                    availabilityReady ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="w-full"
                                            onClick={() => handleActivateService(service)}
                                            disabled={isActivating}
                                        >
                                            {isActivating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                                            {isActivating ? 'Activando...' : 'Activar servicio'}
                                        </Button>
                                    ) : (
                                        <Button type="button" size="sm" className="w-full" onClick={() => handleOpenAvailabilityModal(service)}>
                                            <CalendarDays className="mr-2 h-4 w-4" />
                                            Configurar horarios
                                        </Button>
                                    )
                                 )}
                                 <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button aria-haspopup="true" size="sm" variant="outline" className="w-full">
                                            <MoreHorizontal className="h-4 w-4 mr-2" />
                                            Acciones
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuLabel>Acciones del Servicio</DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => handleOpenEditModal(service)}>
                                            <Briefcase className="mr-2 h-4 w-4" />
                                            Editar Servicio
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleOpenAvailabilityModal(service)}>
                                           <Settings className="mr-2 h-4 w-4" />
                                           Ajustes de Disponibilidad
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => openDeleteDialog(service)}>
                                           <Trash2 className="mr-2 h-4 w-4" />
                                           Eliminar
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </CardFooter>
                         </Card>
                        );
                    })}
                </div>
            ) : (
                <div className="h-48 flex flex-col items-center justify-center text-center">
                    <h3 className="font-semibold">No has agregado ningún servicio todavía.</h3>
                    <p className="text-muted-foreground text-sm mt-1 mb-4">Empieza por crear tu primer servicio para tus clientes.</p>
                    <Button size="sm" onClick={() => { resetForm(); setIsServiceModalOpen(true); }}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Agregar Servicio
                    </Button>
                </div>
            )}
        </CardContent>
      </Card>
    </div>

    <Dialog open={isServiceModalOpen} onOpenChange={(open) => {
        if (!isSaving) { // Don't close modal if it's saving
            if (!open) resetForm();
            setIsServiceModalOpen(open);
        }
    }}>
        <DialogContent
            className="sm:max-w-[425px]"
            onCloseAutoFocus={(event) => {
                const pendingService = pendingAvailabilityAfterCreateRef.current;
                if (!pendingService) return;
                event.preventDefault();
                pendingAvailabilityAfterCreateRef.current = null;
                queueMicrotask(() => handleOpenAvailabilityModal(pendingService));
            }}
        >
            <DialogHeader>
                <DialogTitle>{editingService ? 'Editar Servicio' : 'Agregar Nuevo Servicio'}</DialogTitle>
                <DialogDescription>
                    {editingService ? 'Modifica los detalles del servicio.' : 'Crealo pausado, configurá sus horarios y activalo cuando esté listo para recibir reservas.'}
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label htmlFor="name">Nombre del Servicio</Label>
                    <Input id="name" minLength={2} maxLength={80} aria-invalid={saveAttempted && (name.trim().length < 2 || name.trim().length > 80)} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Corte de pelo" />
                </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="duration">Duración (en minutos)</Label>
                        <Input id="duration" min="10" max="1440" step="1" aria-invalid={saveAttempted && (Number(duration) < 10 || Number(duration) > 1440)} type="number" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} placeholder="Ej: 30" />
                    </div>
                     <div className="grid gap-2">
                        <Label htmlFor="price">Precio (en Pesos ARS)</Label>
                        <ArsPriceInput id="price" value={price} onValueChange={setPrice} aria-invalid={saveAttempted && !normalizeCanchaPrice(price)} placeholder="Ej: 100.000" />
                    </div>
                </div>
                <div className="grid gap-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div><Label htmlFor="service-global-buffer">Pausa entre turnos</Label><p className="text-xs text-muted-foreground">Bloquea ese tiempo después de cada reserva.</p></div>
                        <div className="flex items-center gap-2"><Switch id="service-global-buffer" checked={useGlobalBuffer} onCheckedChange={setUseGlobalBuffer} /><Label htmlFor="service-global-buffer" className="text-xs">Usar ajuste general</Label></div>
                    </div>
                    {!useGlobalBuffer && <div className="grid gap-1"><Label htmlFor="service-buffer">Minutos para este servicio</Label><Input id="service-buffer" type="number" min={0} max={240} step={5} value={bookingBufferMinutes} onChange={(event) => setBookingBufferMinutes(event.target.value.replace(/\D/g, ''))} aria-invalid={saveAttempted && (!/^\d+$/.test(bookingBufferMinutes) || Number(bookingBufferMinutes) > 240 || Number(bookingBufferMinutes) % 5 !== 0)} /><p className="text-xs text-muted-foreground">En intervalos de 5 minutos.</p></div>}
                </div>
                 <div className="grid gap-2">
                    <Label>Foto del servicio (Opcional)</Label>
                    <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-md bg-secondary flex items-center justify-center overflow-hidden flex-shrink-0">
                             {photoPreview ? (
                                <Image src={photoPreview} alt="Vista previa" width={80} height={80} className="object-contain bg-secondary/40 h-full w-full" />
                            ) : (
                                <ImageIcon className="w-8 h-8 text-muted-foreground" />
                            )}
                        </div>
                        <div className="grid gap-1.5">
                            <Input id="photo-upload" type="file" className="hidden" onChange={handlePhotoChange} accept="image/jpeg,image/png,image/webp" disabled={isUploading} />
                            <Button size="sm" type="button" variant="outline" onClick={() => document.getElementById('photo-upload')?.click()} disabled={isUploading}>
                                <Upload className="mr-2 h-4 w-4" />
                                {isUploading ? "Subiendo..." : "Cambiar"}
                            </Button>
                            <p className="text-xs text-muted-foreground">JPG, PNG o WebP · hasta 10 MB; se optimiza automáticamente</p>
                        </div>
                    </div>
                 </div>
                 <div className="grid gap-2">
                     <Label>Estado</Label>
                     {editingService ? (
                        <>
                            <RadioGroup value={status} onValueChange={(value: 'Activo' | 'Pausado') => setStatus(value)} className="flex gap-4">
                                <div>
                                    <RadioGroupItem
                                        value="Activo"
                                        id="r1"
                                        disabled={!hasValidServiceAvailability(editingService.workingHours, duration)}
                                    />
                                    <Label htmlFor="r1" className="ml-2">Activo</Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="Pausado" id="r2" />
                                    <Label htmlFor="r2" className="ml-2">Pausado</Label>
                                </div>
                            </RadioGroup>
                            <p className="text-xs text-muted-foreground">
                                {hasValidServiceAvailability(editingService.workingHours, duration)
                                    ? 'Activo se muestra para nuevas reservas; Pausado lo oculta sin eliminarlo.'
                                    : 'La activación está bloqueada hasta que configures al menos un horario válido.'}
                            </p>
                        </>
                     ) : (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" role="status">
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary">Pausado</Badge>
                                <span className="text-sm font-medium">Se crea sin publicar</span>
                            </div>
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                Después de guardarlo, configurá sus horarios y activalo desde la tarjeta del servicio.
                            </p>
                        </div>
                     )}
                </div>
            </div>
            <OnboardingRequirements requirements={saveAttempted ? formMissing : []} title="Revisá estos datos antes de guardar" live="assertive" />
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="secondary" disabled={isSaving || isUploading}>
                        Cancelar
                    </Button>
                </DialogClose>
                <Button type="button" onClick={handleSaveService} disabled={isSaving || isUploading}>
                    {isSaving || isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSaving ? (isUploading ? 'Subiendo...' : 'Guardando...') : (editingService ? 'Guardar Cambios' : 'Crear y configurar horarios')}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    
    <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
                Esta acción no se puede deshacer. Se eliminará permanentemente el servicio &quot;{serviceToDelete?.name}&quot;.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteService} 
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sí, eliminar servicio
            </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    {serviceForAvailability && (
        <AvailabilitySettingsModal
            isOpen={isAvailabilityModalOpen}
            onOpenChange={setIsAvailabilityModalOpen}
            service={serviceForAvailability}
            onSave={handleSaveAvailability}
            defaultTab={availabilityDefaultTab}
        />
    )}
    </>
  )
}
