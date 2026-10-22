import { describe, expect, it } from 'vitest';
import { historyId, reminderMilestone } from '../src';

const now = new Date(2026, 9, 22, 10, 30);
const inDays = (n: number) => new Date(2026, 9, 22 + n, 23, 59);
const m = (n: number, hist = false) => reminderMilestone(inDays(n), now, hist)?.milestone ?? null;

describe('reminderMilestone', () => {
  it('fires pre_30 anywhere in the 28..30 day window', () => {
    expect([m(30), m(29), m(28)]).toEqual(['pre_30', 'pre_30', 'pre_30']);
    expect(m(31)).toBeNull();
    expect(m(27)).toBeNull();
  });
  it('fires pre_3 and day_of', () => {
    expect(m(3)).toBe('pre_3');
    expect(m(2)).toBeNull();
    expect(m(0)).toBe('day_of');
  });
  it('ignores time of day when computing days', () => {
    expect(reminderMilestone(new Date(2026, 9, 22, 0, 1), new Date(2026, 9, 22, 23, 59), false)?.milestone).toBe('day_of');
  });
  it('catches up once if overdue 1..6 days and never notified', () => {
    expect(m(-1)).toBe('overdue_initial');
    expect(m(-6)).toBe('overdue_initial');
    expect(m(-1, true)).toBeNull();
    expect(m(-6, true)).toBeNull();
  });
  it('no catch-up beyond 6 days when never notified (waits for the weekly mark)', () => {
    expect(m(-8)).toBeNull();
  });
  it('weekly reminders regardless of history', () => {
    expect(m(-7)).toBe('overdue_week_1');
    expect(m(-14, true)).toBe('overdue_week_2');
    expect(reminderMilestone(inDays(-7), now, false)?.label).toBe('se encuentra VENCIDO hace 1 semana');
    expect(reminderMilestone(inDays(-14), now, false)?.label).toBe('se encuentra VENCIDO hace 2 semanas');
  });
  it('builds the dedupe key', () => {
    expect(historyId('abc', 'pre_3')).toBe('abc_pre_3');
  });
});
