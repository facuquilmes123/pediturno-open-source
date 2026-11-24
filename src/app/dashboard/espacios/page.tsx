"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Building2, CirclePause, Clock3, ImageIcon, Loader2, MoreHorizontal, Plus, Settings2, Trash2, Upload, Users } from 'lucide-react';
import ArsPriceInput from '@/components/ArsPriceInput';
import OnboardingRequirements from '@/components/OnboardingRequirements';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useDashboard } from '@/context/DashboardContext';
import { useAuth } from '@/hooks/useAuthRedirect';
import { useToast } from '@/hooks/use-toast';
import { normalizeCanchaPrice } from '@/lib/cancha-validation';
import { resourceErrorMessage } from '@/lib/resource-errors';
import { createSpace, deleteFile, deleteSpace, getSpaces, type NewSpaceData, type Space, type SpaceCategory, type SpacePackage, updateSpace, uploadFile } from '@/services/data';
import SpaceAvailabilityDialog, { validateSpaceAvailability } from './SpaceAvailabilityDialog';

const PACKAGE_OPTIONS = [
  { durationMinutes: 240 as const, label: '4 horas' },
  { durationMinutes: 480 as const, label: '8 horas' },
  { durationMinutes: 720 as const, label: '12 horas' },
  { durationMinutes: 1440 as const, label: 'Jornada completa (24 h)' },
];

const CATEGORIES: Array<{ value: SpaceCategory; label: string }> = [
  { value: 'salon', label: 'Salón de eventos' },
  { value: 'quincho', label: 'Quincho' },
  { value: 'sum', label: 'SUM' },
  { value: 'quinta', label: 'Casa quinta' },
  { value: 'terraza', label: 'Terraza' },
  { value: 'jardin', label: 'Jardín' },
  { value: 'auditorio', label: 'Auditorio' },
  { value: 'capacitacion', label: 'Sala de capacitación' },
  { value: 'estudio_fotografico', label: 'Estudio fotográfico' },
  { value: 'otro', label: 'Otro espacio' },
];

const emptyPrices = (): Record<number, string> => ({ 240: '', 480: '', 720: '', 1440: '' });

function formatMoney(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(amount) : `$ ${value}`;
}

function formatMinutes(minutes: number) {
  if (minutes === 1440) return 'Jornada completa';
  return `${minutes / 60} h`;
}

function isReady(space: Space) {
  return validateSpaceAvailability(space, space.workingHours || {}) === null;
}

