
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
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { CustomThemeData } from '@/services/data';

interface ThemeCustomizerProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    initialTheme?: CustomThemeData | null;
    onSave: (theme: CustomThemeData) => void;
}

const ThemeCustomizer = ({ isOpen, onOpenChange, initialTheme, onSave }: ThemeCustomizerProps) => {
    const [primary, setPrimary] = useState('#64CCC9');
    const [background, setBackground] = useState('#F0F0F0');
    const [accent, setAccent] = useState('#548C8A');
    
    useEffect(() => {
        if (isOpen && initialTheme) {
            setPrimary(initialTheme.primary);
            setBackground(initialTheme.background);
            setAccent(initialTheme.accent);
        }
    }, [isOpen, initialTheme]);

    const handleSave = () => {
        onSave({ primary, background, accent });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Personalizar Tema</DialogTitle>
                    <DialogDescription>
                        Elige los colores principales para tu página pública.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 py-4">
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="primary-color" className="text-right">
                            Primario
                        </Label>
                        <Input
                            id="primary-color"
                            type="color"
                            value={primary}
                            onChange={(e) => setPrimary(e.target.value)}
                            className="col-span-2 h-10 p-1"
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="background-color" className="text-right">
                            Fondo
                        </Label>
                        <Input
                            id="background-color"
                            type="color"
                            value={background}
                            onChange={(e) => setBackground(e.target.value)}
                            className="col-span-2 h-10 p-1"
                        />
                    </div>
                    <div className="grid grid-cols-3 items-center gap-4">
                        <Label htmlFor="accent-color" className="text-right">
                            Acento
                        </Label>
                        <Input
                            id="accent-color"
                            type="color"
                            value={accent}
                            onChange={(e) => setAccent(e.target.value)}
                            className="col-span-2 h-10 p-1"
                        />
                    </div>
                </div>
                <div className="flex justify-center p-4 rounded-lg bg-secondary">
                    <div className="flex w-full justify-center gap-4">
                        <div className="text-center">
                            <span className="h-12 w-12 rounded-full inline-block" style={{ backgroundColor: primary }}></span>
                            <p className="text-xs mt-1">Primario</p>
                        </div>
                        <div className="text-center">
                            <span className="h-12 w-12 rounded-full inline-block border" style={{ backgroundColor: background }}></span>
                             <p className="text-xs mt-1">Fondo</p>
                        </div>
                         <div className="text-center">
                           <span className="h-12 w-12 rounded-full inline-block" style={{ backgroundColor: accent }}></span>
                            <p className="text-xs mt-1">Acento</p>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSave}>Guardar Tema</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
};

export default ThemeCustomizer;
