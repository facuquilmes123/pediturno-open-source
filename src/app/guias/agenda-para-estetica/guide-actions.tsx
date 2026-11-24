'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { openAnalyticsPreferences } from '@/components/AnalyticsConsent';
import { trackEsteticaEvent } from '@/lib/public-analytics';

const AuthModal = dynamic(() => import('@/components/AuthModal'), { ssr: false });

export default function GuideActions() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button size="lg" className="min-h-12 rounded-xl font-bold" onClick={() => {
          trackEsteticaEvent('trial_cta');
          setIsOpen(true);
        }}>
          Crear mi agenda gratis
        </Button>
        <Button size="lg" variant="outline" asChild className="min-h-12 rounded-xl">
          <Link href="/demo-servicios" onClick={() => trackEsteticaEvent('demo_open')}>Probar una reserva</Link>
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">La demo muestra el recorrido de Servicios con una barbería ficticia.</p>
      <button type="button" onClick={openAnalyticsPreferences} className="mt-4 rounded text-sm text-muted-foreground underline underline-offset-4">
        Preferencias de privacidad
      </button>
      {isOpen && <AuthModal isOpen={isOpen} onOpenChange={setIsOpen} initialView="register" initialVertical="services" />}
    </>
  );
}
