import { getVerticalFromBusinessType, getVerticalOrigin } from '@/lib/verticals';
import { cn } from '@/lib/utils';

export default function BookingPageFooter({ businessType, className }: { businessType?: unknown; className?: string }) {
  const vertical = getVerticalFromBusinessType(businessType);
  const name = vertical === 'sports_facility' ? 'Pediturno Canchas' : vertical === 'spaces' ? 'Pediturno Espacios' : 'Pediturno';
  return (
    <footer className={cn('mx-auto max-w-2xl px-4 pb-6 pt-2 text-center text-xs leading-relaxed text-muted-foreground', className)}>
      <a href={getVerticalOrigin(vertical)} target="_blank" rel="noopener noreferrer" className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Creá tu propia página de {vertical === 'services' ? 'turnos' : 'reservas'} con <span className="font-medium">{name}</span>
      </a>
    </footer>
  );
}
