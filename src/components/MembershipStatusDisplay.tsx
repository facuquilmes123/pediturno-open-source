

"use client"

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { XCircle, CheckCircle, ShieldCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BusinessProfile } from "@/services/data";
import { getMembershipStatus } from "@/lib/membership-utils";

interface MembershipStatusDisplayProps {
    profile: BusinessProfile | null;
    userEmail?: string | null;
    isLoading: boolean;
    isButton?: boolean;
}

const MembershipStatusDisplay = ({ profile, userEmail, isLoading, isButton = true }: MembershipStatusDisplayProps) => {

    if (isLoading) {
        return <Skeleton className="h-9 w-40" />;
    }
    
    const membershipInfo = getMembershipStatus(profile, userEmail);
    const { status, daysLeft } = membershipInfo;
    
    let Icon = XCircle;
    let buttonClass = "border-destructive/50 bg-destructive/5 text-destructive hover:bg-destructive/10";
    let iconClass = "text-destructive";


    switch (status) {
        case 'Activa':
            Icon = CheckCircle;
            buttonClass = "border-green-200 bg-green-50 text-green-800 hover:bg-green-100";
            iconClass = "text-green-600";
            break;
        case 'De por vida':
            Icon = ShieldCheck;
            buttonClass = "border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100";
            iconClass = "text-purple-600";
            break;
        case 'En Prueba':
            Icon = Clock;
            buttonClass = "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100";
            iconClass = "text-blue-600";
            break;
        case 'Gratis':
            Icon = CheckCircle;
            buttonClass = "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
            iconClass = "text-emerald-600";
            break;
        case 'Vencida':
            Icon = XCircle;
            buttonClass = "border-destructive/50 bg-destructive/5 text-destructive hover:bg-destructive/10";
            iconClass = "text-destructive";
            break;
    }
    
    const statusText = status === 'Gratis'
        ? 'Plan Gratis (40/mes)'
        : status === 'De por vida' 
        ? status 
        : (daysLeft !== null && daysLeft >= 0 ? `${status} (${daysLeft}d)` : 'Vencida');


    const content = (
        <>
            <Icon className={cn("mr-2 h-4 w-4", iconClass)} />
            <span className={cn("text-sm font-semibold hidden sm:inline", iconClass)}>Membresía: {statusText}</span>
            <span className={cn("text-sm font-semibold sm:hidden", iconClass)}>{statusText}</span>
        </>
    );

    if (isButton) {
        return (
             <Button variant="outline" className={cn(buttonClass, "p-2 h-auto")}>
                {content}
            </Button>
        )
    }

    return (
        <div className={cn("inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-semibold", buttonClass)}>
            {content}
        </div>
    );
};

export default MembershipStatusDisplay;