export default function EspaciosPage() {
  const { user } = useAuth();
  const { refetchProfileAndServices } = useDashboard();
  const { toast } = useToast();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [editing, setEditing] = useState<Space | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<Space | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Space | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<SpaceCategory>('salon');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState('');
  const [selectedPackages, setSelectedPackages] = useState<number[]>([240]);
  const [packagePrices, setPackagePrices] = useState<Record<number, string>>(emptyPrices);
  const [preparationMinutes, setPreparationMinutes] = useState('0');
  const [cleanupMinutes, setCleanupMinutes] = useState('0');
  const [useGlobalBuffer, setUseGlobalBuffer] = useState(true);
  const [bookingBufferMinutes, setBookingBufferMinutes] = useState('0');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setSpaces(await getSpaces(user.uid));
      await refetchProfileAndServices();
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudieron cargar los espacios', description: resourceErrorMessage(error, 'Recargá la página e intentá nuevamente.') });
    } finally {
      setLoading(false);
    }
  }, [refetchProfileAndServices, toast, user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  const packages = useMemo(() => selectedPackages.map((durationMinutes) => ({
    durationMinutes: durationMinutes as SpacePackage['durationMinutes'],
    price: normalizeCanchaPrice(packagePrices[durationMinutes]) || '',
  })), [packagePrices, selectedPackages]);

  const formMissing = [
    ...(name.trim().length < 2 || name.trim().length > 80 ? ['El nombre debe tener entre 2 y 80 caracteres.'] : []),
    ...(selectedPackages.length === 0 ? ['Elegí al menos un paquete de duración.'] : []),
    ...selectedPackages.filter((duration) => !normalizeCanchaPrice(packagePrices[duration])).map((duration) => `Ingresá un precio válido para ${formatMinutes(duration)}.`),
    ...(capacity && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1 || Number(capacity) > 10000) ? ['La capacidad debe ser un número entre 1 y 10.000 personas.'] : []),
    ...([preparationMinutes, cleanupMinutes, ...(useGlobalBuffer ? [] : [bookingBufferMinutes])].some((value) => !/^\d+$/.test(value) || Number(value) < 0 || Number(value) > 240 || Number(value) % 10 !== 0) ? ['Preparación, limpieza y pausa deben estar entre 0 y 240 minutos, en intervalos de 10.'] : []),
  ];

  const resetForm = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setEditing(null); setName(''); setCategory('salon'); setDescription(''); setCapacity('');
    setSelectedPackages([240]); setPackagePrices(emptyPrices()); setPreparationMinutes('0'); setCleanupMinutes('0');
    setUseGlobalBuffer(true); setBookingBufferMinutes('0'); setPhotoFile(null); setPhotoPreview(null); setSaveAttempted(false);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };
  const openEdit = (space: Space) => {
    resetForm(); setEditing(space); setName(space.name); setCategory(space.category); setDescription(space.description || '');
    setCapacity(space.capacity ? String(space.capacity) : ''); setSelectedPackages(space.packages.map((item) => item.durationMinutes));
    setPackagePrices(space.packages.reduce((result, item) => ({ ...result, [item.durationMinutes]: item.price }), emptyPrices()));
    setPreparationMinutes(String(space.preparationMinutes || 0)); setCleanupMinutes(String(space.cleanupMinutes || 0));
    setUseGlobalBuffer(space.bookingBufferMinutes == null); setBookingBufferMinutes(String(space.bookingBufferMinutes || 0));
    setPhotoPreview(space.photo || null); setDialogOpen(true);
  };

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'Imagen no compatible', description: 'Elegí una imagen JPG, PNG o WebP de hasta 10 MB.' });
      event.currentTarget.value = '';
      return;
    }
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = URL.createObjectURL(file);
    setPhotoFile(file); setPhotoPreview(previewUrlRef.current);
  };

  const saveSpace = async () => {
    setSaveAttempted(true);
    if (!user || formMissing.length > 0) return;
    setSaving(true);
    let uploadedPhoto: string | undefined;
    try {
      uploadedPhoto = photoFile ? await uploadFile(photoFile, 'spaces') : undefined;
      const data: NewSpaceData = {
        businessId: user.uid,
        name: name.trim(), category, description: description.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
        packages,
        preparationMinutes: Number(preparationMinutes), cleanupMinutes: Number(cleanupMinutes),
        bookingBufferMinutes: useGlobalBuffer ? null : Number(bookingBufferMinutes),
        status: editing?.status || 'Pausado',
        photo: uploadedPhoto || editing?.photo,
        photos: uploadedPhoto ? [uploadedPhoto, ...(editing?.photos || []).filter((url) => url !== editing?.photo)].slice(0, 8) : editing?.photos,
        workingHours: editing?.workingHours,
        unavailableDates: editing?.unavailableDates,
      };
      if (editing) await updateSpace(editing.id, data);
      else await createSpace(data);
      if (uploadedPhoto && editing?.photo && editing.photo !== uploadedPhoto) await deleteFile(editing.photo);
      setDialogOpen(false); resetForm(); await load();
      toast({ title: editing ? 'Espacio actualizado' : 'Espacio creado', description: editing ? 'Los cambios ya están guardados.' : 'Ahora configurá los horarios antes de publicarlo.' });
    } catch (error) {
      if (uploadedPhoto) await deleteFile(uploadedPhoto);
      toast({ variant: 'destructive', title: 'No se pudo guardar el espacio', description: resourceErrorMessage(error, 'Revisá los datos e intentá nuevamente.') });
    } finally {
      setSaving(false);
    }
  };

  const saveAvailability = async (spaceId: string, data: { workingHours: Space['workingHours']; unavailableDates: Date[] }) => {
    try {
      await updateSpace(spaceId, data);
      await load();
      toast({ title: 'Disponibilidad guardada', description: 'Revisá el estado del espacio y activalo cuando esté listo.' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar la disponibilidad', description: resourceErrorMessage(error, 'Intentá nuevamente.') });
      throw error;
    }
  };

  const toggleStatus = async (space: Space) => {
    const next = space.status === 'Activo' ? 'Pausado' : 'Activo';
    if (next === 'Activo' && !isReady(space)) {
      setAvailabilityTarget(space); setAvailabilityOpen(true);
      toast({ variant: 'destructive', title: 'Falta configurar la disponibilidad', description: validateSpaceAvailability(space, space.workingHours || {}) || '' });
      return;
    }
    setUpdatingStatusId(space.id);
    try {
      await updateSpace(space.id, { status: next }); await load();
      toast({ title: next === 'Activo' ? 'Espacio publicado' : 'Espacio pausado' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo cambiar el estado', description: resourceErrorMessage(error, 'Intentá nuevamente.') });
    } finally { setUpdatingStatusId(null); }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSpace(deleteTarget.id);
      if (deleteTarget.photo) await deleteFile(deleteTarget.photo);
      setDeleteTarget(null); await load(); toast({ title: 'Espacio eliminado' });
    } catch (error) {
      const active = error instanceof Error && error.message === 'SPACE_HAS_ACTIVE_RESERVATIONS';
      toast({ variant: 'destructive', title: active ? 'No se puede eliminar este espacio' : 'No se pudo eliminar', description: active ? 'Tiene reservas activas. Cancelalas o completalas antes de eliminarlo.' : resourceErrorMessage(error, 'Intentá nuevamente.') });
    } finally { setDeleting(false); }
  };

  const onboardingMissing = spaces.length === 0 ? ['Creá al menos un espacio.'] : spaces.some((space) => space.status === 'Activo' && isReady(space)) ? [] : ['Configurá horarios válidos y activá al menos un espacio.'];

  return (
    <>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div><h1 className="text-2xl font-bold tracking-tight">Tus espacios</h1><p className="text-muted-foreground">Gestioná salones, quinchos, quintas y otros lugares que se reservan por bloques largos.</p></div>
          <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Agregar espacio</Button>
        </header>
        <OnboardingRequirements requirements={onboardingMissing} title="Para completar este paso" />
        <Card>
          <CardHeader><CardTitle>Espacios publicados</CardTitle><CardDescription>Cada espacio puede tener paquetes, preparación, limpieza y una pausa propia entre reservas.</CardDescription></CardHeader>
          <CardContent>
            {loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-64" />)}</div> : spaces.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center text-center"><Building2 className="mb-3 h-10 w-10 text-muted-foreground" /><h2 className="font-semibold">Todavía no agregaste espacios</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Creá el primero, definí sus paquetes y después configurá cuándo se puede reservar.</p><Button className="mt-4" onClick={openCreate}>Crear mi primer espacio</Button></div>
            ) : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{spaces.map((space) => {
              const ready = isReady(space);
              return <Card key={space.id} className="overflow-hidden">
                <div className="relative aspect-[16/9] bg-secondary">{space.photo ? <Image src={space.photo} alt={space.name} fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" /> : <div className="flex h-full items-center justify-center"><ImageIcon className="h-10 w-10 text-muted-foreground" /></div>}</div>
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">{space.name}</CardTitle><CardDescription>{CATEGORIES.find((item) => item.value === space.category)?.label}</CardDescription></div><Badge variant={space.status === 'Activo' ? 'default' : 'secondary'}>{space.status}</Badge></div></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {space.capacity && <div className="flex items-center gap-2 text-muted-foreground"><Users className="h-4 w-4" />Hasta {space.capacity} personas</div>}
                  <div className="space-y-1">{space.packages.map((item) => <div key={item.durationMinutes} className="flex justify-between gap-3"><span>{formatMinutes(item.durationMinutes)}</span><strong>{formatMoney(item.price)}</strong></div>)}</div>
                  <div className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground"><Clock3 className="mr-1 inline h-3.5 w-3.5" />Preparación {space.preparationMinutes} min · Limpieza {space.cleanupMinutes} min · Pausa {space.bookingBufferMinutes == null ? 'general' : `${space.bookingBufferMinutes} min`}</div>
                  {space.status === 'Pausado' && <p className={`rounded-md border p-2 text-xs ${ready ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>{ready ? 'Horarios listos. Activá el espacio para publicarlo.' : 'Configurá una franja que permita reservar todos sus paquetes.'}</p>}
                </CardContent>
                <CardFooter><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="w-full"><MoreHorizontal className="mr-2 h-4 w-4" />Acciones</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60"><DropdownMenuLabel>Administrar espacio</DropdownMenuLabel><DropdownMenuItem onClick={() => openEdit(space)}><Building2 className="mr-2 h-4 w-4" />Editar datos y paquetes</DropdownMenuItem><DropdownMenuItem onClick={() => { setAvailabilityTarget(space); setAvailabilityOpen(true); }}><Settings2 className="mr-2 h-4 w-4" />Disponibilidad y bloqueos</DropdownMenuItem><DropdownMenuItem disabled={updatingStatusId === space.id} onClick={() => toggleStatus(space)}>{updatingStatusId === space.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CirclePause className="mr-2 h-4 w-4" />}{space.status === 'Activo' ? 'Pausar espacio' : 'Activar espacio'}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(space)}><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem></DropdownMenuContent></DropdownMenu></CardFooter>
              </Card>;
            })}</div>}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) { setDialogOpen(open); if (!open) resetForm(); } }}>
        <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? 'Editar espacio' : 'Agregar espacio'}</DialogTitle><DialogDescription>Configurá lo que alquilás y los bloques que podrán elegir tus clientes. Se crea pausado hasta que definas sus horarios.</DialogDescription></DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="space-name">Nombre del espacio</Label><Input id="space-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-invalid={saveAttempted && (name.trim().length < 2 || name.trim().length > 80)} placeholder="Ej: Salón Magnolia" /></div><div className="space-y-2"><Label htmlFor="space-category">Tipo de espacio</Label><Select value={category} onValueChange={(value) => setCategory(value as SpaceCategory)}><SelectTrigger id="space-category"><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div></div>
            <div className="space-y-2"><Label htmlFor="space-description">Descripción breve</Label><Textarea id="space-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="Contá qué incluye, para qué eventos es ideal y cualquier condición importante." /><p className="text-right text-xs text-muted-foreground">{description.length}/500</p></div>
            <div className="space-y-2"><Label htmlFor="space-capacity">Capacidad máxima (opcional)</Label><Input id="space-capacity" type="number" min={1} max={10000} value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="Ej: 120" /></div>
            <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 font-semibold">Paquetes disponibles</legend><p className="text-sm text-muted-foreground">Elegí uno o más bloques y definí el precio final de cada uno.</p>{PACKAGE_OPTIONS.map((option) => { const selected = selectedPackages.includes(option.durationMinutes); return <div key={option.durationMinutes} className="grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-[auto_1fr_220px] sm:items-center"><Switch id={`package-${option.durationMinutes}`} checked={selected} onCheckedChange={(checked) => setSelectedPackages((current) => checked ? [...current, option.durationMinutes].sort((a, b) => a - b) : current.filter((value) => value !== option.durationMinutes))} /><Label htmlFor={`package-${option.durationMinutes}`}>{option.label}</Label><ArsPriceInput id={`package-price-${option.durationMinutes}`} value={packagePrices[option.durationMinutes]} onValueChange={(value) => setPackagePrices((current) => ({ ...current, [option.durationMinutes]: value }))} disabled={!selected} aria-invalid={saveAttempted && selected && !normalizeCanchaPrice(packagePrices[option.durationMinutes])} placeholder="Precio ARS" /></div>; })}</fieldset>
            <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="space-preparation">Preparación previa</Label><Input id="space-preparation" type="number" min={0} max={240} step={10} value={preparationMinutes} onChange={(event) => setPreparationMinutes(event.target.value)} /><p className="text-xs text-muted-foreground">Minutos bloqueados antes.</p></div><div className="space-y-2"><Label htmlFor="space-cleanup">Limpieza posterior</Label><Input id="space-cleanup" type="number" min={0} max={240} step={10} value={cleanupMinutes} onChange={(event) => setCleanupMinutes(event.target.value)} /><p className="text-xs text-muted-foreground">Minutos bloqueados después.</p></div><div className="space-y-2"><Label htmlFor="space-buffer">Pausa adicional</Label><div className="flex items-center gap-2"><Switch id="space-buffer-global" checked={useGlobalBuffer} onCheckedChange={setUseGlobalBuffer} /><Label htmlFor="space-buffer-global" className="text-xs">Usar pausa general</Label></div><Input id="space-buffer" type="number" min={0} max={240} step={10} value={bookingBufferMinutes} onChange={(event) => setBookingBufferMinutes(event.target.value)} disabled={useGlobalBuffer} /></div></div>
            <p className="-mt-3 text-xs text-muted-foreground">Estos tiempos se configuran en intervalos de 10 minutos para calcular disponibilidad precisa.</p>
            <div className="space-y-2"><Label>Foto de portada</Label><div className="flex items-center gap-4"><div className="relative h-24 w-32 overflow-hidden rounded-lg bg-secondary">{photoPreview ? <Image src={photoPreview} alt="Vista previa" fill className="object-cover" /> : <ImageIcon className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground" />}</div><div><Input id="space-photo" className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} /><Button type="button" variant="outline" onClick={() => document.getElementById('space-photo')?.click()}><Upload className="mr-2 h-4 w-4" />Elegir imagen</Button><p className="mt-1 text-xs text-muted-foreground">Se adapta automáticamente a distintos dispositivos.</p></div></div></div>
          </div>
          <OnboardingRequirements requirements={saveAttempted ? formMissing : []} title="Revisá estos datos antes de guardar" live="assertive" />
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={saveSpace} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? 'Guardar cambios' : 'Crear y configurar horarios'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <SpaceAvailabilityDialog open={availabilityOpen} onOpenChange={setAvailabilityOpen} space={availabilityTarget} onSave={saveAvailability} />
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>Se quitará definitivamente. Las reservas activas impiden eliminarlo.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Eliminar espacio</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  );
}
