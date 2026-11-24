

import CalendarClientPage from "@/app/dashboard/calendario/CalendarClientPage";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = 'force-dynamic';

// This component is now simplified to only provide the suspense boundary.
// All data fetching is handled on the client side for a better user experience and real-time updates.
function CalendarData() {
    return <CalendarClientPage />;
}

function CalendarSkeleton() {
    return (
        <div className="flex flex-col gap-8">
            <div className="flex items-center gap-4">
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-5 w-96" />
                </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-1">
                    <Skeleton className="h-[350px] w-full" />
                </div>
                <div className="lg:col-span-2">
                    <Skeleton className="h-96 w-full" />
                </div>
            </div>
        </div>
    );
}

export default function CalendarioPage() {
    return (
        <Suspense fallback={<CalendarSkeleton />}>
            <CalendarData />
        </Suspense>
    );
}
