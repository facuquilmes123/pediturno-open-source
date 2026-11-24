import { ArrowUpRight, CalendarCheck2, CalendarDays, Trophy } from 'lucide-react';
import { getVerticalOrigin, type ProductVertical } from '@/lib/verticals';

const products = [
  { vertical: 'services', name: 'Pediturno', description: 'Turnos online para profesionales, estética y servicios.', Icon: CalendarDays, color: 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200' },
  { vertical: 'sports_facility', name: 'Pediturno Canchas', description: 'Reservas y disponibilidad para canchas y complejos deportivos.', Icon: Trophy, color: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' },
  { vertical: 'spaces', name: 'Pediturno Espacios', description: 'Reservas para salones, quinchos, quintas y estudios.', Icon: CalendarCheck2, color: 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' },
] as const;

export default function PortalRecommendations({ vertical }: { vertical: ProductVertical }) {
  return (
    <nav aria-label="Otros sistemas de Pediturno" className="w-full">
      <p className="text-lg font-bold">Una solución para cada tipo de negocio</p>
      <p className="mt-1 text-sm text-muted-foreground">Conocé también los otros sistemas de la familia Pediturno.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {products.filter(product => product.vertical !== vertical).map(({ vertical: other, name, description, Icon, color }) => (
          <a key={other} href={getVerticalOrigin(other)} className="group flex items-start gap-4 rounded-2xl border bg-card p-5 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={`rounded-xl p-3 ${color}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1"><span className="font-bold">Conocé {name}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span></span>
            <ArrowUpRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </a>
        ))}
      </div>
    </nav>
  );
}
