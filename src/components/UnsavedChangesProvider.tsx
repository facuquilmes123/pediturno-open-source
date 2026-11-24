

"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface UnsavedChangesContextType {
    hasUnsavedChanges: boolean;
    setHasUnsavedChanges: (hasChanges: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | undefined>(undefined);

export const useUnsavedChanges = () => {
    const context = useContext(UnsavedChangesContext);
    if (!context) {
        throw new Error('useUnsavedChanges must be used within a UnsavedChangesProvider');
    }
    return context;
};

export default function UnsavedChangesProvider({ children }: { children: ReactNode }) {
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    useEffect(() => {
        if (!hasUnsavedChanges) return;

        const warning = 'Tenés cambios sin guardar. Si salís ahora, se perderán. ¿Querés continuar?';
        // Keep the exact App Router state for the page that owns the form. If a
        // history navigation is cancelled, restoring this object keeps Next's
        // internal tree and the address bar aligned with the UI that stayed put.
        const protectedUrl = window.location.href;
        const protectedState = window.history.state;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = 'Tienes cambios sin guardar. ¿Estás seguro de que quieres salir?';
        };

        const handlePopState = (event: PopStateEvent) => {
            if (window.confirm(warning)) return;

            // popstate itself cannot be cancelled. Stop Next from consuming the
            // destination state, then put back the URL and the unmodified state
            // captured before Back/Forward was pressed.
            event.stopImmediatePropagation();
            window.history.pushState(protectedState, '', protectedUrl);
        };

        const handleLinkClick = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const link = target.closest<HTMLAnchorElement>('a[href]');
            if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

            const destination = new URL(link.href, window.location.href);
            const current = new URL(window.location.href);
            const isInternalNavigation = destination.origin === current.origin &&
                `${destination.pathname}${destination.search}${destination.hash}` !== `${current.pathname}${current.search}${current.hash}`;
            if (!isInternalNavigation) return;

            const shouldLeave = window.confirm(warning);
            if (!shouldLeave) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        window.addEventListener('popstate', handlePopState, true);
        document.addEventListener('click', handleLinkClick, true);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('popstate', handlePopState, true);
            document.removeEventListener('click', handleLinkClick, true);
        };
    }, [hasUnsavedChanges]);

    return (
        <UnsavedChangesContext.Provider value={{ hasUnsavedChanges, setHasUnsavedChanges }}>
            {children}
        </UnsavedChangesContext.Provider>
    );
}
