import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { ESTETICA_GUIDE_PATH } from '@/lib/public-analytics';
import { getPediturnoPortalHost, getVerticalOrigin } from '@/lib/verticals';
import GuideActions from './guide-actions';

const title = 'Agenda online para centros de estética | Pediturno';
const description = 'Armá turnos para cada tratamiento, configurá su duración y compartí una página con tus horarios disponibles. Mirá un ejemplo de agenda y probá una reserva.';
const origin = getVerticalOrigin('services');

export async function generateMetadata(): Promise<Metadata> {
  if (getPediturnoPortalHost((await headers()).get('host')) !== 'pediturno.com') {
    return { robots: { index: false, follow: false } };
  }
  const url = origin + ESTETICA_GUIDE_PATH;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Pediturno', locale: 'es_AR', type: 'website' },
  };
}

const example = [
  { time: '09:30', service: 'Diseño de cejas', duration: '30 min' },
  { time: '10:15', service: 'Limpieza facial', duration: '60 min' },
  { time: '11:30', service: 'Manicura', duration: '45 min' },
];

export default async function EsteticaGuide() {
  if (getPediturnoPortalHost((await headers()).get('host')) !== 'pediturno.com') notFound();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center px-5 py-5 sm:px-8">
          <Link href="/" className="rounded-md text-lg font-black tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            Pediturno <span className="text-sm font-medium text-muted-foreground">Servicios</span>
          </Link>
        </div>
      </header>
      <main>
        <section className="border-b bg-gradient-to-br from-primary/15 via-background to-background">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 sm:px-8 sm:py-20 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
            <div>
              <h1 className="max-w-2xl text-4xl font-black leading-[1.07] tracking-tight min-[400px]:text-5xl sm:text-6xl">
                Turnos online para tu centro de estética
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Publicá tus tratamientos con su duración y compartí un enlace para que tus clientes elijan un horario disponible. Revisá los turnos desde tu agenda de Pediturno.
              </p>
              <GuideActions />
            </div>
            <aside className="rounded-3xl border bg-card p-5 text-card-foreground shadow-xl shadow-foreground/5 sm:p-7" aria-labelledby="agenda-ejemplo">
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/20"><CalendarDays size={22} aria-hidden="true" /></span>
                <div>
                  <h2 id="agenda-ejemplo" className="text-lg font-bold">Un martes en el estudio</h2>
                  <p className="text-sm text-muted-foreground">Agenda de ejemplo</p>
                </div>
              </div>
              <ul className="mt-5 divide-y border-y">
                {example.map(({ time, service, duration }) => (
                  <li key={time} className="grid grid-cols-[auto_1fr] items-center gap-x-4 px-1 py-3">
                    <time dateTime={time} className="font-mono text-sm font-semibold tabular-nums">{time}</time>
                    <span className="min-w-0">
                      <span className="block font-semibold">{service}</span>
                      <span className="block text-sm text-muted-foreground">{duration}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                En este ejemplo el estudio deja 15 minutos libres entre turnos para preparar el lugar.
              </p>
            </aside>
          </div>
        </section>
        <section aria-labelledby="configurar" className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
          <h2 id="configurar" className="text-3xl font-black tracking-tight">Cómo preparar tu agenda</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            <li className="border-t border-border pt-4">
              <h3 className="text-lg font-bold">Cargá tus servicios</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">Creá una opción por tratamiento. Por ejemplo, ofrecé la consulta inicial y la sesión de seguimiento por separado si ocupan tiempos distintos.</p>
            </li>
            <li className="border-t border-border pt-4">
              <h3 className="text-lg font-bold">Definí cuándo atendés</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">Configurá los horarios que querés ofrecer. Dejá afuera el tiempo que reservás para preparación, limpieza o tareas administrativas.</p>
            </li>
            <li className="border-t border-border pt-4">
              <h3 className="text-lg font-bold">Compartí tu enlace</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">Sumalo a tu bio de Instagram o a un mensaje de WhatsApp. Quien lo abre puede elegir servicio y horario en la página pública de tu negocio.</p>
            </li>
          </ol>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-5 px-5 py-7 text-sm sm:px-8">
          <Link href="/" className="underline underline-offset-4">Volver a Servicios</Link>
          <Link href="/faq" className="underline underline-offset-4">Preguntas frecuentes</Link>
          <Link href="/privacy-policy" className="underline underline-offset-4">Privacidad</Link>
        </div>
      </footer>
    </div>
  );
}
