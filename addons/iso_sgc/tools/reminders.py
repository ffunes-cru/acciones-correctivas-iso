"""Deadline reminder schedule (ported from the legacy server.ts / clientCronService.ts).

Dedupe key is `<model>,<id>,<milestone>`: the 28..30 day window fires once even though
the cron runs daily.
"""

from datetime import date


def reminder_milestone(deadline: date, today: date, has_any_history: bool):
    """Return (milestone, label) or None. `has_any_history` = a reminder was ever sent."""
    diff = (deadline - today).days
    if 28 <= diff <= 30:
        return "pre_30", "vence en 1 mes (30 días)"
    if diff == 3:
        return "pre_3", "vence en 3 días"
    if diff == 0:
        return "day_of", "vence HOY"
    if diff > 0:
        return None
    overdue = -diff
    if overdue % 7 == 0:
        weeks = overdue // 7
        return f"overdue_week_{weeks}", f"se encuentra VENCIDO hace {weeks} {'semana' if weeks == 1 else 'semanas'}"
    if overdue <= 6 and not has_any_history:
        return "overdue_initial", f"se encuentra VENCIDO hace {overdue} {'día' if overdue == 1 else 'días'}"
    return None
