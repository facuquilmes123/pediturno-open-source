
"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Image from "next/image";
import { Address } from "@/services/data";

const spanishSpeakingCountries = [
  { code: 'AR', name: 'Argentina' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'CU', name: 'Cuba' },
  { code: 'DO', name: 'República Dominicana' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'GQ', name: 'Guinea Ecuatorial' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'MX', name: 'México' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'PA', name: 'Panamá' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'PE', name: 'Perú' },
  { code: 'ES', name: 'España' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'VE', name: 'Venezuela' },
].sort((a, b) => a.name.localeCompare(b.name));

interface AddressFormProps {
    address: Address;
    onAddressChange: (address: Address) => void;
}

export default function AddressForm({ address, onAddressChange }: AddressFormProps) {

    const handleFieldChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { id, value } = e.target;
        onAddressChange({ ...address, [id]: value });
    }, [address, onAddressChange]);

    const handleCountryChange = useCallback((value: string) => {
        onAddressChange({ ...address, country: value });
    }, [address, onAddressChange]);

    return (
        <div className="space-y-4 rounded-lg border p-4">
            <div>
                <Label className="text-base font-semibold">Dirección</Label>
                <p className="text-sm text-muted-foreground">Ingresa la dirección de tu negocio. Esta se mostrará como texto.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="country" className="text-xs">País</Label>
                    <Select onValueChange={handleCountryChange} value={address.country || ""}>
                        <SelectTrigger id="country">
                            <SelectValue placeholder="Selecciona un país..." />
                        </SelectTrigger>
                        <SelectContent>
                            {spanishSpeakingCountries.map(country => (
                                <SelectItem key={country.code} value={country.name}>
                                    <div className="flex items-center gap-2">
                                        <Image
                                            src={`https://flagcdn.com/w20/${country.code.toLowerCase()}.png`}
                                            width={20}
                                            height={15}
                                            alt={`Bandera de ${country.name}`}
                                        />
                                        <span>{country.name}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-2 relative">
                    <Label htmlFor="province" className="text-xs">Provincia</Label>
                    <Input id="province" value={address.province || ""} onChange={handleFieldChange} placeholder="Buenos Aires" autoComplete="off" />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                <div className="sm:col-span-3 grid gap-2 relative">
                    <Label htmlFor="city" className="text-xs">Ciudad / Localidad</Label>
                    <Input id="city" value={address.city || ""} onChange={handleFieldChange} placeholder="CABA" autoComplete="off"/>
                </div>
                <div className="sm:col-span-2 grid gap-2">
                    <Label htmlFor="postalCode" className="text-xs">Código Postal</Label>
                    <Input id="postalCode" value={address.postalCode || ""} onChange={handleFieldChange} placeholder="C1043AAV"/>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                <div className="sm:col-span-3 grid gap-2 relative">
                    <Label htmlFor="street" className="text-xs">Calle</Label>
                    <Input id="street" value={address.street || ""} onChange={handleFieldChange} placeholder="Av. Corrientes" autoComplete="off"/>
                </div>
                <div className="sm:col-span-2 grid gap-2">
                    <Label htmlFor="number" className="text-xs">Altura</Label>
                    <Input id="number" value={address.number || ""} onChange={handleFieldChange} placeholder="1234"/>
                </div>
            </div>
        </div>
    );
}
