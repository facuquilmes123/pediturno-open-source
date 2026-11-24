

"use client"

import { useState, useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Loader2, Upload, User } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Client, updateClient, uploadFile } from "@/services/data"

interface ClientEditModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  client: Client;
  onClientUpdate: () => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default function ClientEditModal({
  isOpen,
  onOpenChange,
  client,
  onClientUpdate,
}: ClientEditModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [name, setName] = useState(client.name);
  const [avatarPreview, setAvatarPreview] = useState(client.avatar);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const previewObjectUrl = useRef<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      if (previewObjectUrl.current) {
        URL.revokeObjectURL(previewObjectUrl.current);
        previewObjectUrl.current = null;
      }
      setName(client.name);
      setAvatarPreview(client.avatar || '');
      setPhotoFile(null);
      setHasChanges(false);
    }
  }, [isOpen, client])

  useEffect(() => () => {
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
    }
  }, []);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setHasChanges(true);
  }

  const handlePhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.size > MAX_FILE_SIZE) {
        toast({
            variant: "destructive",
            title: "Imagen demasiado grande",
            description: "El archivo debe ser de hasta 10 MB.",
        });
        return;
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        toast({
            variant: "destructive",
            title: "Formato no permitido",
            description: "Elegí una imagen JPG, PNG o WebP.",
        });
        return;
    }

    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }

    let objectUrl: string;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch {
      toast({
        variant: "destructive",
        title: "No se pudo preparar la imagen",
        description: "Intentá seleccionar la imagen nuevamente.",
      });
      return;
    }

    setPhotoFile(file);
    setHasChanges(true);
    previewObjectUrl.current = objectUrl;
    setAvatarPreview(objectUrl);
  }

  const closeModal = () => {
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && (isSaving || isUploading)) return;
    if (!open) closeModal();
    else onOpenChange(true);
  };

  const handleSave = async () => {
    if (!name) {
      toast({
        variant: "destructive",
        title: "Nombre requerido",
        description: "El nombre del cliente no puede estar vacío.",
      })
      return
    }

    setIsSaving(true);
    const previousAvatarUrl = client.avatar || '';
    let uploadedAvatarUrl = '';

    if (photoFile) {
        setIsUploading(true);
        try {
            uploadedAvatarUrl = await uploadFile(photoFile, 'avatars');
        } catch(error) {
            console.error("Failed to upload avatar:", error);
            const message = error instanceof Error && error.message
              ? error.message
              : "No se pudo subir la foto de perfil.";
            toast({ variant: "destructive", title: "Error al subir", description: message });
            setIsSaving(false);
            return;
        } finally {
            setIsUploading(false);
        }
    }

    const avatarUrl = uploadedAvatarUrl || previousAvatarUrl;
    try {
        const dataToUpdate: Partial<Client> & { businessId: string, phone: string } = { 
            name,
            avatar: avatarUrl || '',
            businessId: client.businessId,
            phone: client.phone,
        };

        if (client.email) {
            dataToUpdate.email = client.email;
        }
        if (client.lastAppointment) {
            dataToUpdate.lastAppointment = client.lastAppointment;
        }

        await updateClient(client.id, dataToUpdate);
    } catch (error) {
        console.error("Failed to update client:", error);
        // A missing acknowledgement can follow a committed save. Only the server
        // may reclaim images after checking the current resource references.
        toast({
            variant: "destructive",
            title: "Error",
            description: "No se pudieron guardar los cambios.",
        });
        setIsSaving(false);
        return;
    }

    try {
      onClientUpdate();
    } catch (callbackError) {
      console.error("Client was saved but the client list could not be refreshed:", callbackError);
    }

    toast({
        title: "¡Éxito!",
        description: "Los datos del cliente se han guardado correctamente.",
    });
    setHasChanges(false);
    setIsSaving(false);
    closeModal();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Cliente</DialogTitle>
          <DialogDescription>
            Actualiza la información y la foto de perfil de tu cliente.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatarPreview} alt={name} data-ai-hint="person face" />
              <AvatarFallback>{name.substring(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="grid gap-1.5">
              <Label htmlFor="photo-upload">Foto de Perfil</Label>
              <Input
                id="photo-upload"
                type="file"
                className="hidden"
                onChange={handlePhotoChange}
                accept="image/jpeg,image/png,image/webp"
                disabled={isUploading || isSaving}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => document.getElementById("photo-upload")?.click()}
                disabled={isUploading || isSaving}
              >
                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {isUploading ? 'Subiendo...' : 'Cambiar Foto'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Sugerencia: Usa una imagen cuadrada JPG, PNG o WebP (máx. 10 MB).
              </p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="client-name">Nombre del Cliente</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="client-name"
                value={name}
                onChange={handleNameChange}
                className="pl-9"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isSaving || isUploading}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={isSaving || isUploading || !hasChanges}>
            {(isSaving || isUploading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar Cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

    
