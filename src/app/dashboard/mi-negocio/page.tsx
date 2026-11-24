

"use client"
import BookingLinkActions from '@/components/BookingLinkActions';

import { getBusinessBookingUrl, getVerticalOrigin, getVerticalFromBusinessType } from "@/lib/verticals"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Upload, Loader2, Check, Navigation, Edit, Trash2, PlusCircle, Link as LinkIcon, Instagram, Facebook, Globe, XIcon, Youtube, Linkedin, Tally1, MapPin, XCircle, Info, Palette, QrCode, UserCircle, Settings, AlertCircle, Sparkles, Maximize2 } from "lucide-react"
import { 
    getBusinessProfile, 
    updateBusinessProfile, 
    BusinessProfile, 
    Address, 
    SocialLink,
    SocialLinkType,
    getBusinessIdBySlug,
    CustomThemeData,
    uploadFile,
    deleteFile,
    Membership,
    FirestoreDate,
} from "@/services/data"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuthRedirect"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import Image from "next/image"
import { themes, ThemeName, themeDetails } from "@/lib/themes";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import dynamic from 'next/dynamic';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import AddressForm from "@/components/AddressForm"
import PhoneInput from "@/components/ui/PhoneInput"
import UnsavedChangesProvider, { useUnsavedChanges } from "@/components/UnsavedChangesProvider"
import { Timestamp } from "firebase/firestore"
import { useDashboard } from "@/context/DashboardContext"
import {
  getProfileOnboardingMissingRequirements,
  hasOnboardingProfileName,
  hasOnboardingProfileSlug,
} from "@/lib/onboarding-requirements"
import OnboardingRequirements from "@/components/OnboardingRequirements"

import { searchAddress, GeocodedAddress } from "@/services/geocoding"

const StaticMap = dynamic(() => import('@/components/StaticMap'), { 
    ssr: false,
    loading: () => <Skeleton className="h-full w-full" />
});

const InteractiveMap = dynamic(() => import('@/components/InteractiveMap'), {
    ssr: false,
    loading: () => <Skeleton className="h-[360px] w-full rounded-lg" />
});

const MapModal = dynamic(() => import('@/components/MapModal'), { ssr: false });
const ThemeCustomizer = dynamic(() => import('@/components/ThemeCustomizer'), { ssr: false });
const QrCodeModal = dynamic(() => import('@/components/QrCodeModal'), { ssr: false });

const PHONE_REGEX = /^\+?\d{10,}$/;
const URL_REGEX = /^(https?:\/\/).*/i;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (se optimiza y comprime automáticamente en el navegador)


const socialLinkOptions: { value: SocialLinkType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'instagram', label: 'Instagram', icon: Instagram },
    { value: 'facebook', label: 'Facebook', icon: Facebook },
    { value: 'website', label: 'Sitio Web', icon: Globe },
    { value: 'tiktok', label: 'TikTok', icon: Tally1 },
    { value: 'x', label: 'X (Twitter)', icon: XIcon },
    { value: 'youtube', label: 'YouTube', icon: Youtube },
    { value: 'linkedin', label: 'LinkedIn', icon: Linkedin },
    { value: 'custom', label: 'Personalizado', icon: LinkIcon },
];

type SlugStatus = 'idle' | 'checking' | 'available' | 'unavailable' | 'invalid';

// Helper to convert Firestore Timestamps to ISO strings for consistent comparison
const convertDatesToISO = (obj: any): any => {
    if (!obj) return obj;
    if (obj instanceof Timestamp) return obj.toDate().toISOString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(convertDatesToISO);
    if (typeof obj === 'object') {
        const newObj: { [key: string]: any } = {};
        for (const key in obj) {
            newObj[key] = convertDatesToISO(obj[key]);
        }
        return newObj;
    }
    return obj;
};

