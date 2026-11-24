"use client";

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
  Globe2,
  LayoutDashboard,
  LogIn,
  Menu,
  Monitor,
  QrCode,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Trophy,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { ProductVertical } from '@/lib/verticals';
import ProductProof, { demoPath } from '@/components/landing/ProductProof';
import BusinessCarousel from '@/components/landing/BusinessCarousel';
import PortalRecommendations from '@/components/landing/PortalRecommendations';
import { openAnalyticsPreferences } from '@/components/AnalyticsConsent';
import { ESTETICA_GUIDE_PATH, heroAssignment, trackPublicEvent } from '@/lib/public-analytics';
import GooglePlayDownload from '@/components/landing/GooglePlayDownload';

const AuthModal = dynamic(() => import('@/components/AuthModal'), { ssr: false });
type AuthView = 'login' | 'register';
type LandingPortalProps = { vertical: ProductVertical; priceLabel: string; playDownloadAvailable?: boolean };

const portalContent = {
  services: {
    name: 'Pediturno',
    eyebrow: 'Agenda online para servicios',
    title: 'Tus turnos, claros para vos y simples para tus clientes.',
    description: 'Organizá tus turnos desde Android o desde la web en tu PC, con la misma cuenta. Compartí tu enlace y dejá que tus clientes reserven sin instalar nada.',
    primaryCta: 'Crear mi agenda gratis',
    loginLabel: 'Ingresar a mi agenda',
    image: '/images/pediturno-servicios.webp',
    imageAlt: 'Espacio de atención profesional con una agenda de turnos organizada mediante Pediturno',
    accent: 'text-cyan-800 dark:text-cyan-300',
    accentBackground: 'bg-primary/15',
    accentBorder: 'border-primary/30',
    button: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20',
    subtleBackground: 'bg-cyan-50/70 dark:bg-cyan-950/15',
    productLabel: 'Plan Servicios',
    steps: [
      ['Configurá tu negocio', 'Cargá el nombre, la ubicación y los datos que verá cada cliente.'],
      ['Publicá servicios y horarios', 'Definí duración, precio y disponibilidad para cada servicio.'],
      ['Compartí tu enlace', 'Tus clientes eligen un horario y vos gestionás la solicitud desde el panel.'],
    ],
    features: [
      [CalendarDays, 'Agenda semanal', 'Visualizá solicitudes y turnos en una agenda ordenada por día.'],
      [Users, 'Clientes organizados', 'Conservá los datos necesarios para gestionar cada reserva.'],
      [Globe2, 'Página pública propia', 'Compartí un enlace simple que funciona desde cualquier navegador.'],
      [QrCode, 'QR para compartir', 'Generá un acceso directo para el mostrador, redes o material impreso.'],
    ],
    planFeatures: ['Página pública de reservas', 'Servicios, horarios y precios', 'Agenda y gestión de clientes', 'Código QR para compartir', 'Soporte por email dentro de la cuenta'],
    faqs: [
      ['¿Mis clientes tienen que instalar una aplicación?', 'No. Reservan desde tu página pública en el navegador, tanto en celular como en computadora.'],
      ['¿Puedo definir horarios distintos para cada servicio?', 'Sí. Cada servicio puede tener su duración, precio y disponibilidad semanal.'],
      ['¿La prueba requiere tarjeta?', 'No. Servicios incluye Gratis permanente con todas las funciones y hasta 40 turnos por mes, sin tarjeta ni anuncios.'],
      ['¿Puedo gestionar mi negocio desde una PC?', 'Sí. Entrá a pediturno.com e iniciá sesión con el mismo correo y método de acceso que usás en Android: Google o correo y contraseña. Gestionás la misma agenda, clientes, servicios y horarios, sin crear otra cuenta.'],
    ],
  },
  sports_facility: {
    name: 'Pediturno Canchas',
    eyebrow: 'Reservas online para complejos deportivos',
    title: 'Cada cancha disponible. Cada reserva en su lugar.',
    description: 'Publicá horarios y precios por cancha, evitá superposiciones y administrá el movimiento de tu complejo desde una sola grilla.',
    primaryCta: 'Crear mi complejo gratis',
    loginLabel: 'Ingresar a mi complejo',
    image: '/images/landing/canchas-portal-20261005.webp',
    imageAlt: 'Complejo de pádel y fútbol con sus reservas organizadas mediante Pediturno Canchas',
    accent: 'text-emerald-800 dark:text-emerald-400',
    accentBackground: 'bg-emerald-500/15',
    accentBorder: 'border-emerald-500/30',
    button: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-emerald-600/20',
    subtleBackground: 'bg-emerald-50/80 dark:bg-emerald-950/20',
    productLabel: 'Plan Canchas',
    steps: [
      ['Registrá tu complejo', 'Cargá la información principal y el enlace que vas a compartir.'],
      ['Configurá cada cancha', 'Definí deporte, precio, duración y disponibilidad semanal por espacio.'],
      ['Recibí reservas', 'Tus clientes eligen cancha y horario; vos gestionás todo desde la grilla.'],
    ],
    features: [
      [CalendarCheck2, 'Disponibilidad por cancha', 'Cada espacio conserva sus propios horarios, duración y precio.'],
      [LayoutDashboard, 'Grilla del complejo', 'Consultá las reservas y detectá rápidamente los horarios ocupados.'],
      [Trophy, 'Sorteador deportivo', 'Armá cruces iniciales para torneos desde el panel de canchas.'],
      [QrCode, 'Enlace y QR propios', 'Compartí la página del complejo en recepción, redes y WhatsApp.'],
    ],
    planFeatures: ['Página pública del complejo', 'Canchas, horarios y precios', 'Grilla de reservas', 'Sorteador de cruces iniciales', 'Código QR para compartir', 'Soporte por email dentro de la cuenta'],
    faqs: [
      ['¿Puedo cargar varias canchas?', 'Sí. Podés publicar distintas canchas y configurar el precio, la duración y la disponibilidad de cada una.'],
      ['¿Cómo se evitan horarios superpuestos?', 'La disponibilidad se calcula por cancha y franja horaria para que el cliente vea las opciones libres al reservar.'],
      ['¿La prueba requiere tarjeta?', 'No. Podés probar Pediturno Canchas durante 15 días sin ingresar una tarjeta.'],
      ['¿Este acceso también sirve para negocios de servicios?', 'Este portal está dedicado a complejos y canchas. Para servicios profesionales, estética o talleres usá pediturno.com.'],
    ],
  },
  spaces: {
    name: 'Pediturno Espacios',
    eyebrow: 'Reservas online para lugares y jornadas',
    title: 'Cada fecha de tu espacio, clara desde la primera consulta.',
    description: 'Mostrá salones, quinchos, SUM y estudios en una página propia. Organizá la disponibilidad de cada espacio sin depender de mensajes sueltos.',
    primaryCta: 'Crear mi espacio gratis',
    loginLabel: 'Ingresar a mi espacio',
    image: '/images/landing/espacios-salon-eventos.webp',
    imageAlt: 'Salón de eventos ilustrativo preparado para una celebración',
    accent: 'text-violet-700 dark:text-violet-300',
    accentBackground: 'bg-violet-500/15',
    accentBorder: 'border-violet-500/30',
    button: 'bg-violet-700 text-white hover:bg-violet-800 shadow-violet-700/20',
    subtleBackground: 'bg-violet-50/70 dark:bg-violet-950/20',
    productLabel: 'Plan Espacios',
    steps: [
      ['Registrá tu espacio', 'Cargá el nombre, la ubicación y el enlace que vas a compartir.'],
      ['Definí fechas y franjas', 'Configurá los horarios que ofrecés y el valor de cada reserva.'],
      ['Recibí consultas ordenadas', 'Tus clientes eligen un espacio y una fecha disponible desde tu página.'],
    ],
    features: [
      [CalendarCheck2, 'Disponibilidad por espacio', 'Organizá qué fechas y horarios se muestran para cada salón, quincho o estudio.'],
      [LayoutDashboard, 'Agenda en una sola vista', 'Consultá las reservas y las franjas ocupadas sin perder contexto.'],
      [Globe2, 'Página pública propia', 'Compartí un enlace claro para que tus clientes vean qué está disponible.'],
      [QrCode, 'Enlace y QR para difundir', 'Llevá tu página a redes, cartelería y mensajes de consulta.'],
    ],
    planFeatures: ['Página pública del espacio', 'Fechas, franjas y precios', 'Agenda de reservas', 'Código QR para compartir', 'Soporte por email dentro de la cuenta'],
    faqs: [
      ['¿Qué tipos de espacios puedo publicar?', 'Podés usarlo para salones, quinchos, SUM, casas quinta, terrazas, jardines, auditorios, salas de capacitación y estudios de producción.'],
      ['¿Puedo organizar reservas de varias horas?', 'Sí. Configurás las franjas que ofrecés para cada espacio y tus clientes ven las opciones disponibles antes de enviar la solicitud.'],
      ['¿La prueba requiere tarjeta?', 'No. Podés probar Pediturno Espacios durante 15 días sin ingresar una tarjeta.'],
      ['¿Este acceso también sirve para canchas o servicios?', 'Este portal está pensado para administrar espacios. Para servicios usá pediturno.com y para complejos deportivos, canchas.pediturno.com.'],
    ],
  },
} as const;

