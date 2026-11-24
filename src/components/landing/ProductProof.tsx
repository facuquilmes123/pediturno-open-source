import Image from 'next/image';
import Link from 'next/link';
import type { ProductVertical } from '@/lib/verticals';

export function demoPath(vertical: ProductVertical) { return vertical === 'sports_facility' ? '/demo-canchas' : vertical === 'spaces' ? '/demo-espacios' : '/demo-servicios'; }
export default function ProductProof({ vertical, hero = false, onDemoOpen }: { vertical: ProductVertical; hero?: boolean; onDemoOpen?: () => void }) {
  const resource = vertical === 'sports_facility' ? 'canchas' : vertical === 'spaces' ? 'espacios' : 'servicios';
  return <figure className="mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border bg-card shadow-xl">
    <Link href={demoPath(vertical)} target="_blank" rel="noopener noreferrer" onClick={onDemoOpen} aria-label="Probar reserva de ejemplo"><Image src={`/images/producto/demo-${resource}-20261010.webp`} alt={`Pantalla real de reserva de ${resource} en Pediturno con datos de demostración`} width={1200} height={1000} priority={hero} className="h-auto w-full" sizes="(max-width: 1024px) 94vw, 58vw" /></Link>
    <figcaption className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"><span>Así reservan tus clientes · pantalla del producto</span><Link href={demoPath(vertical)} target="_blank" rel="noopener noreferrer" onClick={onDemoOpen} className="font-semibold text-foreground underline">Probar reserva de ejemplo →</Link></figcaption>
  </figure>;
}
