import Link from 'next/link';
import { Suspense } from 'react';
import BookingClientPage from '@/app/[slug]/BookingClientPage';
import { demoBusiness } from '@/lib/demo-business';
import type { ProductVertical } from '@/lib/verticals';

export default function BookingDemo({ vertical }: { vertical: ProductVertical }) {
  const view = demoBusiness(vertical);
  return <>
    <header className="border-b bg-primary/10 px-4 py-5"><div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4"><div className="max-w-xl"><p className="text-xs font-bold uppercase tracking-widest text-foreground/90">Tu página puede verse así</p><p className="mt-1 text-lg font-bold">Demostración de Pediturno</p><p className="mt-2 text-sm">Negocio, precios, dirección y contactos ficticios. Probá los botones y simulá una reserva: no se guarda, no se cobra ni se envían mensajes.</p></div><Link href="/" className="rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">Conocer el sistema</Link></div></header>
    <Suspense fallback={<p className="p-8">Cargando demostración…</p>}><BookingClientPage demoMode businessData={view.business} services={view.services} canchas={view.canchas} spaces={view.spaces} businessId={view.business.id} /></Suspense>
  </>;
}
