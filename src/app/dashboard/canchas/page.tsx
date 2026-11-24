"use client"
import { validateReservableWorkingHours } from '@/lib/cancha-validation';
import ArsPriceInput from '@/components/ArsPriceInput';
import OnboardingRequirements from '@/components/OnboardingRequirements';
import { getResourceOnboardingMissingRequirements } from '@/lib/onboarding-requirements';
import { resourceErrorMessage } from '@/lib/resource-errors';

import { useState, useEffect, useCallback, useRef } from "react"
import { useDashboard } from "@/context/DashboardContext";
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
import { MoreHorizontal, PlusCircle, Loader2, Upload, Image as ImageIcon, Briefcase, Trash2, Settings, Clock, CirclePause } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import { 
    getCanchas, 
    Cancha,
    createCancha,
    updateCancha,
    deleteCancha,
    NewCanchaData,
    CANCHA_DURATIONS,
    CANCHA_SPORTS,
    normalizeCanchaPrice,
    uploadFile,
    deleteFile,
    WorkingHours,
    validateWorkingHours,
} from "@/services/data"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from '@/components/ui/switch';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const hasValidCanchaAvailability = (workingHours?: WorkingHours, duration?: unknown) =>
  validateReservableWorkingHours(workingHours, duration) === null;

function uploadErrorDescription(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : '';
  return message && message.length <= 280 ? message : fallback;
}

function formatArsPrice(price: string) {
  const amount = Number(price);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(amount)
    : `$ ${price}`;
}

