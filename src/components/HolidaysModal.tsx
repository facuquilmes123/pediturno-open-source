
"use client"

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator";

export interface Holiday {
    id: string;
    date: Date;
    name: string;
}

interface HolidaysModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    holidays: Holiday[];
    onConfirm: (selectedHolidays: Date[]) => void;
}

const HolidaysModal = ({ isOpen, onOpenChange, holidays, onConfirm }: HolidaysModalProps) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        // Pre-select all holidays when the modal opens and holidays are loaded
        if (isOpen && holidays.length > 0) {
            const allIds = new Set(holidays.map(h => h.id));
            setSelectedIds(allIds);
        }
    }, [isOpen, holidays]);

    const handleCheckboxChange = (holidayId: string, checked: boolean) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (checked) {
                newSet.add(holidayId);
            } else {
                newSet.delete(holidayId);
            }
            return newSet;
        });
    };

    const handleConfirm = () => {
        const selectedDates = holidays
            .filter(h => selectedIds.has(h.id))
            .map(h => h.date);
        onConfirm(selectedDates);
    };
    
    const handleSelectAll = (check: boolean) => {
        if (check) {
            setSelectedIds(new Set(holidays.map(h => h.id)));
        } else {
            setSelectedIds(new Set());
        }
    }

    const allSelected = selectedIds.size === holidays.length;
    const isIndeterminate = selectedIds.size > 0 && selectedIds.size < holidays.length;

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Importar Feriados Nacionales</DialogTitle>
                    <DialogDescription>
                        Selecciona los feriados que quieres marcar como no disponibles en tu calendario.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center space-x-2 border-t border-b py-2 px-3">
                    <Checkbox 
                        id="select-all" 
                        checked={allSelected}
                        onCheckedChange={handleSelectAll}
                        aria-label="Seleccionar todo"
                    />
                    <Label htmlFor="select-all" className="font-medium">
                        Seleccionar Todos ({selectedIds.size} / {holidays.length})
                    </Label>
                </div>
                <ScrollArea className="h-72 w-full rounded-md border">
                   <div className="p-4">
                        {holidays.map((holiday) => (
                            <div key={holiday.id} className="flex items-center space-x-3 mb-3">
                                <Checkbox
                                    id={holiday.id}
                                    checked={selectedIds.has(holiday.id)}
                                    onCheckedChange={(checked) => handleCheckboxChange(holiday.id, !!checked)}
                                />
                                <div className="grid gap-1.5 leading-none">
                                    <Label htmlFor={holiday.id} className="font-medium cursor-pointer">
                                        {holiday.name}
                                    </Label>
                                    <p className="text-sm text-muted-foreground">
                                        {holiday.date.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                    </p>
                                </div>
                            </div>
                        ))}
                   </div>
                </ScrollArea>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleConfirm} disabled={selectedIds.size === 0}>
                        Agregar {selectedIds.size} Feriados
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
};

export default HolidaysModal;
