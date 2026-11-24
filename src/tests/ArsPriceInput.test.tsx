import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import ArsPriceInput from '@/components/ArsPriceInput';
import { parseArsInput, formatArsInput } from '@/lib/ars-input';
import { normalizeCanchaPrice } from '@/lib/cancha-validation';
import { validateServiceWrite } from '@/lib/service-validation';

describe('importes ARS en servicios y canchas', () => {
  it('normaliza puntos de miles y centavos sin alterar el importe guardado', () => {
    expect(parseArsInput('$ 100.000')).toBe('100000');
    expect(parseArsInput('1.000.000,50')).toBe('1000000.50');
    expect(normalizeCanchaPrice('100.000')).toBe('100000');
    expect(normalizeCanchaPrice('100000.50')).toBe('100000.5');
    expect(normalizeCanchaPrice('$ 100.000,50')).toBe('100000.5');
    expect(formatArsInput('100000.50')).toBe('100.000,50');
    expect(parseArsInput('10.00.0')).toBeNull();
    expect(parseArsInput('100,123')).toBeNull();
    expect(validateServiceWrite({ name: 'asesoria de marketing', duration: '60', price: '100.000', status: 'Pausado' }, true).data?.price).toBe('100000');
  });

  it('agrupa mientras se agregan ceros y acepta pegado manual con signo', () => {
    function Field() {
      const [value, setValue] = useState('100');
      return <><label htmlFor="amount">Precio ARS</label><ArsPriceInput id="amount" value={value} onValueChange={setValue} /><output>{value}</output></>;
    }
    render(<Field />);
    const input = screen.getByLabelText('Precio ARS');
    fireEvent.change(input, { target: { value: '1000' } });
    expect(input).toHaveValue('1.000');
    fireEvent.change(input, { target: { value: '1.0000' } });
    expect(input).toHaveValue('10.000');
    fireEvent.change(input, { target: { value: '$ 100.000' } });
    expect(input).toHaveValue('100.000');
    expect(screen.getByRole('status')).toHaveTextContent('100000');
    fireEvent.change(input, { target: { value: '100,123' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('');
    fireEvent.change(input, { target: { value: '100.000,50' } });
    expect(input).toHaveValue('100.000,50');
    expect(screen.getByRole('status')).toHaveTextContent('100000.50');
  });
});
