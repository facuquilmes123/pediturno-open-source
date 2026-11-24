'use client';

import { useState, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { formatArsInput, parseArsInput } from '@/lib/ars-input';

type Props = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (value: string) => void;
};

export default function ArsPriceInput({ value, onValueChange, id, ...props }: Props) {
  const [invalid, setInvalid] = useState(false);
  const [invalidText, setInvalidText] = useState('');
  return (
    <div>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
        <Input {...props} id={id} type="text" inputMode="decimal" className="pl-7" value={invalid ? invalidText : formatArsInput(value)}
          aria-invalid={invalid || props['aria-invalid']} aria-describedby={`${id}-currency-help`}
          onChange={event => {
            const incoming = event.target.value;
            const displayed = formatArsInput(value);
            // A single edit of a grouped amount temporarily breaks group sizes
            // (1.000 + 0 -> 1.0000). Re-group its digits immediately.
            const editedGrouping = !incoming.includes(',') && /^[\d.]+$/.test(incoming)
              && Math.abs(incoming.length - displayed.length) <= 1;
            const parsed = parseArsInput(editedGrouping ? incoming.replace(/\./g, '') : incoming);
            setInvalid(parsed === null);
            if (parsed === null) setInvalidText(incoming);
            // Never submit the previous valid amount after an invalid edit.
            onValueChange(parsed ?? '');
          }} />
      </div>
      <p id={`${id}-currency-help`} aria-live="polite" className={`mt-1 text-xs ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
        {invalid ? 'Usá números, puntos para miles y coma para hasta dos centavos. Ejemplo: $ 100.000,50.' : 'Pesos argentinos (ARS). Los miles se separan solos; usá coma para centavos.'}
      </p>
    </div>
  );
}
