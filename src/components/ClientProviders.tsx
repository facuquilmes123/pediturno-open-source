

"use client";

import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from 'next-themes';
import { useEffect } from 'react';
import { listenForInstallPrompt } from '@/lib/pwa-install';

export function ClientProviders({ children }: { children: React.ReactNode }) {
    useEffect(() => listenForInstallPrompt(), []);
    return (
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
            {children}
            <Toaster />
        </ThemeProvider>
    );
}
