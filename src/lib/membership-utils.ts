

import { BusinessProfile } from "@/services/data";
import { differenceInDays, addMonths } from 'date-fns';
import { Timestamp } from "firebase/firestore";
import { getEffectiveMembership, isServicesBusiness } from '@/lib/membership-entitlement';
import type { Membership } from '@/services/data';

export interface MembershipStatus {
    status: 'Activa' | 'En Prueba' | 'Vencida' | 'De por vida' | 'Gratis';
    daysLeft: number | null;
    endDate: Date | null;
    progress: number;
}

export function getMembershipStatus(profile: BusinessProfile | null, _userEmail?: string | null): MembershipStatus {
    const now = new Date();
    
    if (!profile || profile.status !== 'active') {
        return { status: 'Vencida', daysLeft: 0, endDate: null, progress: 100 };
    }

    const { createdAt } = profile;
    const effective = getEffectiveMembership(profile);
    if (!effective && isServicesBusiness(profile)) return { status: 'Gratis', daysLeft: null, endDate: null, progress: 0 };
    const membership = (effective || profile.membership) as Membership | undefined;

    if (membership && ['trial', 'pro', 'lifetime'].includes(membership.type)) {
        // Handle lifetime membership first
        if (membership.type === 'lifetime') {
            return { status: 'De por vida', daysLeft: null, endDate: null, progress: 100 };
        }

        // Handle plans with an expiration date
        if (membership.expiresAt) {
             const expiryDate = membership.expiresAt instanceof Timestamp 
                ? membership.expiresAt.toDate() 
                : new Date(membership.expiresAt);

            if (expiryDate instanceof Date && !isNaN(expiryDate.getTime())) {
                if (expiryDate > now) {
                    const daysLeft = differenceInDays(expiryDate, now);

                    // Determine the start date for progress calculation
                    let startDate: Date;
                    if (membership.startsAt) {
                         startDate = membership.startsAt instanceof Timestamp
                            ? membership.startsAt.toDate()
                            : new Date(membership.startsAt);
                    } else if (membership.type === 'trial' && createdAt) {
                        const creationDate = createdAt instanceof Timestamp ? createdAt.toDate() : new Date(createdAt);
                        startDate = creationDate;
                    } else {
                        // Fallback for older 'pro' plans without a startsAt date
                        startDate = addMonths(expiryDate, -1);
                    }
                    
                    if (startDate instanceof Date && !isNaN(startDate.getTime())) {
                        const totalDuration = differenceInDays(expiryDate, startDate);
                        const effectiveTotalDuration = totalDuration > 0 ? totalDuration : 15; // Fallback to 15 days
                        const daysUsed = effectiveTotalDuration - daysLeft;
                        const progress = (daysUsed / effectiveTotalDuration) * 100;
                        
                        const statusType = membership.type === 'trial' ? 'En Prueba' : 'Activa';

                        return {
                            status: statusType,
                            daysLeft: daysLeft,
                            endDate: expiryDate,
                            progress: Math.min(100, progress),
                        };
                    }
                } else {
                    return { status: 'Vencida', daysLeft: 0, endDate: expiryDate, progress: 100 };
                }
            }
        }
    }
    
    // Default to Vencida if no other conditions are met
    if (isServicesBusiness(profile)) {
        return { status: 'Gratis', daysLeft: null, endDate: null, progress: 0 };
    }
    return { status: 'Vencida', daysLeft: 0, endDate: null, progress: 100 };
}
