
"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { CheckCircle, ArrowRight, X } from "lucide-react"
import BookingLinkActions from '@/components/BookingLinkActions';
import { OnboardingStep } from "@/hooks/useOnboarding"
import Link from "next/link"

import { useDashboard } from "@/context/DashboardContext"
import { getBusinessBookingUrl } from '@/lib/verticals';
import OnboardingRequirements from '@/components/OnboardingRequirements';

interface OnboardingWizardProps {
    steps: OnboardingStep[];
    onComplete: () => void;
}

export default function OnboardingWizard({ steps, onComplete }: OnboardingWizardProps) {
    const { businessProfile } = useDashboard();

    const isSports = businessProfile?.businessType === 'sports_facility';
    const isSpaces = businessProfile?.businessType === 'spaces';
    const isHybrid = businessProfile?.businessType === 'hybrid';
    const bookingKind = isSpaces ? 'reservas de espacios' : isSports ? 'reservas de canchas' : isHybrid ? 'reservas de servicios y canchas' : 'turnos';
    const pageKind = isSpaces ? 'espacios' : isSports ? 'canchas' : isHybrid ? 'servicios y canchas' : 'servicios';

    const completedSteps = steps.filter(step => step.isComplete).length;
    const progress = (completedSteps / steps.length) * 100;
    const firstIncompleteStep = steps.find(step => !step.isComplete);
    
    const allDone = completedSteps === steps.length;

    return (
        <Card className="shadow-lg border-primary/20 animate-in fade-in slide-in-from-top-10 duration-500">
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-2xl font-bold flex items-center gap-2">
                            {allDone ? '¡Configuración completa!' : 'Primeros pasos'}
                        </CardTitle>
                        <CardDescription className="mt-1">
                            {allDone
                                ? `Tu página ya puede recibir ${bookingKind}.`
                                : `Completa estos pasos para dejar lista tu página de ${pageKind}. (${completedSteps}/${steps.length})`}
                        </CardDescription>
                    </div>
                     {!allDone && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onComplete}>
                           <X className="h-4 w-4" />
                           <span className="sr-only">Cerrar</span>
                       </Button>
                     )}
                </div>
                {!allDone && <Progress value={progress} className="mt-4" />}
            </CardHeader>
            <CardContent>
                <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-4">
                    {steps.map((step, index) => {
                        const isNextStep = step.id === firstIncompleteStep?.id;
                        const stepNumber = index + 1;
                        return (
                            <li key={step.id} className="min-w-0">
                                <div className={`p-4 border rounded-lg h-full flex flex-col justify-between transition-colors motion-reduce:transition-none ${step.isComplete ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800' : isNextStep ? 'bg-secondary' : 'bg-secondary/50 opacity-70'}`}>
                                    <div>
                                        <div className="flex items-center gap-3 mb-2">
                                            <span aria-hidden="true" className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold ${step.isComplete ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950' : isNextStep ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{stepNumber}</span>
                                            {step.isComplete ? <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0" /> : <step.Icon className={`h-6 w-6 flex-shrink-0 ${isNextStep ? 'text-primary' : 'text-muted-foreground'}`} />}
                                            <h3 className="min-w-0 break-words font-semibold"><span className="sr-only">Paso {stepNumber} de {steps.length}: </span>{step.title}</h3>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{step.description}</p>
                                        {!step.isComplete && <OnboardingRequirements requirements={step.missingRequirements || []} className="mt-3" />}
                                    </div>
                                    <div className="mt-4">
                                        {!step.isComplete && (
                                            step.id === 'share' ? (
                                                 <Button size="sm" className="w-full" disabled>
                                                    {step.cta}
                                                </Button>
                                            ) : (
                                                <Button asChild size="sm" className="w-full" variant={isNextStep ? 'default' : 'outline'}>
                                                    <Link href={step.href}>
                                                        {step.cta} <ArrowRight className="ml-2 h-4 w-4"/>
                                                    </Link>
                                                </Button>
                                            )
                                        )}
                                        {step.isComplete && step.id === 'share' && businessProfile?.slug && (
                                             <BookingLinkActions url={getBusinessBookingUrl(businessProfile.businessType, businessProfile.slug)} name={businessProfile.name} />
                                        )}
                                    </div>
                                </div>
                            </li>
                        )
                    })}
                </ul>
                {allDone && (
                    <div className="mt-4 text-center">
                         <Button onClick={onComplete}>¡Entendido, a trabajar!</Button>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
