from datetime import date, timedelta

from odoo.tests import BaseCase, tagged

from odoo.addons.iso_sgc.tools.reminders import reminder_milestone

TODAY = date(2026, 10, 22)


def m(days, hist=False):
    r = reminder_milestone(TODAY + timedelta(days=days), TODAY, hist)
    return r[0] if r else None


@tagged("post_install", "-at_install", "iso_sgc")
class TestReminders(BaseCase):
    def test_pre_30_window(self):
        self.assertEqual([m(30), m(29), m(28)], ["pre_30"] * 3)
        self.assertIsNone(m(31))
        self.assertIsNone(m(27))

    def test_pre_3_and_day_of(self):
        self.assertEqual(m(3), "pre_3")
        self.assertIsNone(m(2))
        self.assertEqual(m(0), "day_of")

    def test_overdue_catch_up_only_if_never_notified(self):
        self.assertEqual(m(-1), "overdue_initial")
        self.assertEqual(m(-6), "overdue_initial")
        self.assertIsNone(m(-1, True))
        self.assertIsNone(m(-8))

    def test_weekly(self):
        self.assertEqual(m(-7), "overdue_week_1")
        self.assertEqual(m(-14, True), "overdue_week_2")
        self.assertEqual(reminder_milestone(TODAY - timedelta(days=7), TODAY, False)[1], "se encuentra VENCIDO hace 1 semana")
        self.assertEqual(reminder_milestone(TODAY - timedelta(days=14), TODAY, False)[1], "se encuentra VENCIDO hace 2 semanas")
