import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from '@/components/ui/calendar';

describe('calendar after DayPicker upgrade', () => {
  it('renders a selectable day and delivers its date to the appointment form', () => {
    const onSelect = vi.fn();
    render(<Calendar mode="single" month={new Date(2026, 8, 1)} onSelect={onSelect} />);

    const day = screen.getAllByRole('button').find(button => button.getAttribute('aria-label')?.includes('24'));
    expect(day).toBeDefined();
    fireEvent.click(day!);
    expect(onSelect).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), expect.any(Object), expect.any(Object));
    expect(onSelect.mock.calls[0][0].getDate()).toBe(24);
  });

  it('renders the month and year dropdown controls used by the calendar', () => {
    render(<Calendar mode="single" month={new Date(2026, 8, 1)} captionLayout="dropdown" startMonth={new Date(2025, 0, 1)} endMonth={new Date(2027, 11, 31)} />);
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });
});
