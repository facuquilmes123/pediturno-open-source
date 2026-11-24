'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ESTETICA_GUIDE_PATH } from '@/lib/public-analytics';
import { getPediturnoPortalHost } from '@/lib/verticals';
const KEY = 'pediturno_analytics_consent_v1';
const ID = 'G-XXXXXXXXXX';
type Choice = 'accepted' | 'rejected' | null;
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
export function analyticsAllowedPath(path: string) { return ['/', '/faq', '/terminos', '/privacy-policy', ESTETICA_GUIDE_PATH].includes(path); }
export function openAnalyticsPreferences() { window.dispatchEvent(new Event('pediturno:analytics-preferences')); }
export default function AnalyticsConsent() {
  const path = usePathname() || '/';
  const [choice, setChoice] = useState<Choice>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [isServicesHost, setIsServicesHost] = useState(false);
  const allowed = analyticsAllowedPath(path) && (path !== ESTETICA_GUIDE_PATH || isServicesHost);
  useEffect(() => {
    setIsServicesHost(getPediturnoPortalHost(window.location.hostname) === 'pediturno.com');
    let stored: Choice = null;
    try { const value = localStorage.getItem(KEY); if (value === 'accepted' || value === 'rejected') stored = value; } catch { /* Storage can be unavailable. */ }
    setChoice(stored); setVisible(!stored);
    const open = () => setVisible(true);
    window.addEventListener('pediturno:analytics-preferences', open);
    return () => window.removeEventListener('pediturno:analytics-preferences', open);
  }, []);
  useEffect(() => {
    const win = window as AnalyticsWindow;
    (win as unknown as Record<string, unknown>)[`ga-disable-${ID}`] = choice !== 'accepted' || !allowed;
    if (choice !== 'accepted' || !allowed || !loaded) return;
    win.gtag?.('config', ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, page_location: `${window.location.origin}${path}`, page_referrer: '' });
    win.gtag?.('event', 'page_view', { page_location: `${window.location.origin}${path}`, page_referrer: '', page_title: document.title });
  }, [choice, allowed, loaded, path]);
  function choose(value: Exclude<Choice, null>) {
    try { localStorage.setItem(KEY, value); } catch { /* Keep the choice for this session. */ }
    setChoice(value); setVisible(false);
    window.dispatchEvent(new Event('pediturno:analytics-choice'));
    if (value === 'rejected') {
      (window as AnalyticsWindow).gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' });
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0].trim();
        if (!/^_ga($|_)/.test(name)) continue;
        for (const domain of ['', `; domain=${window.location.hostname}`, '; domain=pediturno.com']) document.cookie = `${name}=; Max-Age=0; path=/${domain}; SameSite=Lax; Secure`;
      }
    }
  }
  return <>
    {choice === 'accepted' && allowed && <Script id="pediturno-consented-analytics" src={`https://www.googletagmanager.com/gtag/js?id=${ID}`} strategy="afterInteractive" onReady={() => {
      const win = window as AnalyticsWindow; win.dataLayer ??= [];
      win.gtag ??= function () { win.dataLayer!.push(arguments); };
      win.gtag('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied' });
      win.gtag('js', new Date()); setLoaded(true);
      window.dispatchEvent(new Event('pediturno:analytics-ready'));
    }} />}
    {visible && allowed && <section aria-label="Preferencias de privacidad" className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-3xl rounded-2xl border bg-background p-4 shadow-xl sm:p-5">
      <p className="font-semibold">Vos elegís si compartís datos de uso</p><p className="mt-1 text-sm text-muted-foreground">Usamos cookies opcionales de Google Analytics para mejorar el sitio. Podés rechazarlas y usar Pediturno normalmente. <Link className="underline" href="/privacy-policy">Ver Privacidad</Link>.</p>
      <div className="mt-3 flex flex-wrap gap-3"><Button variant="outline" onClick={() => choose('rejected')}>Rechazar analítica</Button><Button onClick={() => choose('accepted')}>Aceptar analítica</Button></div>
    </section>}
  </>;
}
