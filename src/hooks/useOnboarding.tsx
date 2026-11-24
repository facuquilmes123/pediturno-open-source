/* eslint-disable react/no-unescaped-entities */

"use client"

import { useMemo, useState, useEffect } from 'react';
import { useDashboard } from '@/context/DashboardContext';
import { Rocket, Briefcase, CalendarClock, Share2, CheckCircle, Building2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuthRedirect';
import type { Space } from '@/services/data';
import {
    getProfileOnboardingMissingRequirements,
    getResourceOnboardingMissingRequirements,
} from '@/lib/onboarding-requirements';

export type OnboardingStep = {
    id: string;
    title: string;
    description: string;
    Icon: React.ElementType;
    isComplete: boolean;
    href: string;
    cta: string;
    missingRequirements?: string[];
};

const ONBOARDING_DISMISSED_KEY = 'pediturno_onboarding_dismissed';

function getSpaceOnboardingRequirements(spaces: Space[]): string[] {
    if (spaces.length === 0) return ['Creá al menos un espacio.'];
    const ready = spaces.some((space) => space.status === 'Activo' && space.packages.length > 0 && Object.values(space.workingHours || {}).some((day) => day?.slots?.length));
    return ready ? [] : ['Configurá los paquetes y horarios, y activá al menos un espacio.'];
}

export const useOnboarding = () => {
    const { businessProfile, services, canchas, spaces = [] } = useDashboard();
    const { user } = useAuth();
    const [isDismissed, setIsDismissed] = useState(true);

    const dismissedKey = user ? `${ONBOARDING_DISMISSED_KEY}:${user.uid}` : null;

    useEffect(() => {
        setIsDismissed(dismissedKey ? localStorage.getItem(dismissedKey) === 'true' : true);
    }, [dismissedKey]);

    const steps = useMemo((): OnboardingStep[] => {
        const isSports = businessProfile?.businessType === 'sports_facility';
        const isSpaces = businessProfile?.businessType === 'spaces';
        const isHybrid = businessProfile?.businessType === 'hybrid';
        const profileMissing = getProfileOnboardingMissingRequirements(businessProfile);
        const serviceMissing = getResourceOnboardingMissingRequirements(services, 'servicio');
        const canchaMissing = getResourceOnboardingMissingRequirements(canchas, 'cancha');
        const profileComplete = profileMissing.length === 0;
        const servicesComplete = services.length > 0;
        const canchasComplete = canchas.length > 0;
        const servicesReady = serviceMissing.length === 0;
        const canchasReady = canchaMissing.length === 0;
        const spacesComplete = spaces.length > 0;
        const spaceMissing = getSpaceOnboardingRequirements(spaces);
        const spacesReady = spaceMissing.length === 0;
        const resourceComplete = isSpaces ? spacesComplete : isSports ? canchasComplete : isHybrid ? servicesComplete && canchasComplete : servicesComplete;
        const readyToReceiveBookings = isSpaces ? spacesReady : isSports ? canchasReady : isHybrid ? servicesReady && canchasReady : servicesReady;
        const allStepsComplete = profileComplete && resourceComplete && readyToReceiveBookings;

        const resourceSteps: OnboardingStep[] = isSpaces ? [
            {
                id: 'spaces',
                title: 'Agregá tus Espacios',
                description: 'Cargá salones, quinchos, quintas u otros lugares disponibles.',
                Icon: Building2,
                isComplete: spacesComplete,
                href: '/dashboard/espacios',
                cta: 'Añadir Espacios',
                missingRequirements: spacesComplete ? [] : spaceMissing,
            },
            {
                id: 'space-availability',
                title: 'Configurá paquetes y horarios',
                description: 'Definí bloques largos, preparación, limpieza y disponibilidad.',
                Icon: CalendarClock,
                isComplete: spacesReady,
                href: '/dashboard/espacios',
                cta: 'Definir disponibilidad',
                missingRequirements: spaceMissing,
            },
        ] : isHybrid ? [
            {
                id: 'services',
                title: 'Agrega tus Servicios',
                description: 'Define los servicios profesionales que podrán reservar tus clientes.',
                Icon: Briefcase,
                isComplete: servicesComplete,
                href: '/dashboard/servicios',
                cta: 'Añadir Servicios',
                missingRequirements: servicesComplete ? [] : serviceMissing,
            },
            {
                id: 'canchas',
                title: 'Agrega tus Canchas',
                description: 'Carga las canchas o espacios deportivos disponibles.',
                Icon: Briefcase,
                isComplete: canchasComplete,
                href: '/dashboard/canchas',
                cta: 'Añadir Canchas',
                missingRequirements: canchasComplete ? [] : canchaMissing,
            },
            {
                id: 'service-availability',
                title: 'Horarios de Servicios',
                description: 'Configura al menos un horario de atención para tus servicios.',
                Icon: CalendarClock,
                isComplete: servicesReady,
                href: '/dashboard/servicios',
                cta: 'Definir Horarios',
                missingRequirements: serviceMissing,
            },
            {
                id: 'cancha-availability',
                title: 'Horarios de Canchas',
                description: 'Configura al menos una disponibilidad para tus canchas.',
                Icon: CalendarClock,
                isComplete: canchasReady,
                href: '/dashboard/canchas',
                cta: 'Definir Horarios',
                missingRequirements: canchaMissing,
            }
        ] : [
            {
                id: 'services',
                title: isSports ? 'Agrega tus Canchas' : 'Agrega tus Servicios',
                description: isSports
                    ? 'Carga las canchas que podrán reservar tus clientes.'
                    : 'Define los servicios que ofreces a tus clientes.',
                Icon: Briefcase,
                isComplete: isSports ? canchasComplete : servicesComplete,
                href: isSports ? '/dashboard/canchas' : '/dashboard/servicios',
                cta: isSports ? 'Añadir Canchas' : 'Añadir Servicios',
                missingRequirements: isSports
                    ? (canchasComplete ? [] : canchaMissing)
                    : (servicesComplete ? [] : serviceMissing),
            },
            {
                id: 'availability',
                title: 'Configura tu Horario',
                description: isSports
                    ? 'Establece la disponibilidad de cada cancha.'
                    : 'Establece los horarios de cada servicio.',
                Icon: CalendarClock,
                isComplete: readyToReceiveBookings,
                href: isSports ? '/dashboard/canchas' : '/dashboard/servicios',
                cta: 'Definir Horarios',
                missingRequirements: isSports ? canchaMissing : serviceMissing,
            }
        ];

        return [
            {
                id: 'profile',
                title: 'Completa tu Perfil',
                description: 'Añade el nombre y la URL de tu negocio.',
                Icon: Rocket,
                isComplete: profileComplete,
                href: '/dashboard/mi-negocio',
                cta: 'Ir a Mi Negocio',
                missingRequirements: profileMissing,
            },
            ...resourceSteps,
            {
                id: 'share',
                title: '¡Todo listo para compartir!',
                description: `Copia y comparte tu enlace para recibir reservas.`,
                Icon: allStepsComplete ? CheckCircle : Share2,
                isComplete: allStepsComplete,
                href: '/dashboard', // Stays on the same page
                cta: 'Copiar Enlace',
                missingRequirements: allStepsComplete
                    ? []
                    : ['Completá el perfil y dejá al menos un recurso activo con horarios válidos.'],
            }
        ];
    }, [businessProfile, canchas, services, spaces]);

    const isComplete = useMemo(() => steps.every(step => step.isComplete), [steps]);

    const setOnboardingComplete = () => {
        if (dismissedKey) localStorage.setItem(dismissedKey, 'true');
        setIsDismissed(true);
    };

    const showWizard = !!user && !isDismissed;

    return {
        onboardingSteps: steps,
        showWizard: showWizard,
        setOnboardingComplete
    };
};