function ProductMark({ vertical }: { vertical: ProductVertical }) {
  const isSports = vertical === 'sports_facility';
  const isSpaces = vertical === 'spaces';
  return (
    <span className="inline-flex items-center gap-2.5 font-black tracking-tight text-foreground">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${isSports ? 'bg-emerald-600 text-white' : isSpaces ? 'bg-violet-700 text-white' : 'bg-primary text-primary-foreground'}`} aria-hidden="true">
        {isSports ? <Trophy className="h-5 w-5" /> : isSpaces ? <CalendarCheck2 className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
      </span>
      <span className="text-lg sm:text-xl">{isSports ? 'Pediturno Canchas' : isSpaces ? 'Pediturno Espacios' : 'Pediturno'}</span>
    </span>
  );
}

export default function LandingPortal({ vertical, priceLabel, playDownloadAvailable = false }: LandingPortalProps) {
  const content = portalContent[vertical];
  const isSports = vertical === 'sports_facility';
  const isSpaces = vertical === 'spaces';
  const [authRequest, setAuthRequest] = useState<{ open: boolean; view: AuthView }>({ open: false, view: 'login' });
  const [variant, setVariant] = useState<'a' | 'b'>('a');
  const openAuth = (view: AuthView) => {
    if (view === 'register') trackPublicEvent('trial_cta', { vertical, variant });
    setAuthRequest({ open: true, view });
  };

  useEffect(() => {
    const assign = () => setVariant(heroAssignment(vertical));
    const exposed = () => { const assigned = heroAssignment(vertical); setVariant(assigned); trackPublicEvent('hero_exposure', { vertical, variant: assigned }); };
    assign();
    window.addEventListener('pediturno:analytics-choice', assign);
    window.addEventListener('pediturno:analytics-ready', exposed);
    return () => { window.removeEventListener('pediturno:analytics-choice', assign); window.removeEventListener('pediturno:analytics-ready', exposed); };
  }, [vertical]);

  const heroTitle = variant === 'a' ? content.title : isSports
    ? 'Menos mensajes para coordinar. Más orden en las reservas de tu complejo.'
    : isSpaces ? 'Dejá de buscar fechas entre mensajes. Tu espacio, con una agenda online.'
    : 'Dejá de coordinar turnos por WhatsApp a deshora. Tu agenda online disponible las 24 hs.';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('login') === '1') setAuthRequest({ open: true, view: 'login' });
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/25">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80">
        <div className="container flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#inicio" aria-label={`${content.name}, ir al inicio`}><ProductMark vertical={vertical} /></a>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground lg:flex" aria-label="Navegación principal">
            <a className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#como-funciona">Cómo funciona</a>
            {vertical === 'services' && <a className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#app">Android y PC</a>}
            <a className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#funciones">Funciones</a>
            <a className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#precio">Precio</a>
            <a className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="#preguntas">Preguntas</a>
          </nav>
          <div className="hidden items-center gap-2 sm:flex">
            <Button variant="ghost" className="h-11" onClick={() => openAuth('login')}><LogIn className="mr-2 h-4 w-4" aria-hidden="true" />Iniciar sesión</Button>
            <Button className={`h-11 rounded-xl font-bold shadow-lg ${content.button}`} onClick={() => openAuth('register')}>Probar gratis</Button>
          </div>
          <Sheet>
            <SheetTrigger asChild><Button variant="outline" size="icon" className="h-11 w-11 sm:hidden" aria-label="Abrir menú"><Menu className="h-5 w-5" aria-hidden="true" /></Button></SheetTrigger>
            <SheetContent className="w-[min(88vw,360px)] overflow-y-auto">
              <SheetHeader><SheetTitle><ProductMark vertical={vertical} /></SheetTitle></SheetHeader>
              <nav className="mt-8 grid gap-2" aria-label="Navegación móvil">
                {([['Cómo funciona', '#como-funciona'], ...(vertical === 'services' ? [['Android y PC', '#app']] : []), ['Funciones', '#funciones'], ['Precio', '#precio'], ['Preguntas', '#preguntas']]).map(([label, href]) => (
                  <SheetClose asChild key={href}><a href={href} className="flex min-h-12 items-center rounded-xl px-4 text-base font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</a></SheetClose>
                ))}
                <SheetClose asChild><Button variant="outline" className="mt-4 h-12" onClick={() => openAuth('login')}>{content.loginLabel}</Button></SheetClose>
                <SheetClose asChild><Button className={`h-12 font-bold ${content.button}`} onClick={() => openAuth('register')}>{content.primaryCta}</Button></SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main>
        <section id="inicio" className="relative isolate overflow-hidden border-b border-border/70">
          <div className={`absolute inset-0 -z-20 ${content.subtleBackground}`} />
          <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(circle_at_72%_12%,rgba(100,204,201,0.2),transparent_55%)] motion-reduce:hidden" />
          <div className="container grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:gap-14 lg:py-24">
            <div className="min-w-0 max-w-2xl">
              <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] ${content.accentBackground} ${content.accentBorder} ${content.accent}`}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{content.eyebrow}</div>
              <h1 className="mt-6 text-balance text-4xl font-black leading-[1.04] tracking-[-0.04em] sm:text-5xl lg:text-6xl">{heroTitle}</h1>
              <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-slate-600 dark:text-slate-300 sm:text-xl">{content.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button size="lg" className={`min-h-12 rounded-xl px-6 text-base font-bold shadow-xl ${content.button}`} onClick={() => openAuth('register')}>{content.primaryCta}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
                <Button size="lg" variant="outline" asChild className="min-h-12 rounded-xl px-6 text-base font-semibold"><Link href={demoPath(vertical)} target="_blank" rel="noopener noreferrer" onClick={() => trackPublicEvent('demo_open', { vertical, variant })}>Probar reserva de ejemplo</Link></Button>
              </div>
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
                {[vertical === 'services' ? 'Gratis: 40 turnos/mes' : '15 días gratis', 'Sin tarjeta', 'Acceso web'].map((label) => <span key={label} className="inline-flex items-center gap-1.5"><Check className={`h-4 w-4 ${content.accent}`} aria-hidden="true" />{label}</span>)}
              </div>
              {vertical === 'services' && <div className="mt-6"><GooglePlayDownload available={playDownloadAvailable} /><p className="mt-2 text-sm text-muted-foreground">{playDownloadAvailable ? 'Android y PC, con la misma cuenta y los datos de tu negocio.' : 'La app Android está en revisión. Ya podés empezar desde la web.'}</p></div>}
            </div>
            <BusinessCarousel vertical={vertical} />
          </div>
        </section>

        {vertical === 'services' && <section id="app" aria-labelledby="app-title" className="border-b py-14 sm:py-20">
          <div className="container max-w-6xl px-4 sm:px-6">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-cyan-800 dark:text-cyan-300">Una cuenta, tu negocio</p>
            <h2 id="app-title" className="mt-3 max-w-3xl text-3xl font-black tracking-tight sm:text-4xl">En el celular o en tu PC. La misma agenda.</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border bg-card p-6 sm:p-8">
                <Smartphone className="h-7 w-7 text-primary" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">Pediturno para Android</h3>
                <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">Llevá tu agenda, clientes y servicios con vos. Consultá y gestioná tu negocio desde el celular.</p>
                <div className="mt-5"><GooglePlayDownload available={playDownloadAvailable} /></div>
                {!playDownloadAvailable && <p className="mt-3 text-sm text-muted-foreground">La descarga se habilitará cuando esté disponible en Google Play. Mientras tanto, usá la versión web.</p>}
              </article>
              <article className="rounded-2xl border bg-card p-6 sm:p-8">
                <Monitor className="h-7 w-7 text-primary" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">Gestioná también desde tu PC</h3>
                <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">Entrá a <strong className="font-semibold text-foreground">pediturno.com</strong> con la misma cuenta. Administrá agenda, clientes, servicios y horarios desde el navegador, sin instalar nada.</p>
                <Button variant="outline" className="mt-6 min-h-12 rounded-xl px-5 font-semibold" onClick={() => openAuth('login')}>Ingresar desde la web<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button>
                <p className="mt-3 text-sm text-muted-foreground">Usá el mismo método de acceso: Google o correo y contraseña. No necesitás otra cuenta.</p>
              </article>
            </div>
          </div>
        </section>}

        <section aria-labelledby="why-title" className="border-b py-14"><div className="container max-w-7xl px-4 sm:px-6"><h2 id="why-title" className="text-3xl font-bold">¿Por qué elegir Pediturno?</h2><p className="mt-3 text-muted-foreground">Diseñado para resolver el día a día de tu negocio.</p><div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{[
          ['Tu cliente no instala nada', 'Entra desde tu enlace, elige el recurso y consulta los horarios disponibles.'],
          ['Tu horario, tus reglas', 'Configurá descansos, duración, días no laborables y disponibilidad por recurso.'],
          ['Recordatorios automáticos', 'Confirmaciones por email y avisos push cuando estén configurados y autorizados.'],
          vertical === 'services'
            ? ['Reservas sin complicaciones', 'Tus clientes eligen un horario y reciben el estado de su reserva. Acordá el cobro directamente con ellos.']
            : ['Cobro de señas opcional', 'Conectá Mercado Pago y configurá una seña. Pediturno no añade comisión; aplican los cargos del proveedor.'],
        ].map(([title, text]) => <article key={title} className="rounded-xl border bg-card p-5"><CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" /><h3 className="mt-3 font-bold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p></article>)}</div></div></section>

        <section id="como-funciona" className={`py-16 sm:py-24 ${content.subtleBackground}`} aria-labelledby="how-title"><div className="container max-w-6xl px-4 sm:px-6"><div className="max-w-2xl"><p className={`text-sm font-black uppercase tracking-[0.16em] ${content.accent}`}>Tres pasos</p><h2 id="how-title" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Empezá sin complicar tu operación</h2></div><ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-3">{content.steps.map(([title, description], index) => <li key={title} className="bg-card p-6 sm:p-8"><span className={`grid h-10 w-10 place-items-center rounded-full text-sm font-black ${content.accentBackground} ${content.accent}`}>{index + 1}</span><h3 className="mt-5 text-xl font-black">{title}</h3><p className="mt-2 leading-relaxed text-muted-foreground">{description}</p></li>)}</ol></div></section>

        <section className="border-b py-16 sm:py-20" aria-labelledby="demo-title"><div className="container grid max-w-6xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-2"><div><p className={`text-sm font-black uppercase tracking-[0.16em] ${content.accent}`}>Tu página, con tu identidad</p><h2 id="demo-title" className="mt-3 text-3xl font-black tracking-tight">Mirá cómo puede quedar tu negocio</h2><p className="mt-4 leading-relaxed text-muted-foreground">Un tema con colores propios, fotos, servicios o espacios, precios y accesos a tus redes y ubicación. Explorá una página completa y simulá una reserva.</p><p className="mt-3 text-sm text-muted-foreground">La demo usa un negocio ficticio y no envía mensajes ni guarda reservas.</p></div><ProductProof vertical={vertical} onDemoOpen={() => trackPublicEvent('demo_open', { vertical, variant })} /></div></section>

        {vertical === 'services' && (
          <section className="border-b bg-primary/5 py-8" aria-labelledby="service-guides-title">
            <div className="container mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 id="service-guides-title" className="text-lg font-bold">¿Atendés en un centro de estética?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Mirá cómo organizar tratamientos con duraciones distintas.</p>
              </div>
              <Button asChild variant="outline" className="min-h-11 shrink-0 self-start sm:self-auto">
                <Link href={ESTETICA_GUIDE_PATH}>Ver una agenda de ejemplo</Link>
              </Button>
            </div>
          </section>
        )}

        <section id="funciones" className="py-16 sm:py-24" aria-labelledby="features-title"><div className="container max-w-6xl px-4 sm:px-6"><div className="mx-auto max-w-2xl text-center"><p className={`text-sm font-black uppercase tracking-[0.16em] ${content.accent}`}>Lo que usás todos los días</p><h2 id="features-title" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Menos mensajes sueltos. Más control.</h2></div><div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">{content.features.map(([Icon, title, description]) => <article key={title} className="bg-card p-6 sm:p-8"><Icon className={`h-7 w-7 ${content.accent}`} aria-hidden="true" /><h3 className="mt-4 text-lg font-black">{title}</h3><p className="mt-2 leading-relaxed text-muted-foreground">{description}</p></article>)}</div></div></section>

        <section id="precio" className={`border-y border-border/70 py-16 sm:py-24 ${content.subtleBackground}`} aria-labelledby="pricing-title"><div className="container max-w-5xl px-4 sm:px-6"><div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]"><div><p className={`text-sm font-black uppercase tracking-[0.16em] ${content.accent}`}>Precio transparente</p><h2 id="pricing-title" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{vertical === 'services' ? 'Gratis o Pro, con las mismas funciones' : 'Un plan mensual para gestionar tu negocio'}</h2><p className="mt-4 text-lg leading-relaxed text-muted-foreground">{vertical === 'services' ? 'Usá Gratis todas las funciones con hasta 40 turnos por mes, sin anuncios. Para turnos ilimitados, contratá Pro desde Pediturno para Android mediante Google Play. El precio base es USD 7 mensuales; Google muestra la moneda local y las condiciones antes de confirmar. Tus clientes siguen reservando desde la web.' : 'Probalo durante 15 días, sin tarjeta ni débitos automáticos. Si no activás el plan, se pausan las nuevas reservas sin borrar automáticamente tus datos. Podés reactivar desde Membresía.'}</p></div><article className={`overflow-hidden rounded-3xl border-2 bg-card p-6 shadow-[0_25px_70px_-45px_rgba(15,23,42,0.7)] sm:p-8 ${content.accentBorder}`}><p className={`text-sm font-black ${content.accent}`}>{content.productLabel}</p><div className="mt-3 flex flex-wrap items-end gap-x-2"><span className="text-5xl font-black tracking-[-0.05em]">{priceLabel}</span><span className="pb-1 text-sm font-semibold text-muted-foreground">{vertical === 'services' ? '/ mes · Google Play' : 'ARS / mes'}</span></div><ul className="mt-7 grid gap-3 text-sm sm:grid-cols-2">{content.planFeatures.map((feature) => <li key={feature} className="flex gap-2.5"><Check className={`mt-0.5 h-4 w-4 shrink-0 ${content.accent}`} aria-hidden="true" /><span>{feature}</span></li>)}</ul><Button className={`mt-8 min-h-12 w-full rounded-xl text-base font-bold shadow-xl ${content.button}`} onClick={() => openAuth('register')}>{vertical === 'services' ? 'Crear cuenta Gratis' : 'Probar 15 días gratis'}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button><p className="mt-3 text-center text-xs text-muted-foreground">{vertical === 'services' ? 'Gratis: 40 turnos por mes. Pro: turnos ilimitados. Ambos sin anuncios.' : 'Sin tarjeta para iniciar la prueba.'}</p></article></div></div></section>

        <section id="preguntas" className="py-16 sm:py-24" aria-labelledby="faq-title"><div className="container max-w-3xl px-4 sm:px-6"><p className={`text-sm font-black uppercase tracking-[0.16em] ${content.accent}`}>Preguntas frecuentes</p><h2 id="faq-title" className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Antes de empezar</h2><Accordion type="single" collapsible className="mt-8 space-y-3">{content.faqs.map(([question, answer], index) => <AccordionItem key={question} value={`faq-${index}`} className="rounded-xl border border-border bg-card px-5"><AccordionTrigger className="min-h-14 text-left text-base font-bold hover:no-underline">{question}</AccordionTrigger><AccordionContent className="pb-5 leading-relaxed text-muted-foreground">{answer}</AccordionContent></AccordionItem>)}</Accordion><p className="mt-6 text-center"><Link href="https://pediturno.com/faq" className="font-semibold text-foreground underline">Revisá nuestras preguntas frecuentes detalladas →</Link></p></div></section>

        <section className={`border-t border-border/70 py-14 sm:py-20 ${content.subtleBackground}`} aria-labelledby="final-cta-title"><div className="container max-w-4xl px-4 text-center sm:px-6"><ShieldCheck className={`mx-auto h-8 w-8 ${content.accent}`} aria-hidden="true" /><h2 id="final-cta-title" className="mx-auto mt-4 max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">{isSports ? 'Ordená las reservas de tu complejo desde hoy.' : isSpaces ? 'Hacé que cada fecha disponible encuentre su lugar.' : 'Dale a tus clientes una forma simple de pedir turno.'}</h2><Button size="lg" className={`mt-7 min-h-12 rounded-xl px-7 text-base font-bold shadow-xl ${content.button}`} onClick={() => openAuth('register')}>{content.primaryCta}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Button></div></section>
      </main>

      <footer className="border-t border-border bg-background py-10">
        <div className="container max-w-7xl px-4 sm:px-6">
          <PortalRecommendations vertical={vertical} />
          <div className="mt-8 flex flex-col items-center justify-between gap-6 border-t pt-8 text-center lg:flex-row lg:text-left">
            <ProductMark vertical={vertical} />
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm text-muted-foreground">
              <Link href="https://pediturno.com/faq" className="hover:text-foreground">Preguntas frecuentes</Link>
              <Link href="https://pediturno.com/terminos" className="hover:text-foreground">Términos</Link>
              <Link href="https://pediturno.com/privacy-policy" className="hover:text-foreground">Privacidad</Link>
              <button type="button" onClick={openAnalyticsPreferences} className="hover:text-foreground">Preferencias de privacidad</button>
              <button type="button" onClick={() => openAuth('login')} className="hover:text-foreground">Iniciar sesión</button>
            </div>
            <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Pediturno</p>
          </div>
        </div>
      </footer>

      {authRequest.open && <AuthModal isOpen={authRequest.open} onOpenChange={(open) => setAuthRequest((current) => ({ ...current, open }))} initialView={authRequest.view} initialVertical={vertical} />}
    </div>
  );
}