function MiNegocioContent() {
  const { user } = useAuth();
  const { refetchProfileAndServices } = useDashboard();
  const { toast } = useToast();
  
  const [profile, setProfile] = useState<Partial<BusinessProfile>>({});
  const [initialState, setInitialState] = useState<any>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isCustomThemeModalOpen, setIsCustomThemeModalOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  
  const [isWhatsappValid, setIsWhatsappValid] = useState(true);

  const [originalSlug, setOriginalSlug] = useState<string | undefined>(undefined);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [debouncedSlug, setDebouncedSlug] = useState<string | undefined>('');

  const { hasUnsavedChanges, setHasUnsavedChanges } = useUnsavedChanges();

  useEffect(() => {
    if(initialState) {
        const currentProfileForComparison = convertDatesToISO(profile);
        const hasChanged = JSON.stringify(initialState) !== JSON.stringify(currentProfileForComparison);
        setHasUnsavedChanges(hasChanged);
    }
  }, [profile, initialState, setHasUnsavedChanges]);


  const areSocialLinksValid = useMemo(() => {
    return profile.socialLinks?.every(link => !link.url || URL_REGEX.test(link.url));
  }, [profile.socialLinks]);
  const profileOnboardingMissing = useMemo(() => getProfileOnboardingMissingRequirements(profile), [profile]);
  const profileNameMissing = !hasOnboardingProfileName(profile);
  const profileSlugMissing = !hasOnboardingProfileSlug(profile);
  
  const isSaveDisabled = isSaving || isUploading || slugStatus === 'unavailable' || slugStatus === 'checking' || slugStatus === 'invalid' || !areSocialLinksValid || (profile.whatsappButtonEnabled && !isWhatsappValid) || !hasUnsavedChanges;

  const canGenerateQr = !!profile.slug && originalSlug === profile.slug;

  const loadProfile = useCallback(async () => {
    if (!user) return;
    try {
        setIsLoading(true);
        const data = await getBusinessProfile(user.uid);
        const initialProfile: Partial<BusinessProfile> = data ? { ...data } : {
            address: { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' },
            socialLinks: [],
            theme: 'menta',
            customTheme: { primary: '#64CCC9', background: '#F0F0F0', accent: '#548C8A' }
        };

        if (typeof initialProfile.address !== 'object' || initialProfile.address === null) {
            initialProfile.address = { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' };
        }
        if (!initialProfile.socialLinks) initialProfile.socialLinks = [];
        if (!initialProfile.theme) initialProfile.theme = 'menta';
        if (!initialProfile.customTheme) initialProfile.customTheme = { primary: '#64CCC9', background: '#F0F0F0', accent: '#548C8A' };

        setProfile(initialProfile);
        setInitialState(convertDatesToISO(initialProfile));
        setOriginalSlug(initialProfile.slug);
        setDebouncedSlug(initialProfile.slug);
        const initialLogo = initialProfile.logo && !initialProfile.logo.includes('placehold.co') ? initialProfile.logo : null;
        setLogoPreview(initialLogo);

        if (initialProfile?.whatsappNumber) {
          setIsWhatsappValid(PHONE_REGEX.test(initialProfile.whatsappNumber.replace(/\s/g, '')));
        }
    } catch (error) {
        console.error("Failed to load business profile:", error);
        toast({ variant: "destructive", title: "Error", description: "No se pudo cargar el perfil del negocio." });
    } finally {
        setIsLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSlug(profile.slug);
        }, 500);

        return () => {
            clearTimeout(handler);
        };
    }, [profile.slug]);

    useEffect(() => {
        const checkSlug = async () => {
            const cleanSlug = debouncedSlug?.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || '';
            
            if (!cleanSlug) {
                setSlugStatus('idle');
                return;
            }
            if (cleanSlug.length < 3) {
                setSlugStatus('invalid');
                return;
            }
            if (cleanSlug === originalSlug) {
                setSlugStatus('idle');
                return;
            }

            setSlugStatus('checking');
            const businessId = await getBusinessIdBySlug(cleanSlug);
            setSlugStatus(businessId ? 'unavailable' : 'available');
        };

        checkSlug();
    }, [debouncedSlug, originalSlug]);


  useEffect(() => {
      if (profile.whatsappButtonEnabled && profile.whatsappNumber) {
          setIsWhatsappValid(PHONE_REGEX.test(profile.whatsappNumber.replace(/\s/g, '')));
      } else {
          setIsWhatsappValid(true);
      }
  }, [profile.whatsappNumber, profile.whatsappButtonEnabled]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setProfile(prev => ({ ...prev, [id]: value }));
  }, []);
  
  const handlePhoneChange = useCallback((value: string) => {
    setProfile(prev => ({ ...prev, whatsappNumber: value }));
  }, []);

  const handleSlugChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    const cleanSlug = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    setProfile(prev => ({ ...prev, slug: cleanSlug }));
    if (cleanSlug !== debouncedSlug) {
        setSlugStatus('checking');
    }
  }, [debouncedSlug]);
  
  const handleAddressChange = useCallback((address: Address) => {
    setProfile(prev => ({ ...prev, address }));
  }, []);

  const handleSwitchChange = useCallback((checked: boolean) => {
    setProfile(prev => ({ ...prev, whatsappButtonEnabled: checked }));
  }, []);

  const handleThemeChange = useCallback((value: ThemeName | 'custom') => {
    setProfile(prev => ({ ...prev, theme: value }));
    if (value === 'custom') {
      setIsCustomThemeModalOpen(true);
    }
  }, []);

  const handleCustomThemeSave = (newTheme: CustomThemeData) => {
    setProfile(prev => ({...prev, customTheme: newTheme, theme: 'custom' as const }));
    setIsCustomThemeModalOpen(false);
  };

  const handleLogoChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast({ variant: 'destructive', title: 'Formato inválido', description: 'Seleccioná una imagen JPG, PNG o WebP.' });
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        toast({
            variant: "destructive",
            title: "Archivo demasiado grande",
            description: "Por favor, selecciona una imagen de hasta 10 MB.",
        });
        return;
    }
    
    setIsUploading(true);
    try {
        // uploadFile automatically resizes & compresses with Canvas to WebP
        const downloadUrl = await uploadFile(file, 'logos');
        setLogoPreview(downloadUrl);
        setProfile(prev => ({ ...prev, logo: downloadUrl }));
        setHasUnsavedChanges(true);
        
        toast({ 
            title: "¡Imagen optimizada con éxito!", 
            description: "La resolución fue adaptada automáticamente. Recuerda guardar los cambios." 
        });

    } catch(error) {
        console.error("Failed to upload logo:", error);
        toast({ variant: "destructive", title: "Error al subir", description: error instanceof Error ? error.message : "No se pudo procesar la imagen." });
        setLogoPreview(profile.logo || null); // Revert preview on error
    } finally {
        setIsUploading(false);
    }
  }, [profile.logo, toast, setHasUnsavedChanges]);

  const handleRemoveLogo = useCallback(async () => {
    setLogoPreview(null);
    setProfile(prev => ({ ...prev, logo: '' }));
    setHasUnsavedChanges(true);
    toast({ title: "Imagen quitada", description: "Recuerda hacer clic en 'Guardar Cambios' para confirmar." });
  }, [toast, setHasUnsavedChanges]);

  const handleSocialLinkChange = useCallback((index: number, field: keyof SocialLink, value: string) => {
      const newLinks = [...(profile.socialLinks || [])];
      newLinks[index] = { ...newLinks[index], [field]: value };
       if (field === 'type' && value !== 'custom') {
        delete newLinks[index].title; 
      }
      setProfile(prev => ({ ...prev, socialLinks: newLinks }));
  }, [profile.socialLinks]);

  const addSocialLink = useCallback(() => {
      if ((profile.socialLinks?.length || 0) >= 5) {
          toast({ variant: 'destructive', title: 'Límite alcanzado', description: 'Puedes agregar un máximo de 5 links.' });
          return;
      }
      const newLink: SocialLink = { id: Date.now().toString(), type: 'custom', url: '', title: '' };
      setProfile(prev => ({ ...prev, socialLinks: [...(prev.socialLinks || []), newLink] }));
  }, [profile.socialLinks, toast]);

  const removeSocialLink = useCallback((index: number) => {
      const newLinks = [...(profile.socialLinks || [])];
      newLinks.splice(index, 1);
      setProfile(prev => ({ ...prev, socialLinks: newLinks }));
  }, [profile.socialLinks]);
  
  const handleSaveChanges = useCallback(async () => {
    if (!user) return;
    
    if (profile.whatsappButtonEnabled && !isWhatsappValid) {
        toast({ variant: "destructive", title: "Número de WhatsApp inválido", description: "Por favor, corrige el número de WhatsApp antes de guardar." });
        return;
    }
    
    if (slugStatus === 'unavailable' || slugStatus === 'invalid') {
        toast({ variant: "destructive", title: "URL no válida", description: "La URL de la página que elegiste no está disponible o es inválida." });
        return;
    }
     if (profile.socialLinks?.some(link => link.url && !URL_REGEX.test(link.url))) {
        toast({ variant: "destructive", title: "URL de Link inválida", description: "Por favor, corrige las URLs de tus links." });
        return;
    }

    setIsSaving(true);
    try {
        const profileToSave: Partial<BusinessProfile> = { ...profile };
        if (!profile.whatsappButtonEnabled) delete profileToSave.whatsappNumber;
        
        await updateBusinessProfile(user.uid, profileToSave);
        // The saved profile remains valid even if replacing/removing an image fails.
        const previousLogo = initialState?.logo;
        if (typeof previousLogo === 'string' && previousLogo !== profileToSave.logo && previousLogo.includes('firebasestorage')) {
            await deleteFile(previousLogo).catch(() => undefined);
        }
        const missingAfterSave = getProfileOnboardingMissingRequirements(profileToSave);
        toast(missingAfterSave.length > 0
          ? {
              title: "Perfil guardado: faltan datos para completar este paso",
              description: missingAfterSave.join(' '),
            }
          : { title: "¡Éxito!", description: "Tu perfil se ha guardado correctamente y este paso está completo." });
        
        const newInitialState = convertDatesToISO(profileToSave);
        setInitialState(newInitialState);
        setHasUnsavedChanges(false);
        setOriginalSlug(profile.slug);
        
        // Refetch data for the entire dashboard
        refetchProfileAndServices();

    } catch (error: any) {
        console.error("Failed to save changes:", error);
        let description = "No se pudieron guardar los cambios.";
        if (error.message.includes('createdAt')) {
            description = "Error al guardar: el campo 'createdAt' no se puede modificar. Intenta recargar la página.";
        }
        toast({ variant: "destructive", title: "Error", description: description });
    } finally {
        setIsSaving(false);
    }

  }, [user, profile, initialState, isWhatsappValid, toast, slugStatus, setHasUnsavedChanges, refetchProfileAndServices]);
  
  const isFromMapRef = useRef(false);
  const [isGeocodingAddress, setIsGeocodingAddress] = useState(false);
  const [geocodingSuccessMessage, setGeocodingSuccessMessage] = useState<string | null>(null);

  const handleLocationSave = useCallback((location: { lat: number, lng: number }, address?: GeocodedAddress) => {
    isFromMapRef.current = true;
    setProfile(prev => {
        const updated: Partial<BusinessProfile> = { ...prev, location };
        if (address) {
            updated.address = {
                street: address.street || prev.address?.street || '',
                number: address.number || prev.address?.number || '',
                city: address.city || prev.address?.city || '',
                province: address.province || prev.address?.province || '',
                postalCode: address.postalCode || prev.address?.postalCode || '',
                country: address.country || prev.address?.country || 'Argentina',
            };
        }
        return updated;
    });
    setHasUnsavedChanges(true);
    setIsMapModalOpen(false);
    
    if (address && (address.street || address.city)) {
        toast({
            title: "¡Ubicación y Dirección detectadas!",
            description: `Se cargó: ${address.street} ${address.number}, ${address.city}.`,
        });
    } else {
        toast({
            title: "¡Punto fijado!",
            description: "El punto en el mapa se ha colocado correctamente.",
        });
    }
  }, [setHasUnsavedChanges, toast]);

  const handleAddressSaveFromMap = useCallback((address: GeocodedAddress) => {
    isFromMapRef.current = true;
    setProfile(prev => ({
        ...prev,
        address: {
            street: address.street || prev.address?.street || '',
            number: address.number || prev.address?.number || '',
            city: address.city || prev.address?.city || '',
            province: address.province || prev.address?.province || '',
            postalCode: address.postalCode || prev.address?.postalCode || '',
            country: address.country || prev.address?.country || 'Argentina',
        }
    }));
    setHasUnsavedChanges(true);
    if (address.street || address.city) {
        setGeocodingSuccessMessage(`✅ Dirección cargada desde el mapa: ${address.street} ${address.number}, ${address.city}`);
        setTimeout(() => setGeocodingSuccessMessage(null), 6000);
    }
  }, [setHasUnsavedChanges]);

  // Forward geocoding: when user writes in AddressForm, automatically place pin on map!
  useEffect(() => {
    if (isFromMapRef.current) {
      isFromMapRef.current = false;
      return;
    }

    const street = profile.address?.street?.trim();
    const city = profile.address?.city?.trim();
    const number = profile.address?.number?.trim() || '';
    const province = profile.address?.province?.trim() || '';
    const country = profile.address?.country?.trim() || 'Argentina';

    if (!street || !city) return;

    const timer = setTimeout(async () => {
      setIsGeocodingAddress(true);
      const query = `${street} ${number}, ${city}, ${province}, ${country}`;
      const results = await searchAddress(query);
      if (results && results.length > 0) {
        const first = results[0];
        setProfile(prev => ({
          ...prev,
          location: { lat: first.lat, lng: first.lng }
        }));
        setGeocodingSuccessMessage(`📍 Marcador ubicado automáticamente en: ${first.address.street || street} ${first.address.number || number}, ${first.address.city || city}`);
        setTimeout(() => setGeocodingSuccessMessage(null), 6000);
      }
      setIsGeocodingAddress(false);
    }, 900);

    return () => clearTimeout(timer);
  }, [profile.address?.street, profile.address?.number, profile.address?.city, profile.address?.province, profile.address?.country]);

  const slugStatusMessage: { [key in SlugStatus]: { text: string; className: string; icon: React.ReactNode } } = {
        idle: { text: '', className: '', icon: null },
        checking: { text: 'Comprobando disponibilidad...', className: 'text-muted-foreground', icon: <Loader2 className="h-3 w-3 animate-spin"/> },
        available: { text: 'Disponible', className: 'text-green-600 font-medium', icon: <Check className="h-4 w-4"/> },
        unavailable: { text: 'URL no disponible', className: 'text-destructive font-medium', icon: <XCircle className="h-4 w-4"/> },
        invalid: { text: 'Debe tener al menos 3 caracteres', className: 'text-destructive font-medium', icon: <XCircle className="h-4 w-4"/> },
    };
    const currentSlugStatus = slugStatusMessage[slugStatus];

  const getDisabledReason = () => {
    if (isSaving || isUploading || !hasUnsavedChanges) return null;
    if (slugStatus === 'unavailable' || slugStatus === 'invalid') return "La URL de tu página no es disponible o es inválida.";
    if (!areSocialLinksValid) return "Revisa los links adicionales. Asegúrate de que las URLs tengan el formato correcto.";
    if (profile.whatsappButtonEnabled && !isWhatsappValid) return "El número de WhatsApp tiene un formato incorrecto.";
    return null;
  }
  const disabledReason = getDisabledReason();


  if (isLoading || !user) {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div>
                <Skeleton className="h-8 w-48 mb-2" />
                <Skeleton className="h-5 w-64" />
            </div>
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
              <div className="flex items-center gap-4">
                  <Skeleton className="h-20 w-20 rounded-full" />
                  <div className="grid gap-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-9 w-32" />
                      <Skeleton className="h-3 w-40" />
                  </div>
              </div>
              <div className="grid gap-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
              <div className="grid gap-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
              <div className="grid gap-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-20 w-full" /></div>
              <div className="flex justify-start">
                <Skeleton className="h-10 w-36" />
              </div>
          </CardContent>
        </Card>
      </div>
    )
  }
   return (
    <TooltipProvider>
      <div className="flex flex-col gap-8">
           <div className="flex items-center gap-4">
                <div className="p-3 bg-secondary rounded-full">
                    <UserCircle className="h-8 w-8 text-foreground"/>
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Mi Negocio</h1>
                    <p className="text-muted-foreground">Personaliza cómo los clientes ven tu negocio online.</p>
                </div>
            </div>

        <Card>
          <CardHeader>
            <CardTitle>Información del Negocio</CardTitle>
            <CardDescription>
              Esta información se mostrará en tu página de reservas pública.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
              <OnboardingRequirements requirements={profileOnboardingMissing} title="Este paso todavía no está completo" className="rounded-lg p-4 text-sm" />
              <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  {logoPreview ? (
                    <div className="relative w-32 h-24 sm:w-36 sm:h-28 rounded-xl border-2 border-border bg-card/80 p-2 flex items-center justify-center overflow-hidden shadow-sm shrink-0">
                      <Image
                        src={logoPreview}
                        alt="Logo o foto del negocio"
                        width={144}
                        height={112}
                        unoptimized
                        className="max-h-full max-w-full object-contain rounded-lg"
                      />
                    </div>
                  ) : (
                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center bg-muted/40 text-muted-foreground shrink-0">
                      <UserCircle className="h-10 w-10 text-muted-foreground mb-1" />
                      <span className="text-[11px]">Sin imagen</span>
                    </div>
                  )}

                  <div className="space-y-2 flex-grow">
                    <div>
                      <Label htmlFor="logo-upload" className="text-base font-semibold">
                        Logo o Foto de Portada del Negocio
                      </Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sube el logo de tu marca o foto de tu local o canchas. Se adaptará automáticamente para verse impecable en la página pública de reservas.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Input
                        id="logo-upload"
                        type="file"
                        className="hidden"
                        onChange={handleLogoChange}
                        accept="image/jpeg,image/png,image/webp"
                        disabled={isUploading}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => document.getElementById('logo-upload')?.click()}
                        disabled={isUploading}
                        className="shadow-sm"
                      >
                        {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        {isUploading ? 'Procesando...' : logoPreview ? 'Cambiar Imagen' : 'Subir Imagen'}
                      </Button>

                      {logoPreview && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={handleRemoveLogo}
                          disabled={isUploading}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          Quitar
                        </Button>
                      )}
                    </div>

                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-primary shrink-0" />
                      <span>Optimización automática: formatos PNG, JPG, WEBP de hasta 10 MB convertidos a resolución retina ligera.</span>
                    </p>
                  </div>
                </div>
              </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Nombre del Negocio</Label>
              <Input id="name" value={profile.name || ""} onChange={handleInputChange} aria-invalid={profileNameMissing} className={cn(profileNameMissing && "border-destructive focus-visible:ring-destructive")} />
              {profileNameMissing && <p className="text-xs text-destructive">Indicá el nombre que verán tus clientes.</p>}
            </div>
            <div className="grid gap-2">
              <Label>Producto de tu cuenta</Label>
              <p className="rounded-md border bg-secondary/40 p-3 text-sm font-medium">{profile.businessType === 'hybrid' ? 'Cuenta existente con Servicios y Canchas' : profile.businessType === 'sports_facility' ? 'Pediturno Canchas' : profile.businessType === 'spaces' ? 'Pediturno Espacios' : 'Pediturno Servicios'}</p>
              <p className="text-xs text-muted-foreground">Cada producto tiene su portal y plan. Para solicitar un cambio de modalidad, contactá a soporte desde tu cuenta.</p>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                 <Label htmlFor="slug">URL de tu página</Label>
                 <Tooltip>
                    <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Este será el link único que compartirás con tus clientes. <br/>Ej: {getVerticalOrigin(getVerticalFromBusinessType(profile.businessType)).replace("https://", "")}/tu-negocio</p>
                    </TooltipContent>
                 </Tooltip>
              </div>
              <div className="flex items-center">
                  <div className="text-[10px] sm:text-sm text-muted-foreground p-2 rounded-l-md border border-r-0 bg-secondary whitespace-nowrap h-10 flex items-center">{getVerticalOrigin(getVerticalFromBusinessType(profile.businessType)).replace("https://", "")}/</div>
                  <Input 
                    id="slug" 
                    value={profile.slug || ""} 
                    onChange={handleSlugChange}
                    aria-invalid={profileSlugMissing || slugStatus === 'invalid' || slugStatus === 'unavailable'}
                    className={cn("rounded-l-none min-w-0 flex-grow", (profileSlugMissing || slugStatus === 'invalid' || slugStatus === 'unavailable') && "border-destructive focus-visible:ring-destructive")}
                  />
              </div>
              <div className="h-5 px-1 pt-1 text-xs flex items-center gap-1.5">
                  {currentSlugStatus.icon}
                  <p className={currentSlugStatus.className}>{currentSlugStatus.text}</p>
              </div>
              {profileSlugMissing && <p className="text-xs text-destructive">Elegí una URL válida de al menos 3 caracteres para completar este paso.</p>}
              {profile.slug && !hasUnsavedChanges && <BookingLinkActions url={`${getVerticalOrigin(getVerticalFromBusinessType(profile.businessType))}/${profile.slug}`} name={profile.name} />}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Descripción</Label>
              <Textarea
                id="description"
                value={profile.description || ""}
                onChange={handleInputChange}
              />
            </div>
            
            {/* 1. SECCIÓN DE MAPA INTERACTIVO (PRIMERO) */}
            <div className="space-y-4 rounded-xl border border-border p-4 bg-card/60 shadow-sm">
                <div className="flex flex-wrap justify-between items-center gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <MapPin className="h-5 w-5 text-primary" />
                            <Label className="text-base font-bold">1. Ubicación en el Mapa (Interactiva)</Label>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Busca tu dirección arriba del mapa, usa tu GPS o haz clic para clavar el marcador. Los datos de la dirección se completarán automáticamente abajo.
                        </p>
                    </div>
                    <Button 
                        type="button"
                        size="sm" 
                        variant="outline"
                        onClick={() => setIsMapModalOpen(true)}
                        className="shadow-sm"
                    >
                        <Maximize2 className="mr-2 h-4 w-4" />
                        Abrir en Pantalla Completa
                    </Button>
                </div>

                {isGeocodingAddress && (
                    <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 p-2 rounded-lg animate-pulse">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Sincronizando dirección ingresada con el mapa...</span>
                    </div>
                )}

                {geocodingSuccessMessage && (
                    <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/20 p-2.5 rounded-lg animate-in fade-in">
                        {geocodingSuccessMessage}
                    </div>
                )}

                <div className="rounded-xl overflow-hidden h-[360px] sm:h-[400px] border border-border shadow-inner">
                    <InteractiveMap 
                        initialPosition={profile.location}
                        onLocationSelect={(loc) => handleLocationSave(loc)}
                        onAddressSelect={(addr) => handleAddressSaveFromMap(addr)}
                        showSearch={true}
                    />
                </div>
            </div>

            {/* 2. CAMPOS DE DIRECCIÓN ESCRITA (SEGUNDO) */}
            {profile.address && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-sm font-semibold text-muted-foreground">
                            2. Campos de Dirección de tu Negocio
                        </Label>
                        <span className="text-xs text-muted-foreground">
                            Se actualizan con el mapa o puedes editarlos manualmente
                        </span>
                    </div>
                    <AddressForm 
                        address={profile.address}
                        onAddressChange={handleAddressChange}
                    />
                </div>
            )}
             
            <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="whatsapp-enabled" className="font-medium flex items-center gap-2">
                       <Image src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" alt="WhatsApp Logo" width={20} height={20} />
                        Botón de WhatsApp
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">Al activarlo, publicás tu número y un botón de contacto. Al desactivarlo, el número deja de mostrarse en tu página pública.</p>
                  </div>
                  <Switch
                    id="whatsapp-enabled"
                    checked={profile.whatsappButtonEnabled}
                    onCheckedChange={handleSwitchChange}
                  />
                </div>
                {profile.whatsappButtonEnabled && (
                    <div className="grid gap-2">
                      <Label htmlFor="whatsappNumber">Número de WhatsApp</Label>
                       <PhoneInput value={profile.whatsappNumber || ''} onChange={handlePhoneChange} />
                       {!isWhatsappValid && profile.whatsappNumber && (
                          <p className="text-xs text-destructive">Formato incorrecto. Revisa el prefijo y tu número.</p>
                      )}
                    </div>
                )}
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <CardTitle>Links Adicionales</CardTitle>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Info className="h-4 w-4 text-muted-foreground cursor-pointer" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <p>Estos enlaces aparecerán como botones en tu página pública. Es ideal para dirigir a tus clientes a tus redes sociales, sitio web u otros links importantes desde un solo lugar.</p>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                    <CardDescription>Agrega hasta 5 links a tus redes sociales o sitio web para mostrar en tu página pública.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {profile.socialLinks?.map((link, index) => {
                        const isUrlValid = !link.url || URL_REGEX.test(link.url);
                        return (
                            <div key={link.id} className="flex flex-col sm:flex-row gap-2 items-start p-2 border rounded-lg">
                                <div className="flex-grow w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
                                     <div className="grid gap-1.5">
                                         <Label className="text-xs">Tipo</Label>
                                         <Select value={link.type} onValueChange={(value) => handleSocialLinkChange(index, 'type', value as SocialLinkType)}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {socialLinkOptions.map(option => (
                                                    <SelectItem key={option.value} value={option.value}>
                                                        <div className="flex items-center gap-2">
                                                           <option.icon className="h-4 w-4" /> 
                                                           <span>{option.label}</span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                     </div>

                                      {link.type === 'custom' && (
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Título del Botón</Label>
                                            <Input 
                                                value={link.title || ''}
                                                onChange={(e) => handleSocialLinkChange(index, 'title', e.target.value)}
                                                placeholder="Mi Blog, Portfolio, etc."
                                            />
                                        </div>
                                      )}

                                     <div className="grid gap-1.5 sm:col-span-2">
                                         <Label className="text-xs">URL</Label>
                                         <Input 
                                            value={link.url}
                                            onChange={(e) => handleSocialLinkChange(index, 'url', e.target.value)}
                                            placeholder="https://instagram.com/tu-usuario"
                                            className={cn(!isUrlValid && "border-destructive focus-visible:ring-destructive")}
                                        />
                                         {!isUrlValid && (
                                            <p className="text-xs text-destructive">URL inválida. Debe empezar con http:// o https://</p>
                                         )}
                                     </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => removeSocialLink(index)} className="flex-shrink-0 mt-3 sm:mt-0">
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        )
                    })}
                     <Button variant="outline" size="sm" onClick={addSocialLink} disabled={(profile.socialLinks?.length || 0) >= 5}>
                        <PlusCircle className="mr-2 h-4 w-4"/>
                        Agregar Link
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Personalización de Página</CardTitle>
                    <CardDescription>Elige un tema de colores para tu página pública.</CardDescription>
                </CardHeader>
                <CardContent>
                    <RadioGroup
                    value={profile.theme || 'menta'}
                    onValueChange={handleThemeChange}
                    className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
                    >
                    {Object.entries(themeDetails).map(([key, { name, colors }]) => (
                        <div key={key}>
                        <RadioGroupItem value={key} id={key} className="peer sr-only" />
                        <Label
                            htmlFor={key}
                            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary"
                        >
                            <div className="flex w-full justify-center gap-2 mb-2">
                            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: `hsl(${colors.primary})` }}></span>
                            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: `hsl(${colors.background})`, border: '1px solid hsl(var(--border))' }}></span>
                            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: `hsl(${colors.accent})` }}></span>
                            </div>
                            {name}
                        </Label>
                        </div>
                    ))}
                     <div>
                        <RadioGroupItem value="custom" id="custom" className="peer sr-only" />
                        <Label
                            htmlFor="custom"
                            onClick={() => handleThemeChange('custom')}
                            className={cn(
                                "flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer",
                                profile.theme === 'custom' && "border-primary [&:has([data-state=checked])]:border-primary"
                            )}
                        >
                            <div className="flex w-full justify-center gap-2 mb-2">
                                <span className="h-8 w-8 rounded-full" style={{ backgroundColor: profile.customTheme?.primary || '#cccccc' }}></span>
                                <span className="h-8 w-8 rounded-full" style={{ backgroundColor: profile.customTheme?.background || '#cccccc', border: '1px solid hsl(var(--border))' }}></span>
                                <span className="h-8 w-8 rounded-full" style={{ backgroundColor: profile.customTheme?.accent || '#cccccc' }}></span>
                            </div>
                             <span className="flex items-center gap-2">
                                <Palette className="h-4 w-4" />
                                Personalizado
                            </span>
                        </Label>
                        </div>
                    </RadioGroup>
                </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                 <Button onClick={handleSaveChanges} disabled={isSaveDisabled}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Guardar Cambios
                 </Button>
                 
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span tabIndex={canGenerateQr ? undefined : 0}>
                                <Button variant="outline" onClick={() => setIsQrModalOpen(true)} disabled={!canGenerateQr}>
                                    <QrCode className="mr-2 h-4 w-4"/>
                                    Generar QR
                                </Button>
                            </span>
                        </TooltipTrigger>
                         {!canGenerateQr && (
                            <TooltipContent>
                                <p>Guarda tus cambios con una URL para generar el QR.</p>
                            </TooltipContent>
                        )}
                    </Tooltip>
                    
                </div>
                 {disabledReason && (
                    <p className="text-xs text-destructive flex items-center gap-1.5 mt-2">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {disabledReason}
                    </p>
                )}
            </div>
          </CardContent>
        </Card>
      </div>
      {isMapModalOpen && (
        <MapModal 
            isOpen={isMapModalOpen}
            onOpenChange={setIsMapModalOpen}
            initialLocation={profile.location}
            onSave={handleLocationSave}
        />
      )}
       {isCustomThemeModalOpen && (
         <ThemeCustomizer
            isOpen={isCustomThemeModalOpen}
            onOpenChange={setIsCustomThemeModalOpen}
            initialTheme={profile.customTheme}
            onSave={handleCustomThemeSave}
        />
       )}
       {isQrModalOpen && (
        <QrCodeModal
            isOpen={isQrModalOpen}
            onOpenChange={setIsQrModalOpen}
            url={getBusinessBookingUrl(profile.businessType, profile.slug || '')}
            logo={profile.logo}
            businessName={profile.name}
        />
       )}
    </TooltipProvider>
  )
}


export default function MiNegocioPage() {
    return (
        <UnsavedChangesProvider>
            <MiNegocioContent />
        </UnsavedChangesProvider>
    );
}
