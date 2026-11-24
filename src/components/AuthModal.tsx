
"use client";

import { useEffect, useRef } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import AuthForm from "./LoginForm";
import type { ProductVertical } from "@/lib/verticals";


interface AuthModalProps {
    isOpen: boolean;
    onOpenChange: (isOpen: boolean) => void;
    initialView?: "login" | "register";
    initialVertical?: ProductVertical;
}

const AuthModal = ({
    isOpen,
    onOpenChange,
    initialView = "login",
    initialVertical = "services",
}: AuthModalProps) => {
    const returnFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (isOpen && document.activeElement instanceof HTMLElement) {
            returnFocusRef.current = document.activeElement;
        }
    }, [isOpen]);

    const handleSuccess = () => {
        // We don't close the modal immediately, we redirect. 
        // The redirect will unmount the component anyway.
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-md max-h-[92vh] overflow-y-auto [&_input]:text-base"
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    document.getElementById(initialView === "login" ? "login-email" : "register-name")?.focus();
                }}
                onCloseAutoFocus={(event) => {
                    const returnFocusTarget = returnFocusRef.current;
                    if (returnFocusTarget?.isConnected) {
                        event.preventDefault();
                        returnFocusTarget.focus();
                    }
                }}
            >
                <DialogHeader className="mb-2 text-center">
                    <DialogTitle className="text-2xl font-bold">{initialVertical === 'sports_facility' ? 'Ingresá a Pediturno Canchas' : initialVertical === 'spaces' ? 'Ingresá a Pediturno Espacios' : 'Ingresá a Pediturno Servicios'}</DialogTitle>
                    <DialogDescription>
                        {initialVertical === 'sports_facility' ? 'El espacio de tu complejo para organizar canchas y reservas.' : initialVertical === 'spaces' ? 'Administrá tus espacios, disponibilidad y reservas desde un solo lugar.' : 'El espacio de tu negocio para organizar servicios y turnos.'}
                    </DialogDescription>
                </DialogHeader>
                <AuthForm
                    onSuccess={handleSuccess}
                    initialTab={initialView}
                    initialVertical={initialVertical}
                />
            </DialogContent>
        </Dialog>
    )
};

export default AuthModal;