export default function CanchasPage() {
  const { user } = useAuth();
  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Cancha Create/Edit Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editingCancha, setEditingCancha] = useState<Cancha | null>(null);

  // Availability Settings Modal
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);
  const [canchaForAvailability, setCanchaForAvailability] = useState<Cancha | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [useGlobalBuffer, setUseGlobalBuffer] = useState(true);
  const [bookingBufferMinutes, setBookingBufferMinutes] = useState("0");
  const [saveAttempted, setSaveAttempted] = useState(false);
  const { refetchProfileAndServices } = useDashboard();
  const formMissing = [
    ...(name.trim().length < 2 || name.trim().length > 80 ? ['El nombre debe tener entre 2 y 80 caracteres.'] : []),
    ...(!normalizeCanchaPrice(price) ? ['Ingresá un precio mayor a 0, con hasta dos decimales (máximo $10.000.000).'] : []),
    ...(!useGlobalBuffer && (!/^\d+$/.test(bookingBufferMinutes) || Number(bookingBufferMinutes) < 0 || Number(bookingBufferMinutes) > 240 || Number(bookingBufferMinutes) % 5 !== 0) ? ['La pausa entre reservas debe estar entre 0 y 240 minutos, en intervalos de 5.'] : []),
  ];
  const [duration, setDuration] = useState(60);
  const [sport, setSport] = useState<NonNullable<NewCanchaData['sport']>>('futbol');
  const [status, setStatus] = useState<'Activo' | 'Pausado'>('Pausado');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const openAvailabilityAfterCanchaDialogCloseRef = useRef(false);
  
  // Deletion state
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [canchaToDelete, setCanchaToDelete] = useState<Cancha | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const { toast } = useToast();

  const revokePhotoPreview = () => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  };

  useEffect(() => () => revokePhotoPreview(), []);

  const loadCanchas = useCallback(async (throwOnError = false) => {
    if (!user) return;
    try {
      setIsLoading(true);
      const fetchedCanchas = await getCanchas(user.uid);
      setCanchas(fetchedCanchas);
      await refetchProfileAndServices();
    } catch (error) {
      console.error("Failed to fetch canchas:", error);
      if (!throwOnError) {
        toast({
            variant: "destructive",
            title: "Error",
            description: "No se pudieron cargar las canchas.",
        });
      }
      if (throwOnError) throw error;
    } finally {
      setIsLoading(false);
    }
  }, [user, toast, refetchProfileAndServices]);

  useEffect(() => {
    loadCanchas();
  }, [loadCanchas]);

  const resetForm = () => {
      setSaveAttempted(false);
      revokePhotoPreview();
      setName("");
      setPrice("");
      setUseGlobalBuffer(true);
      setBookingBufferMinutes("0");
      setDuration(60);
      setSport('futbol');
      setStatus("Pausado");
      setPhotoPreview(null);
      setPhotoFile(null);
      setEditingCancha(null);
  }
  
  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
        toast({
            variant: "destructive",
            title: "Formato no compatible",
            description: "Usá una imagen JPG, PNG o WebP.",
        });
        event.currentTarget.value = '';
        return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
        toast({
            variant: "destructive",
            title: "Imagen demasiado grande",
            description: "La imagen debe pesar entre 1 byte y 10 MB.",
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

  const handleOpenEditModal = (cancha: Cancha) => {
    revokePhotoPreview();
    setEditingCancha(cancha);
    setName(cancha.name);
    setPrice(cancha.price);
    setUseGlobalBuffer(cancha.bookingBufferMinutes == null);
    setBookingBufferMinutes(String(cancha.bookingBufferMinutes || 0));
    setDuration(cancha.duration || 60);
    setSport(cancha.sport || 'otro');
    setStatus(cancha.status);
    setPhotoPreview(cancha.photo || null);
    setPhotoFile(null); // Reset file input
    setIsModalOpen(true);
  };

  const handleOpenAvailabilityModal = (cancha: Cancha) => {
    setCanchaForAvailability(cancha);
    setIsAvailabilityModalOpen(true);
  };
  
  const openDeleteDialog = (cancha: Cancha) => {
    setCanchaToDelete(cancha);
    setIsDeleteAlertOpen(true);
  };

  const handleStatusChange = async (cancha: Cancha) => {
    const nextStatus = cancha.status === 'Activo' ? 'Pausado' : 'Activo';
    if (nextStatus === 'Activo' && !hasValidCanchaAvailability(cancha.workingHours, cancha.duration)) {
      toast({
        title: 'Configurá los horarios',
        description: 'Definí al menos un día y horario válido antes de activar esta cancha.',
      });
      handleOpenAvailabilityModal(cancha);
      return;
    }
    setUpdatingStatusId(cancha.id);
    try {
      await updateCancha(cancha.id, { status: nextStatus });
      toast({
        title: nextStatus === 'Activo' ? 'Cancha activada' : 'Cancha pausada',
        description: nextStatus === 'Activo'
          ? 'Ya puede recibir nuevas reservas en tu página pública.'
          : 'Dejó de mostrarse para nuevas reservas. Las existentes se conservan.',
      });
      await loadCanchas();
    } catch (error) {
      console.error('Failed to update cancha status:', error);
      toast({
        variant: 'destructive',
        title: 'No se pudo actualizar el estado de la cancha.',
        description: uploadErrorDescription(error, 'Revisá la disponibilidad e intentá nuevamente.'),
      });
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const handleSaveCancha = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "No estás autenticado." });
      return;
    }
    const normalizedPrice = normalizeCanchaPrice(price);
    setSaveAttempted(true);
    if (formMissing.length > 0) {
      toast({ variant: "destructive", title: "Faltan datos", description: formMissing.join(" ") });
      return;
    }
    if (editingCancha && status === 'Activo' && !hasValidCanchaAvailability(editingCancha.workingHours, duration)) {
      toast({
        variant: "destructive",
        title: "Falta disponibilidad",
        description: "Definí al menos un horario antes de activar esta cancha.",
      });
      return;
    }

    setIsSaving(true);
    let finalPhotoUrl = editingCancha?.photo;
    let uploadedPhotoUrl: string | undefined;
    let persisted = false;

    // 1. Handle Photo Upload if a new file is selected
    if (photoFile) {
      setIsUploading(true);
      try {
        // Upload first. The existing image stays in place until Firestore
        // points at the replacement successfully.
        uploadedPhotoUrl = await uploadFile(photoFile, 'canchas');
        finalPhotoUrl = uploadedPhotoUrl;
      } catch (error) {
        console.error("Failed to upload photo:", error);
        toast({
          variant: "destructive",
          title: "Error al subir",
          description: uploadErrorDescription(error, "No se pudo subir la imagen de la cancha."),
        });
        setIsSaving(false);
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    // 2. Prepare cancha data
    const canchaData: Partial<NewCanchaData> & { businessId: string } = {
      name: name.trim(),
      price: normalizedPrice!,
      duration,
      status: editingCancha ? status : 'Pausado',
      businessId: user.uid,
      sport,
      bookingBufferMinutes: useGlobalBuffer ? null : Number(bookingBufferMinutes),
    };

    if (finalPhotoUrl && (!editingCancha || uploadedPhotoUrl)) {
      canchaData.photo = finalPhotoUrl;
    }

    // 3. Save data to Firestore
    try {
      if (editingCancha) {
        await updateCancha(editingCancha.id, canchaData);
        persisted = true;
        toast({ title: "¡Éxito!", description: "La cancha ha sido actualizada." });
      } else {
        const canchaId = await createCancha(canchaData as NewCanchaData);
        persisted = true;
        const createdCancha = { ...canchaData, id: canchaId } as Cancha;
        toast({ title: "Cancha creada en pausa", description: "Ahora configurá sus horarios. Cuando haya disponibilidad válida, vas a poder activarla." });
        setCanchaForAvailability(createdCancha);
        openAvailabilityAfterCanchaDialogCloseRef.current = true;
      }

      if (uploadedPhotoUrl && editingCancha?.photo && editingCancha.photo !== uploadedPhotoUrl) {
        await deleteFile(editingCancha.photo);
      }

      setIsModalOpen(false);
      resetForm();
      await loadCanchas(true); // Refresh the list

    } catch (error) {
      if (uploadedPhotoUrl && !persisted) await deleteFile(uploadedPhotoUrl);
      console.error("Failed to save cancha:", error);
      if (persisted) {
        toast({
          variant: 'destructive',
          title: 'Cambios guardados',
          description: 'La cancha se guardó, pero no se pudo actualizar el listado. Recargá la página para ver los datos actuales.',
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: uploadErrorDescription(error, `No se pudo ${editingCancha ? 'actualizar' : 'crear'} la cancha.`),
        });
      }
    } finally {
      setIsSaving(false);
    }
  }

    const handleSaveAvailability = async (
        canchaId: string,
        dataToSave: {
            workingHours?: WorkingHours,
            unavailableDates?: Date[]
        }
    ) => {
        const availabilityError = validateWorkingHours(
            dataToSave.workingHours,
            canchaForAvailability?.status === 'Activo',
        );
        if (canchaForAvailability?.status === 'Activo' && availabilityError) {
            toast({
                variant: 'destructive',
                title: 'La cancha activa necesita horarios',
                description: 'Configurá al menos un día y horario válido, o pausá la cancha antes de guardar.',
            });
            return;
        }
        try {
            await updateCancha(canchaId, dataToSave);
            toast({
                title: '¡Éxito!',
                description: 'Los horarios para esta cancha se han actualizado.',
            });
            setIsAvailabilityModalOpen(false);
            await loadCanchas();
        } catch (error) {
            console.error("Failed to save availability:", error);
            toast({
                variant: 'destructive',
                title: 'Error al guardar',
                description: 'No se pudo actualizar la disponibilidad de la cancha.',
            });
        }
    };
  
  const handleDeleteCancha = async () => {
    if (!canchaToDelete || !canchaToDelete.id || !user) return;
    
    setIsDeleting(true);
    try {
      // The server transaction checks current and legacy reservations before
      // deletion, closing the race with a new public booking.
      await deleteCancha(canchaToDelete.id);
      if (canchaToDelete.photo) await deleteFile(canchaToDelete.photo).catch(() => {
        console.warn('[cancha image cleanup] La cancha fue eliminada; queda pendiente limpiar su imagen.');
      });

      toast({
        title: "¡Éxito!",
        description: "La cancha ha sido eliminada exitosamente.",
      });

      await loadCanchas();
    } catch (error) {
      console.error("Failed to delete cancha:", error);
      const hasReservations = error instanceof Error && error.message === 'CANCHA_HAS_ACTIVE_RESERVATIONS';
      toast({
        variant: "destructive",
        title: hasReservations ? "No se puede eliminar esta cancha" : "Error",
        description: hasReservations
          ? "Tiene reservas vigentes o de hoy. Pausala para ocultarla de nuevas reservas y conservá las reservas existentes."
          : "No se pudo eliminar la cancha."
      });
    } finally {
      setIsDeleting(false);
      setIsDeleteAlertOpen(false);
      setCanchaToDelete(null);
    }
  };

  return (
    <>
    <div className="flex flex-col gap-6">
       <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-secondary rounded-full">
                    <Briefcase className="h-6 w-6 text-foreground"/>
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Tus Canchas</h1>
                    <p className="text-muted-foreground">
                    Agrega, edita y configura la disponibilidad de tus canchas.
                    </p>
                </div>
            </div>
        </div>
      <OnboardingRequirements requirements={getResourceOnboardingMissingRequirements(canchas, 'cancha')} title="Para completar este paso" />
      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
                <CardTitle>Listado de Canchas</CardTitle>
                <CardDescription>
                    Desde aquí puedes gestionar tus canchas y su disponibilidad horaria individual.
                </CardDescription>
            </div>
            <Button size="sm" onClick={() => { resetForm(); setIsModalOpen(true); }}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Agregar Cancha
            </Button>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Card key={i}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>
                    ))}
                 </div>
            ) : canchas.length > 0 ? (
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {canchas.map((cancha) => {
                        const availabilityReady = hasValidCanchaAvailability(cancha.workingHours, cancha.duration);
                        return (
                         <Card key={cancha.id} className="flex flex-col">
                            <CardHeader className="flex-row gap-4 items-start pb-4">
                                <div className="flex-shrink-0">
                                    {cancha.photo ? (
                                        <Image src={cancha.photo} alt={cancha.name} width={64} height={64} className="rounded-lg object-contain bg-secondary/40 h-16 w-16" />
                                    ) : (
                                        <div className="h-16 w-16 rounded-lg bg-secondary flex items-center justify-center">
                                            <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-grow">
                                    <h3 className="font-semibold text-base line-clamp-2">{cancha.name}</h3>
                                    <Badge variant={cancha.status === 'Activo' ? 'default' : 'secondary'} className="mt-1">
                                        {cancha.status}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-grow space-y-2 text-sm">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <span>{formatArsPrice(cancha.price)} por turno</span>
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Clock className="h-4 w-4 flex-shrink-0" />
                                    <span>{cancha.duration} minutos</span>
                                </div>
                                {cancha.status === 'Pausado' && (
                                    <div className={`rounded-lg border px-3 py-2 text-xs ${
                                        availabilityReady
                                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                                            : 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                                    }`}>
                                        {availabilityReady
                                            ? 'Los horarios están listos. Activá la cancha para publicarla.'
                                            : 'Todavía no se publica: primero configurá al menos un horario.'}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="p-4 border-t">
                                 <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button aria-haspopup="true" size="sm" variant="outline" className="w-full">
                                            <MoreHorizontal className="h-4 w-4 mr-2" />
                                            Acciones
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuLabel>Acciones de la Cancha</DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => handleOpenEditModal(cancha)}>
                                            <Briefcase className="mr-2 h-4 w-4" />
                                            Editar Cancha
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleOpenAvailabilityModal(cancha)}>
                                           <Settings className="mr-2 h-4 w-4" />
                                           Ajustes de Disponibilidad
                                        </DropdownMenuItem>
                                        <DropdownMenuItem disabled={updatingStatusId === cancha.id} onClick={() => handleStatusChange(cancha)}>
                                           {updatingStatusId === cancha.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CirclePause className="mr-2 h-4 w-4" />}
                                           {cancha.status === 'Activo' ? 'Pausar cancha' : 'Activar cancha'}
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => openDeleteDialog(cancha)}>
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
                    <h3 className="font-semibold">No has agregado ninguna cancha todavía.</h3>
                    <p className="text-muted-foreground text-sm mt-1">Empieza por crear tu primera cancha para tus clientes.</p>
                </div>
            )}
        </CardContent>
      </Card>
    </div>

    <Dialog open={isModalOpen} onOpenChange={(open) => {
        if (!isSaving) { // Don't close modal if it's saving
            if (!open) resetForm();
            setIsModalOpen(open);
        }
    }}>
        <DialogContent
            className="sm:max-w-[425px]"
            onCloseAutoFocus={(event) => {
                if (!openAvailabilityAfterCanchaDialogCloseRef.current) return;
                event.preventDefault();
                openAvailabilityAfterCanchaDialogCloseRef.current = false;
                setIsAvailabilityModalOpen(true);
            }}
        >
            <DialogHeader>
                <DialogTitle>{editingCancha ? 'Editar Cancha' : 'Agregar Nueva Cancha'}</DialogTitle>
                <DialogDescription>
                    {editingCancha ? 'Modifica los detalles de la cancha.' : 'Creala pausada, configurá sus horarios y activala cuando esté lista para recibir reservas.'}
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label htmlFor="name">Nombre de la Cancha</Label>
                    <Input id="name" minLength={2} maxLength={80} aria-invalid={saveAttempted && (name.trim().length < 2 || name.trim().length > 80)} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Cancha 1 (Pádel)" />
                </div>
                 <div className="grid gap-2">
                    <Label htmlFor="price">Precio por turno (ARS)</Label>
                    <ArsPriceInput id="price" value={price} onValueChange={setPrice} aria-invalid={saveAttempted && !normalizeCanchaPrice(price)} placeholder="Ej: 100.000" />
                </div>
                 <div className="grid gap-2">
                    <Label htmlFor="duration">Duración del Turno (minutos)</Label>
                    <Select value={String(duration)} onValueChange={(value) => setDuration(Number(value))}>
                        <SelectTrigger id="duration">
                            <SelectValue placeholder="Seleccionar duración" />
                        </SelectTrigger>
                        <SelectContent>
                            {CANCHA_DURATIONS.map((minutes) => (
                              <SelectItem key={minutes} value={String(minutes)}>{minutes} minutos</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                 </div>
                 <div className="grid gap-2">
                    <Label htmlFor="sport">Tipo de espacio</Label>
                    <Select value={sport} onValueChange={(value) => setSport(value as NonNullable<NewCanchaData['sport']>)}>
                        <SelectTrigger id="sport"><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                        <SelectContent>
                            {CANCHA_SPORTS.map((item) => (
                              <SelectItem key={item} value={item}>
                                {{ futbol: 'Fútbol', padel: 'Pádel', tenis: 'Tenis', otro: 'Otro espacio' }[item]}
                              </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                 </div>
                 <div className="grid gap-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div><Label htmlFor="cancha-global-buffer">Pausa entre reservas</Label><p className="text-xs text-muted-foreground">Bloquea ese tiempo después de cada turno.</p></div>
                        <div className="flex items-center gap-2"><Switch id="cancha-global-buffer" checked={useGlobalBuffer} onCheckedChange={setUseGlobalBuffer} /><Label htmlFor="cancha-global-buffer" className="text-xs">Usar ajuste general</Label></div>
                    </div>
                    {!useGlobalBuffer && <div className="grid gap-1"><Label htmlFor="cancha-buffer">Minutos para esta cancha</Label><Input id="cancha-buffer" type="number" min={0} max={240} step={5} value={bookingBufferMinutes} onChange={(event) => setBookingBufferMinutes(event.target.value.replace(/\D/g, ''))} aria-invalid={saveAttempted && (!/^\d+$/.test(bookingBufferMinutes) || Number(bookingBufferMinutes) > 240 || Number(bookingBufferMinutes) % 5 !== 0)} /><p className="text-xs text-muted-foreground">En intervalos de 5 minutos.</p></div>}
                 </div>
                 <div className="grid gap-2">
                    <Label>Foto de la cancha (Opcional)</Label>
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
                            <p className="text-xs text-muted-foreground">JPG, PNG o WebP · hasta 10 MB; se comprime automáticamente</p>
                        </div>
                    </div>
                 </div>
                 <div className="grid gap-2">
                     <Label>Estado</Label>
                     {editingCancha ? (
                        <>
                            <RadioGroup value={status} onValueChange={(value: 'Activo' | 'Pausado') => setStatus(value)} className="flex gap-4">
                                <div>
                                    <RadioGroupItem
                                        value="Activo"
                                        id="r1"
                                        disabled={!hasValidCanchaAvailability(editingCancha.workingHours, duration)}
                                    />
                                    <Label htmlFor="r1" className="ml-2">Activo</Label>
                                </div>
                                <div>
                                    <RadioGroupItem value="Pausado" id="r2" />
                                    <Label htmlFor="r2" className="ml-2">Pausado</Label>
                                </div>
                            </RadioGroup>
                            <p className="text-xs text-muted-foreground">
                                {hasValidCanchaAvailability(editingCancha.workingHours, duration)
                                    ? 'Activo se muestra para nuevas reservas; Pausado la oculta sin eliminarla.'
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
                                Después de guardarla, configurá sus horarios y activala cuando esté lista para recibir reservas.
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
                <Button type="button" onClick={handleSaveCancha} disabled={isSaving || isUploading}>
                    {isSaving || isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSaving ? (isUploading ? 'Subiendo...' : 'Guardando...') : (editingCancha ? 'Guardar Cambios' : 'Crear y configurar horarios')}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    
    <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
            <AlertDialogTitle>¿Estás absolutamente seguro?</AlertDialogTitle>
            <AlertDialogDescription>
                Esta acción no se puede deshacer. Se eliminará permanentemente la cancha &ldquo;{canchaToDelete?.name}&rdquo;.
            </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteCancha} 
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sí, eliminar cancha
            </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    {canchaForAvailability && (
        <AvailabilitySettingsModal
            isOpen={isAvailabilityModalOpen}
            onOpenChange={setIsAvailabilityModalOpen}
            cancha={canchaForAvailability}
            onSave={handleSaveAvailability}
        />
    )}
    </>
  )
}

    
