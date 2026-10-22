// Deadline reminder schedule. Extracted from server.ts / clientCronService.ts.
// Dedupe key is `${itemId}_${milestone}` (stored in notification_history), so the
// 28..30 day window below fires once even though the cron runs every 15 minutes.

export interface Milestone {
  milestone: string;
  label: string;
}

const MS_DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function reminderMilestone(
  deadline: Date,
  now: Date,
  /** true if ANY reminder was ever sent for this item (controls the overdue catch-up). */
  hasAnyHistory: boolean,
): Milestone | null {
  const diff = Math.round((startOfDay(deadline).getTime() - startOfDay(now).getTime()) / MS_DAY);

  if (diff <= 30 && diff >= 28) return { milestone: 'pre_30', label: 'vence en 1 mes (30 días)' };
  if (diff === 3) return { milestone: 'pre_3', label: 'vence en 3 días' };
  if (diff === 0) return { milestone: 'day_of', label: 'vence HOY' };
  if (diff > 0) return null;

  const overdue = -diff;
  // Weekly reminders win over the catch-up (they cannot coincide: catch-up is 1..6 days).
  if (overdue % 7 === 0) {
    const weeks = overdue / 7;
    return { milestone: `overdue_week_${weeks}`, label: `se encuentra VENCIDO hace ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}` };
  }
  if (overdue <= 6 && !hasAnyHistory) {
    return { milestone: 'overdue_initial', label: `se encuentra VENCIDO hace ${overdue} ${overdue === 1 ? 'día' : 'días'}` };
  }
  return null;
}

export const historyId = (itemId: string, milestone: string) => `${itemId}_${milestone}`;
