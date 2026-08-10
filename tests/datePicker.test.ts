import { describe, expect, it } from 'vitest';
import { calendarGrid, dateToInputValue, inputValueToDate } from '../src/renderer/components/TouchDatePicker';

describe('touch date picker calendar', () => {
  it('round-trips local dates without UTC timezone drift', () => {
    const date = inputValueToDate('2026-08-10');
    expect(date).not.toBeNull();
    expect(dateToInputValue(date!)).toBe('2026-08-10');
    expect(inputValueToDate('2026-02-31')).toBeNull();
  });

  it('builds a complete Sunday-first grid across month boundaries', () => {
    const days = calendarGrid(2026, 7);
    expect(days).toHaveLength(42);
    expect(dateToInputValue(days[0])).toBe('2026-07-26');
    expect(dateToInputValue(days[6])).toBe('2026-08-01');
    expect(dateToInputValue(days.at(-1)!)).toBe('2026-09-05');
  });

  it('includes leap day in February', () => {
    const values = calendarGrid(2028, 1).map(dateToInputValue);
    expect(values).toContain('2028-02-29');
  });
});
