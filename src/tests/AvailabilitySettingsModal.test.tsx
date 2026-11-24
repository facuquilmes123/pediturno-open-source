/// <reference types="vitest/globals" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AvailabilitySettingsModal from '@/components/AvailabilitySettingsModal';

const mocks = vi.hoisted(() => ({
  onSave: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/services/data', () => ({
  validateWorkingHours: () => null,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/HolidaysModal', () => ({
  default: () => null,
}));

vi.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {
    toDate() {
      return new Date();
    }
  },
}));

const service = {
  id: 'service-1',
  businessId: 'owner-1',
  name: 'Consulta',
  duration: '45',
  price: '12500',
  status: 'Pausado' as const,
};

describe('AvailabilitySettingsModal', () => {
  beforeEach(() => {
    mocks.onSave.mockResolvedValue(undefined);
  });

  it('separa el checkbox del trigger y permite activar, expandir y editar un día', async () => {
    render(
      <AvailabilitySettingsModal
        isOpen
        onOpenChange={vi.fn()}
        service={service}
        onSave={mocks.onSave}
      />,
    );

    const mondayCheckbox = screen.getByRole('checkbox', { name: 'Lunes' });
    const mondayTrigger = screen.getByRole('button', { name: /configurar horarios de lunes/i });

    expect(document.body.querySelector('button button')).toBeNull();
    expect(mondayTrigger).not.toContainElement(mondayCheckbox);
    expect(mondayTrigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(mondayCheckbox);

    const expandedTrigger = screen.getByRole('button', { name: /1 turno de lunes/i });
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Desde')).toHaveValue('09:00');

    fireEvent.click(expandedTrigger);
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expandedTrigger);
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar disponibilidad/i }));

    await waitFor(() => {
      expect(mocks.onSave).toHaveBeenCalledWith('service-1', {
        workingHours: {
          1: {
            slots: [{ start: '10:00', end: '18:00' }],
            isAlternating: false,
          },
        },
        unavailableDates: [],
      });
    });
  });
});
