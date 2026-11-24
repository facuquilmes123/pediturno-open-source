

"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import { createPaymentPreference } from "@/services/mercadopago";
import { cn } from "@/lib/utils";
import { User } from 'firebase/auth';
import { BusinessProfile } from '@/services/data';
import { usesGooglePlayMembership } from '@/lib/config';
import PlayMembershipPurchase from '@/components/PlayMembershipPurchase';

interface PaymentButtonProps {
    user: User | null;
    profile: BusinessProfile | null;
}

export default function PaymentButton({ user, profile }: PaymentButtonProps) {
    const [isRedirecting, setIsRedirecting] = useState(false);
    const router = useRouter();
    const { toast } = useToast();

    const handlePayment = async () => {
        if (!user || !profile) {
            toast({ variant: 'destructive', title: 'Error', description: 'No se pudo verificar tu sesión. Por favor, recarga la página.'});
            return;
        }

        setIsRedirecting(true);
        try {
            const result = await createPaymentPreference({
                idToken: await user.getIdToken(),
            });

            if (result.success && result.init_point) {
                router.push(result.init_point);
            } else {
                 toast({ variant: 'destructive', title: 'Error al Pagar', description: result.message });
                 setIsRedirecting(false);
            }

        } catch (error) {
            console.error(error);
            toast({ variant: 'destructive', title: 'Error Inesperado', description: 'No se pudo iniciar el proceso de pago.' });
            setIsRedirecting(false);
        }
    }
    
    if (profile && usesGooglePlayMembership(profile.businessType)) return <PlayMembershipPurchase />;

    return (
        <button
            onClick={handlePayment}
            disabled={isRedirecting}
            className={cn(
                "block w-full bg-[#009ee3] hover:bg-[#008acf] h-12 shadow-lg rounded-md flex items-center justify-center p-0 transition-colors",
                isRedirecting && "opacity-70 cursor-not-allowed"
            )}
        >
            {isRedirecting ? (
                <Loader2 className="h-6 w-6 animate-spin text-white" />
            ) : (
                <Image src="/mpago.webp" alt="Pagar con Mercado Pago" width={300} height={48} className="object-contain h-full py-2" data-ai-hint="logo"/>
            )}
        </button>
    );
}
