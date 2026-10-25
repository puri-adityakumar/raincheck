import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../components/Composer';
import { addDays, todayIn, validDate, validTimezone } from '../lib/dates';

describe('timezone-aware calendar defaults', () => {
  it('uses the selected timezone day on opposite sides of UTC midnight', () => {
    const now = new Date('2026-10-25T00:30:00Z');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-10-24');
    expect(todayIn('Asia/Tokyo', now)).toBe('2026-10-25');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(validDate('2026-02-30')).toBe(false);
    expect(validDate('2028-02-29')).toBe(true);
    expect(validTimezone('Not/AZone')).toBe(false);
    expect(validTimezone('+03:00')).toBe(false);
  });
  it('defaults in a newly selected timezone, but never overwrites an explicitly chosen date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T00:30:00Z'));
    render(<Composer aiAvailable={false} />);
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/Los_Angeles' } });
    expect(screen.getByLabelText('Replacement date')).toHaveValue('2026-10-25');
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Tokyo' } });
    expect(screen.getByLabelText('Replacement date')).toHaveValue('2026-10-26');
    fireEvent.change(screen.getByLabelText('Replacement date'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/Los_Angeles' } });
    expect(screen.getByLabelText('Replacement date')).toHaveValue('2026-11-01');
  });
});
