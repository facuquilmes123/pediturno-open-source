"use client";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";
import { useDashboard } from "@/context/DashboardContext";
import { useAuth } from "@/hooks/useAuthRedirect";
import { useRouter } from "next/navigation";
import PaymentButton from "@/components/PaymentButton";
import { getMembershipPriceArs, usesGooglePlayMembership, SERVICE_MEMBERSHIP_PRICE_LABEL } from "@/lib/config";
import { usePaymentAvailability } from "@/lib/payments/use-payment-availability";

interface ExpiredMembershipModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const ExpiredMembershipModal = ({ isOpen, onOpenChange }: ExpiredMembershipModalProps) => {
  const paymentsAvailable = usePaymentAvailability();
  const { user } = useAuth();
  const { businessProfile } = useDashboard();
  const router = useRouter();
  const membershipPrice = getMembershipPriceArs(businessProfile?.businessType);
  const isPlay = usesGooglePlayMembership(businessProfile?.businessType);

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) router.push("/dashboard/membresia");
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="h-6 w-6 text-destructive" />
          </div>
          <AlertDialogTitle className="text-center">Tu membresía ha expirado</AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {isPlay ? "Tu plan ha finalizado. Podés gestionar la membresía de Servicios desde Pediturno para Android en Google Play." : paymentsAvailable === null
              ? "Consultando disponibilidad del pago online..."
              : paymentsAvailable
              ? "Tu plan ha finalizado. Podés extender el acceso por un mes con un nuevo pago."
              : "Tu plan ha finalizado. El pago online está temporalmente deshabilitado mientras verificamos la conciliación."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border bg-secondary/50 p-4 text-center">
          <p className="text-3xl font-bold">
            {isPlay ? SERVICE_MEMBERSHIP_PRICE_LABEL : membershipPrice.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })}
            <span className="text-base font-normal text-muted-foreground"> por un mes</span>
          </p>
          <p className="text-xs text-muted-foreground">{isPlay ? 'Precio base mensual. Google Play informa el total y las condiciones antes de contratar.' : 'El total se confirma antes de pagar. No hay renovación automática.'}</p>
        </div>
        {isPlay || paymentsAvailable ? (
          <PaymentButton user={user} profile={businessProfile} />
        ) : paymentsAvailable === false ? (
          <p className="text-center text-sm text-muted-foreground">
            Si necesitás ayuda con tu plan, escribinos a{" "}
            <a className="underline" href="mailto:contacto@pediturno.com">contacto@pediturno.com</a>.
          </p>
        ) : null}
        <AlertDialogFooter>
          <Button asChild className="w-full" variant="ghost" onClick={() => onOpenChange(false)}>
            <Link href="/dashboard/membresia">Ver detalles del plan</Link>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ExpiredMembershipModal;
