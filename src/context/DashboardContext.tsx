
"use client"

import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from "react"
import { useAuth } from "@/hooks/useAuthRedirect"
import { BusinessProfile, Service, Cancha, Space, getBusinessProfile, getServices, getCanchas, getSpaces } from "@/services/data"
import { subscribeOwnerProfile } from "@/lib/owner-workspace-client"
import { db } from "@/lib/firebase"

interface DashboardContextType {
    businessProfile: BusinessProfile | null;
    isProfileLoading: boolean;
    services: Service[];
    canchas: Cancha[];
    spaces: Space[];
    isServicesLoading: boolean;
    refetchProfileAndServices: () => Promise<void>;
}

const DashboardContext = createContext<DashboardContextType>({
    businessProfile: null,
    isProfileLoading: true,
    services: [],
    canchas: [],
    spaces: [],
    isServicesLoading: true,
    refetchProfileAndServices: async () => {},
});

export const useDashboard = () => {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error("useDashboard must be used within a DashboardProvider");
    }
    return context;
};

export const DashboardProvider = ({ children }: { children: ReactNode }) => {
    const { user, loading: authLoading } = useAuth();
    const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
    const [services, setServices] = useState<Service[]>([]);
    const [canchas, setCanchas] = useState<Cancha[]>([]);
    const [spaces, setSpaces] = useState<Space[]>([]);
    const [isProfileLoading, setIsProfileLoading] = useState(true);
    const [isServicesLoading, setIsServicesLoading] = useState(true);
    const activeUserIdRef = useRef<string | null>(null);
    const sessionVersionRef = useRef(0);
    const fetchVersionRef = useRef(0);
    const profileSnapshotVersionRef = useRef(0);

    const fetchData = useCallback(async (userId: string, sessionVersion: number, background = false) => {
        const fetchVersion = ++fetchVersionRef.current;
        const snapshotVersion = profileSnapshotVersionRef.current;
        // A same-account refresh must not unmount the dashboard and discard open dialogs.
        if (!background) setIsProfileLoading(true);
        setIsServicesLoading(true);
        try {
            const [profile, userServices, userCanchas, userSpaces] = await Promise.all([
                getBusinessProfile(userId),
                getServices(userId),
                getCanchas(userId),
                getSpaces(userId)
            ]);
            if (activeUserIdRef.current !== userId || sessionVersionRef.current !== sessionVersion || fetchVersionRef.current !== fetchVersion) return;
            // A live snapshot is newer than the initial request, including a
            // snapshot that says the document was deleted.
            if (profileSnapshotVersionRef.current === snapshotVersion) setBusinessProfile(profile);
            setServices(userServices);
            setCanchas(userCanchas);
            setSpaces(userSpaces);
        } catch (error) {
            if (activeUserIdRef.current === userId && sessionVersionRef.current === sessionVersion && fetchVersionRef.current === fetchVersion) {
                console.error("[DashboardProvider] Failed to fetch initial data:", error);
            }
        } finally {
            if (activeUserIdRef.current === userId && sessionVersionRef.current === sessionVersion && fetchVersionRef.current === fetchVersion) {
                setIsProfileLoading(false);
                setIsServicesLoading(false);
            }
        }
    }, []);

    const refetchProfileAndServices = useCallback(async () => {
        if (user && activeUserIdRef.current === user.uid) {
            await fetchData(user.uid, sessionVersionRef.current, true);
        }
    }, [user, fetchData]);

    useEffect(() => {
        const userId = user?.uid ?? null;
        const sessionVersion = ++sessionVersionRef.current;
        fetchVersionRef.current += 1;
        profileSnapshotVersionRef.current += 1;
        activeUserIdRef.current = null;
        setBusinessProfile(null);
        setServices([]);
        setCanchas([]);
        setSpaces([]);

        if (authLoading) {
            setIsProfileLoading(true);
            setIsServicesLoading(true);
            return;
        }
        if (!userId || !db) {
            setIsProfileLoading(false);
            setIsServicesLoading(false);
            return;
        }

        activeUserIdRef.current = userId;

        // Fetch initial data once
        void fetchData(userId, sessionVersion);

        // Then, set up a real-time listener for the business profile
        const unsubProfile = subscribeOwnerProfile(userId, (profile) => {
            if (activeUserIdRef.current !== userId || sessionVersionRef.current !== sessionVersion) return;
            profileSnapshotVersionRef.current += 1;
            setBusinessProfile(profile);
            setIsProfileLoading(false);
        }, (error) => {
            if (activeUserIdRef.current === userId && sessionVersionRef.current === sessionVersion) {
                console.error("[DashboardProvider] Error listening to profile updates:", error);
            }
        });

        // Cleanup listeners on unmount
        return () => {
            if (activeUserIdRef.current === userId) activeUserIdRef.current = null;
            sessionVersionRef.current += 1;
            fetchVersionRef.current += 1;
            unsubProfile();
        };
    }, [user, authLoading, fetchData]);

    return (
        <DashboardContext.Provider value={{ businessProfile, isProfileLoading, services, canchas, spaces, isServicesLoading, refetchProfileAndServices }}>
            {children}
        </DashboardContext.Provider>
    );
};
