from datetime import date

from odoo.tests import BaseCase, tagged

from odoo.addons.iso_sgc.tools import calendar_rules as r


@tagged("post_install", "-at_install", "iso_sgc")
class TestCalendarRules(BaseCase):
    def test_audit_quarters(self):
        self.assertEqual(
            r.audit_instances(2027),
            [("T1", date(2027, 3, 15)), ("T2", date(2027, 6, 15)), ("T3", date(2027, 9, 15)), ("T4", date(2027, 12, 15))],
        )

    def test_annual_and_semester(self):
        self.assertEqual(r.frequency_instances("annual", 2027), [("Instancia Anual", date(2027, 11, 30))])
        self.assertEqual(
            r.frequency_instances("semester", 2027),
            [("Semestre 1", date(2027, 6, 30)), ("Semestre 2", date(2027, 12, 15))],
        )

    def test_quarterly(self):
        dates = [d for _l, d in r.frequency_instances("quarterly", 2027)]
        self.assertEqual(dates, [date(2027, 3, 31), date(2027, 6, 30), date(2027, 9, 30), date(2027, 12, 15)])
        self.assertEqual(r.frequency_instances("quarterly", 2027)[0][0], "Trimestre 1")

    def test_monthly_is_the_28th_of_every_month(self):
        inst = r.frequency_instances("monthly", 2027)
        self.assertEqual(len(inst), 12)
        self.assertEqual(inst[0], ("Enero", date(2027, 1, 28)))
        self.assertEqual(inst[1], ("Febrero", date(2027, 2, 28)))  # valid in a leap year too
        self.assertEqual(inst[11], ("Diciembre", date(2027, 12, 28)))
        self.assertTrue(all(d.day == 28 for _l, d in inst))

    def test_unknown_frequency(self):
        with self.assertRaises(ValueError):
            r.frequency_instances("weekly", 2027)

    def test_names(self):
        self.assertEqual(r.audit_task_name("Producción", "T2"), "Auditoría Interna: Producción - T2")
        self.assertEqual(r.routine_task_name("Realizar Evaluación de proveedores", "Semestre 1"),
                         "Realizar Evaluación de proveedores - Semestre 1")

    def test_guess_is_audit(self):
        self.assertTrue(r.guess_is_audit("Auditoría Interna: Compras - T1"))
        self.assertTrue(r.guess_is_audit("x", "AUDITORÍA Interna"))
        self.assertTrue(r.guess_is_audit("Informe del auditor"))
        self.assertFalse(r.guess_is_audit("Realizar Evaluación de proveedores"))

    def test_conclusion_template_mentions_the_process(self):
        self.assertIn("proceso Compras del Sistema", r.conclusion_template("Compras"))
