
"use client"

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useAuth } from '@/hooks/useAuthRedirect';
import { ShieldCheck, CheckCircle, Calendar, CreditCard, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import MembershipStatusDisplay from '@/components/MembershipStatusDisplay';
import { getMembershipStatus } from '@/lib/membership-utils';
import { useDashboard } from '@/context/DashboardContext';
import PaymentButton from '@/components/PaymentButton';
import { getMembershipPriceArs, usesGooglePlayMembership, SERVICE_MEMBERSHIP_PRICE_LABEL } from '@/lib/config';
import { usePaymentAvailability } from '@/lib/payments/use-payment-availability';

export default function MembresiaPage() {
    const paymentsAvailable = usePaymentAvailability();
    const { user, loading: authLoading } = useAuth();
    const { businessProfile: initialProfile, isProfileLoading: isContextLoading } = useDashboard();
    
    const localProfile = initialProfile?.id === user?.uid ? initialProfile : null;
    const isLoading = authLoading || isContextLoading;
    const isSportsPlan = localProfile?.businessType === 'sports_facility' || localProfile?.businessType === 'hybrid';
    const isSpacesPlan = localProfile?.businessType === 'spaces';
    const isServicesPlan = !isSportsPlan && !isSpacesPlan;
    const planName = isSpacesPlan ? 'Plan Espacios' : isSportsPlan ? 'Plan Canchas' : 'Plan Servicios';
    
    const searchParams = useSearchParams();
    const paymentStatus = searchParams.get('status');

    // This state will specifically control the "Processing..." indicator
    const [showProcessingIndicator, setShowProcessingIndicator] = useState(paymentStatus === 'approved');

    useEffect(() => {
        if (initialProfile && user) {
            const current = getMembershipStatus(initialProfile, user.email);
            if (current.status === 'Activa' || current.status === 'De por vida') setShowProcessingIndicator(false);
        }
    }, [initialProfile, user, authLoading, isContextLoading]);

    const membershipStatus = !isLoading && user && localProfile ? getMembershipStatus(localProfile, user.email) : null;
    const { status, endDate } = membershipStatus || {};
    const showPaymentCard = status === 'En Prueba' || status === 'Vencida';
    const isFreeServices = isServicesPlan && status === 'Gratis';
    const membershipPrice = getMembershipPriceArs(localProfile?.businessType);
    const isPlay = usesGooglePlayMembership(localProfile?.businessType);


    if (isLoading || !localProfile) {
        return (
            <div className="flex flex-col gap-8">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-secondary rounded-full">
                        <Skeleton className="h-8 w-8 rounded-full" />
                    </div>
                    <div>
                        <Skeleton className="h-8 w-56 mb-2" />
                        <Skeleton className="h-5 w-72" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <Skeleton className="h-64 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </div>
        );
    }
    

    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4">
                <div className="p-3 bg-secondary rounded-full">
                    <ShieldCheck className="h-8 w-8 text-foreground"/>
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestionar Membresía</h1>
                    <p className="text-muted-foreground">
                        Consulta el estado de tu plan y gestiona tus pagos.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                <Card>
                    <CardHeader>
                        <CardTitle>Tu Plan Actual</CardTitle>
                        <CardDescription>Consultá el estado y los beneficios de tu plan.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-secondary rounded-lg">
                            <span className="text-lg font-bold text-primary">{planName}</span>
                             <MembershipStatusDisplay profile={localProfile} userEmail={user?.email} isLoading={false} />
                        </div>
                        
                        <ul className="space-y-2 text-sm text-muted-foreground pt-4 border-t">
                            <li className="flex items-center"><CheckCircle className="h-4 w-4 mr-2 text-green-500" /> Página de reservas online</li>
                            <li className="flex items-center"><CheckCircle className="h-4 w-4 mr-2 text-green-500" /> {isFreeServices ? 'Hasta 40 turnos por mes y clientes ilimitados' : isServicesPlan ? 'Turnos y clientes ilimitados' : 'Gestión de turnos y clientes según tu plan vigente'}</li>
                            <li className="flex items-center"><CheckCircle className="h-4 w-4 mr-2 text-green-500" /> {isSpacesPlan ? 'Espacios, paquetes por duración y disponibilidad' : isSportsPlan ? 'Canchas, horarios y precios por turno' : 'Servicios y precios personalizables'}</li>
                            <li className="flex items-center"><CheckCircle className="h-4 w-4 mr-2 text-green-500" /> Recordatorios por email</li>
                        </ul>
                    </CardContent>
                    <CardFooter className="flex items-center justify-between text-sm text-muted-foreground bg-muted/50 p-4 rounded-b-lg">
                        <div className="flex items-center gap-2">
                             <Calendar className="h-5 w-5"/>
                             <span>
                                {status === 'Gratis' ? 'Plan Gratis:' : status === 'De por vida' ? 'Estado:' : endDate ? `Tu plan ${status === 'Vencida' ? 'venció' : 'vence'} el:` : 'Estado:'}
                                <strong> {status === 'Gratis' ? ' hasta 40 turnos por mes' : status === 'De por vida' ? ' De por vida' : (endDate ? ` ${new Date(endDate).toLocaleDateString('es-ES')}` : ' N/A')}</strong>
                             </span>
                        </div>
                    </CardFooter>
                </Card>
                
                
                {showPaymentCard ? (
                    <Card>
                        <CardHeader>
                            <CardTitle>{planName}</CardTitle>
                            <CardDescription>{isPlay ? 'Contratá o gestioná tu membresía desde Pediturno para Android en Google Play.' : paymentsAvailable === null ? 'Consultando disponibilidad del pago online...' : paymentsAvailable ? 'Para continuar después de la prueba, realizá el pago de tu plan.' : 'El pago online del plan está temporalmente deshabilitado mientras terminamos de verificar la conciliación.'}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {showProcessingIndicator && (
                                <div className="flex flex-col items-center justify-center p-4 border rounded-lg bg-blue-50 border-blue-200 text-blue-800">
                                    <Loader2 className="h-8 w-8 animate-spin mb-2"/>
                                    <p className="font-semibold">Procesando tu pago...</p>
                                    <p className="text-xs text-center">La página se actualizará automáticamente en unos segundos.</p>
                                </div>
                            )}

                            {!showProcessingIndicator && (
                                <>
                                    <div className="p-4 border rounded-lg text-center">
                                        <p className="text-3xl font-bold">{isPlay ? SERVICE_MEMBERSHIP_PRICE_LABEL : membershipPrice.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })} <span className="text-base font-normal text-muted-foreground">por mes</span></p>
                                        <p className="text-xs text-muted-foreground">El total se confirma antes de pagar.</p>
                                    </div>
                                    
                                    {isPlay || paymentsAvailable ? (
                                        <>
                                            <PaymentButton user={user} profile={localProfile} />
                                            {!isPlay && <p className="text-xs text-center text-muted-foreground">Serás redirigido al sitio seguro de Mercado Pago para completar tu compra.</p>}
                                        </>
                                    ) : paymentsAvailable === false ? (
                                        <p className="text-sm text-center text-muted-foreground">Si necesitás ayuda con tu plan, escribinos a <a className="underline" href="mailto:contacto@pediturno.com">contacto@pediturno.com</a>.</p>
                                    ) : null}
                                </>
                            )}
                        </CardContent>
                        <CardFooter>
                            <p className="text-xs text-muted-foreground flex items-center gap-2">
                                <CreditCard className="h-4 w-4" />
                                {isPlay ? 'La suscripción mensual se gestiona y cancela en Google Play. El acceso continúa durante el período vigente.' : 'El pago del plan extiende el acceso por un mes; no se renueva automáticamente.'}
                            </p>
                        </CardFooter>
                    </Card>
                ) : (
                    <Card>
                        <CardHeader>
                            <CardTitle>Pago y Facturación</CardTitle>
                        </CardHeader>
                         <CardContent className="flex flex-col items-center justify-center text-center p-10 bg-secondary/50 rounded-b-lg">
                            <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
                            <h3 className="font-semibold text-lg">{isFreeServices ? 'Estás usando el Plan Gratis' : status === 'De por vida' ? 'Tu membresía es de por vida' : 'Tu suscripción está al día'}</h3>
                            <p className="text-sm text-muted-foreground mt-2">{isFreeServices ? 'Podés gestionar hasta 40 turnos por mes y clientes ilimitados.' : 'No necesitás realizar ninguna acción.'}</p>
                        </CardContent>
                    </Card>
                )}
                
            </div>
        </div>
    );
}
