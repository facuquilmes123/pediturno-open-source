"use client"

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import dynamic from 'next/dynamic';
import { Skeleton } from './ui/skeleton';
import { Loader2 } from 'lucide-react';
import { GeocodedAddress } from '@/services/geocoding';

const InteractiveMap = dynamic(() => import('./InteractiveMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-[400px] w-full" />
});

interface MapModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    initialLocation?: { lat: number; lng: number };
    onSave: (location: { lat: number; lng: number }, address?: GeocodedAddress) => void;
}

const MapModal = ({ isOpen, onOpenChange, initialLocation, onSave }: MapModalProps) => {
    const [selectedLocation, setSelectedLocation] = useState(initialLocation);
    const [selectedAddress, setSelectedAddress] = useState<GeocodedAddress | undefined>(undefined);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = () => {
        if (selectedLocation) {
            setIsSaving(true);
            onSave(selectedLocation, selectedAddress);
        }
    }
    
    useEffect(() => {
        if (isOpen) {
            setSelectedLocation(initialLocation);
            setSelectedAddress(undefined);
            setIsSaving(false);
        }
    }, [isOpen, initialLocation]);

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[85vw] md:max-w-[70vw] lg:max-w-[60vw] max-h-[90vh] flex flex-col p-4 sm:p-6">
                <DialogHeader className="pb-2">
                    <DialogTitle>Marcar Ubicación en el Mapa</DialogTitle>
                    <DialogDescription>
                        Busca tu dirección o haz clic en el mapa para colocar el marcador. Se completarán automáticamente los campos de tu dirección.
                    </DialogDescription>
                </DialogHeader>
                <div className="h-[55vh] min-h-[360px] w-full rounded-md overflow-hidden border">
                   <InteractiveMap 
                        initialPosition={initialLocation}
                        onLocationSelect={setSelectedLocation}
                        onAddressSelect={setSelectedAddress}
                        showSearch={true}
                    />
                </div>
                <DialogFooter className="pt-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={!selectedLocation || isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Aplicar Ubicación y Dirección
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
};

export default MapModal;
