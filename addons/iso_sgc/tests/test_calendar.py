from datetime import date, timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import Form, TransactionCase, tagged


@tagged("post_install", "-at_install", "iso_sgc")
class TestCalendar(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        user_g = cls.env.ref("iso_sgc.group_iso_user")
        admin_g = cls.env.ref("iso_sgc.group_iso_admin")

        def mk(login, group=user_g):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {"name": login, "login": login, "email": f"{login}@example.com", "group_ids": [(6, 0, group.ids)]}
            )

        cls.admin, cls.admin2 = mk("isoadmin", admin_g), mk("isoadmin2", admin_g)
        cls.auditor, cls.resp, cls.other, cls.shared = (mk(n) for n in ("auditor", "resp", "other", "shared"))
        cls.company = cls.env.company
        cls.company.iso_audit_scope = "Alcance de prueba"
        cls.today = fields.Date.context_today(cls.env["iso.calendar"])
        cls.calendar = cls.env["iso.calendar"].with_user(cls.admin).create(
            {"name": "Planificación test", "year": cls.today.year + 1}
        )

    def _task(self, **kw):
        vals = {
            "calendar_id": self.calendar.id, "name": "Realizar Encuesta de Satisfacción - Instancia Anual",
            "activity": "Realizar Encuesta de Satisfacción", "frequency": "annual", "label": "Instancia Anual",
            "user_id": self.resp.id, "date_deadline": self.today + timedelta(days=10),
        }
        vals.update(kw)
        return self.env["iso.calendar.task"].with_user(self.admin).create(vals)

    def _audit(self, **kw):
        return self._task(name="Auditoría Interna: Compras - T1", activity="Auditoría Interna", frequency="quarterly",
                          label="T1", user_id=self.auditor.id, **kw)

    # ------------------------------------------------------------ wizard
    def test_wizard_defaults(self):
        wiz = self.env["iso.calendar.wizard"].with_user(self.admin).create({})
        self.assertEqual(len(wiz.audit_line_ids), 48)  # 12 processes x 4 quarters
        self.assertEqual(len(wiz.activity_line_ids), 10)
        q1 = wiz.audit_line_ids.filtered(lambda ln: ln.quarter == "T1")[0]
        self.assertEqual((q1.date.month, q1.date.day), (3, 15))
        self.assertEqual(wiz.year, self.today.year + 1)

    def test_wizard_year_change_moves_dates(self):
        with Form(self.env["iso.calendar.wizard"].with_user(self.admin)) as f:
            f.year = 2031
        wiz = f.record
        self.assertTrue(all(ln.date.year == 2031 for ln in wiz.audit_line_ids))
        self.assertIn("2031", wiz.name)

    def test_wizard_requires_responsibles(self):
        wiz = self.env["iso.calendar.wizard"].with_user(self.admin).create({})
        with self.assertRaises(ValidationError):
            wiz.action_create()
        wiz.audit_line_ids.user_id = self.auditor
        with self.assertRaises(ValidationError):
            wiz.action_create()

    def test_wizard_generates_the_planning(self):
        wiz = self.env["iso.calendar.wizard"].with_user(self.admin).create({"year": 2031})
        wiz.audit_line_ids.user_id = self.auditor
        wiz.activity_line_ids.user_id = self.resp
        # frequency drives the number of instances; make two activities non-annual
        wiz.activity_line_ids[0].frequency = "monthly"
        wiz.activity_line_ids[1].frequency = "semester"
        # an audit quarter can be dropped
        wiz.audit_line_ids[0].unlink()
        act = wiz.action_create()
        cal = self.env["iso.calendar"].browse(act["res_id"])
        self.assertEqual(cal.year, 2031)
        self.assertEqual(len(cal.task_ids.filtered("is_audit")), 47)
        self.assertEqual(len(cal.task_ids.filtered(lambda t: not t.is_audit)), 12 + 2 + 8)
        audit = cal.task_ids.filtered("is_audit")[0]
        self.assertTrue(audit.name.startswith("Auditoría Interna: "))
        self.assertEqual(audit.activity, "Auditoría Interna")
        self.assertTrue(audit.audit_process_id)
        self.assertEqual(audit.scope, "Alcance de prueba")
        self.assertIn("ISO 9001:2015", audit.criteria)
        self.assertEqual(audit.activity_ids.user_id, self.auditor)
        monthly = cal.task_ids.filtered(lambda t: t.frequency == "monthly")
        self.assertEqual(sorted(monthly.mapped("date_deadline"))[0], date(2031, 1, 28))

    def test_only_admins_create_plannings(self):
        with self.assertRaises(AccessError):
            self.env["iso.calendar.wizard"].with_user(self.other).create({})

    # ------------------------------------------------------------ task creation
    def test_adhoc_defaults(self):
        t = self.env["iso.calendar.task"].with_user(self.admin).create(
            {"calendar_id": self.calendar.id, "name": "Auditoría especial", "user_id": self.resp.id,
             "date_deadline": self.today}
        )
        self.assertTrue(t.is_audit)
        self.assertEqual(t.label, "Ad-hoc")
        self.assertEqual(t.activity, "Auditoría Interna")
        plain = self._task(label=False, activity=False, name="Revisar algo")
        self.assertFalse(plain.is_audit)
        self.assertEqual(plain.activity, "Revisar algo")

    def test_task_creation_schedules_activity(self):
        self.assertEqual(self._task().activity_ids.user_id, self.resp)

    def test_only_admin_creates_tasks_and_calendars(self):
        with self.assertRaises(AccessError):
            self.env["iso.calendar.task"].with_user(self.resp).create(
                {"calendar_id": self.calendar.id, "name": "x", "user_id": self.resp.id, "date_deadline": self.today}
            )
        with self.assertRaises(AccessError):
            self.env["iso.calendar"].with_user(self.resp).create({"name": "x", "year": 2030})
        with self.assertRaises(AccessError):
            self.calendar.with_user(self.resp).write({"name": "hack"})

    # ------------------------------------------------------------ visibility
    def test_audit_tasks_are_hidden_from_uninvolved_users(self):
        audit, plain = self._audit(), self._task()
        ids = (audit | plain).ids
        search = lambda u: self.env["iso.calendar.task"].with_user(u).search([("id", "in", ids)])  # noqa: E731
        self.assertEqual(search(self.auditor), audit | plain)
        self.assertEqual(search(self.admin), audit | plain)
        self.assertEqual(search(self.other), plain)
        audit._transition({"shared_user_ids": [(4, self.shared.id)]})
        self.assertEqual(search(self.shared), audit | plain)

    # ------------------------------------------------------------ permissions
    def test_only_responsible_edits_and_only_admin_replans(self):
        t = self._task()
        with self.assertRaises(AccessError):
            t.with_user(self.other).comments = "x"
        t.with_user(self.resp).comments = "avance"
        with self.assertRaises(AccessError):
            t.with_user(self.resp).date_deadline = self.today
        with self.assertRaises(AccessError):
            t.with_user(self.resp).user_id = self.other
        t.with_user(self.admin).date_deadline = self.today + timedelta(days=20)

    def test_status_only_through_buttons(self):
        t = self._task()
        for u in (self.resp, self.admin):
            with self.assertRaises(AccessError):
                t.with_user(u).state = "done"

    # ------------------------------------------------------------ finishing
    def test_finish_requires_comment(self):
        t = self._task()
        with self.assertRaises(ValidationError):
            t.with_user(self.resp).action_finish()
        t.with_user(self.resp).comments = "hecho"
        t.with_user(self.resp).action_finish()
        self.assertEqual(t.state, "done")
        self.assertEqual(t.date_completed, self.today)
        self.assertFalse(t.activity_ids)

    def test_finish_keeps_a_given_execution_date(self):
        t = self._task()
        t.with_user(self.resp).write({"comments": "hecho", "date_completed": self.today - timedelta(days=2)})
        t.with_user(self.resp).action_finish()
        self.assertEqual(t.date_completed, self.today - timedelta(days=2))

    def test_audit_needs_audited_personnel_and_adapted_template(self):
        t = self._audit()
        t.with_user(self.auditor).comments = "Conclusión"
        with self.assertRaises(ValidationError):
            t.with_user(self.auditor).action_finish()
        t.with_user(self.auditor).audited_personnel = "Juan"
        t.with_user(self.auditor).comments = False
        t.with_user(self.auditor).action_insert_conclusion_template()
        self.assertIn("[número]", t.comments)
        with self.assertRaises(ValidationError):  # template not adapted
            t.with_user(self.auditor).action_finish()
        t.with_user(self.auditor).comments = t.comments.replace("[número]", "2").replace("[tema]", "x").replace(
            "[áreas específicas]", "y")
        t.with_user(self.auditor).action_finish()
        self.assertEqual(t.state, "done")

    def test_template_does_not_overwrite_a_conclusion(self):
        t = self._audit()
        t.with_user(self.auditor).comments = "Mi conclusión"
        t.with_user(self.auditor).action_insert_conclusion_template()
        self.assertEqual(t.comments, "Mi conclusión")

    def test_admins_are_told_when_the_responsible_finishes(self):
        t = self._task()
        t.with_user(self.resp).comments = "hecho"
        t.with_user(self.resp).action_finish()
        msg = t.message_ids.filtered(lambda m: "completed the task" in (m.body or ""))
        self.assertTrue(msg)
        notified = msg.partner_ids
        self.assertIn(self.admin.partner_id, notified)
        self.assertIn(self.admin2.partner_id, notified)
        self.assertNotIn(self.resp.partner_id, notified)

    def test_finished_audit_is_locked_for_non_admins(self):
        t = self._audit()
        t.with_user(self.auditor).write({"comments": "ok", "audited_personnel": "Juan"})
        t.with_user(self.auditor).action_finish()
        with self.assertRaises(AccessError):
            t.with_user(self.auditor).comments = "cambio"
        with self.assertRaises(AccessError):
            t.with_user(self.auditor).action_reopen()
        t.with_user(self.admin).comments = "corregido por admin"
        t.with_user(self.admin).action_reopen()
        self.assertEqual(t.state, "in_progress")
        self.assertFalse(t.date_completed)

    def test_finished_plain_task_can_be_reopened_by_its_responsible(self):
        t = self._task()
        t.with_user(self.resp).comments = "hecho"
        t.with_user(self.resp).action_finish()
        t.with_user(self.resp).comments = "ajuste"  # not locked: only audits lock
        t.with_user(self.resp).action_reopen()
        self.assertEqual(t.state, "in_progress")
        self.assertTrue(t.activity_ids)

    def test_start(self):
        t = self._task()
        with self.assertRaises(AccessError):
            t.with_user(self.other).action_start()
        t.with_user(self.resp).action_start()
        self.assertEqual(t.state, "in_progress")
        with self.assertRaises(UserError):
            t.with_user(self.resp).action_start()

    # ------------------------------------------------------------ admin replanning
    def test_admin_reassigns_open_task_and_activity_follows(self):
        t = self._task()
        t.with_user(self.admin).write({"user_id": self.other.id, "date_deadline": self.today + timedelta(days=30)})
        self.assertEqual(t.activity_ids.user_id, self.other)
        self.assertEqual(t.activity_ids.date_deadline, self.today + timedelta(days=30))
        self.assertTrue(t.message_ids.filtered(lambda m: "reassigned" in (m.body or "")))

    def test_finished_task_cannot_be_reassigned(self):
        t = self._task()
        t.with_user(self.resp).comments = "hecho"
        t.with_user(self.resp).action_finish()
        with self.assertRaises(UserError):
            t.with_user(self.admin).user_id = self.other

    # ------------------------------------------------------------ audit lines -> findings
    def _line(self, task, kind, **kw):
        vals = {"task_id": task.id, "kind": kind, "text": "Detalle", "user_id": self.resp.id,
                "date_deadline": self.today + timedelta(days=15), "process": "Compras"}
        vals.update(kw)
        return self.env["iso.audit.line"].with_user(self.auditor).create(vals)

    def test_only_responsible_edits_lines(self):
        t = self._audit()
        with self.assertRaises(AccessError):
            self._line_by(t, self.other)
        self._line(t, "minor")

    def _line_by(self, task, user):
        return self.env["iso.audit.line"].with_user(user).create({"task_id": task.id, "kind": "minor", "text": "x"})

    def test_opportunity_raises_an_improvement_finding(self):
        t = self._audit()
        ln = self._line(t, "opportunity", process=False)
        ln.with_user(self.auditor).action_confirm()
        f = ln.finding_id
        self.assertEqual(f.category, "improvement")
        self.assertEqual(f.state, "pending_action")
        self.assertRegex(f.name, r"^M-\d+")
        self.assertEqual((f.origin, f.type, f.process), ("Auditoría Interna", "Mejora", "Mejora"))
        self.assertEqual(f.owner_id, self.auditor)
        self.assertEqual(f.company_id, t.company_id)
        self.assertEqual(f.action_ids.user_id, self.resp)
        self.assertEqual(f.action_ids.name, "Detalle")
        self.assertIn(t.name, f.description)

    def test_minor_and_major_raise_corrective_findings_pending_analysis(self):
        t = self._audit()
        for kind, label in (("minor", "No conformidad menor"), ("major", "No conformidad mayor")):
            ln = self._line(t, kind)
            ln.with_user(self.auditor).action_confirm()
            f = ln.finding_id
            self.assertEqual(f.category, "corrective")
            self.assertEqual(f.state, "pending_analysis")
            self.assertEqual(f.type, label)
            self.assertEqual(f.process, "Compras")
            self.assertEqual(f.analysis_user_id, self.resp)
            self.assertEqual(f.analysis_deadline, ln.date_deadline)
            self.assertEqual(f.owner_id, self.auditor)
            self.assertRegex(f.name, r"^H-\d+")

    def test_confirm_validations(self):
        t = self._audit()
        with self.assertRaises(ValidationError):
            self._line(t, "minor", process=False).with_user(self.auditor).action_confirm()
        with self.assertRaises(ValidationError):
            self._line(t, "minor", user_id=False).with_user(self.auditor).action_confirm()
        with self.assertRaises(ValidationError):
            self._line(t, "minor", date_deadline=False).with_user(self.auditor).action_confirm()
        with self.assertRaises(AccessError):
            self._line(t, "minor").with_user(self.other).action_confirm()

    def test_confirmed_line_is_frozen(self):
        t = self._audit()
        ln = self._line(t, "opportunity")
        ln.with_user(self.auditor).action_confirm()
        with self.assertRaises(UserError):
            ln.with_user(self.auditor).action_confirm()
        with self.assertRaises(UserError):
            ln.with_user(self.auditor).text = "cambio"
        with self.assertRaises(UserError):
            ln.with_user(self.auditor).unlink()

    def test_cannot_raise_findings_from_a_locked_audit(self):
        t = self._audit()
        ln = self._line(t, "minor")
        t.with_user(self.auditor).write({"comments": "ok", "audited_personnel": "Juan"})
        t.with_user(self.auditor).action_finish()
        with self.assertRaises(AccessError):
            ln.with_user(self.auditor).action_confirm()

    # ------------------------------------------------------------ sharing
    def _share(self, task, user, **kw):
        w = self.env["iso.calendar.share.wizard"].with_user(user).create({"task_id": task.id, **kw})
        return w.action_send()

    def test_sharing_grants_access_and_notifies(self):
        t = self._audit()
        self.assertFalse(self.env["iso.calendar.task"].with_user(self.shared).search([("id", "=", t.id)]))
        self._share(t, self.auditor, user_ids=[(6, 0, self.shared.ids)], message="Informe listo")
        self.assertEqual(t.shared_user_ids, self.shared)
        self.assertTrue(self.env["iso.calendar.task"].with_user(self.shared).search([("id", "=", t.id)]))
        self.assertIn(self.shared.partner_id, t.message_ids[0].partner_ids)

    def test_only_responsible_shares_and_emails_are_validated(self):
        t = self._audit()
        with self.assertRaises(AccessError):
            self._share(t, self.other, user_ids=[(6, 0, self.shared.ids)])
        with self.assertRaises(ValidationError):
            self._share(t, self.auditor, extra_emails="no-es-un-mail")
        with self.assertRaises(ValidationError):
            self._share(t, self.auditor)
        self._share(t, self.auditor, extra_emails="externo@example.com, otro@example.com")
        mails = self.env["mail.mail"].sudo().search([("email_to", "ilike", "externo@example.com")])
        self.assertTrue(mails)
        self.assertFalse(t.shared_user_ids)  # outside emails get the message, never access

    # ------------------------------------------------------------ calendar
    def test_stats_and_cascade_delete(self):
        cal = self.env["iso.calendar"].with_user(self.admin).create({"name": "Stats", "year": 2040})
        a = self._task(calendar_id=cal.id, date_deadline=self.today - timedelta(days=3))
        b = self._task(calendar_id=cal.id)
        self._task(calendar_id=cal.id)
        b.with_user(self.resp).comments = "ok"
        b.with_user(self.resp).action_finish()
        self.assertEqual((cal.task_count, cal.done_count, cal.overdue_count), (3, 1, 1))
        self.assertTrue(a.is_overdue)
        tasks = cal.task_ids
        with self.assertRaises(AccessError):
            cal.with_user(self.resp).unlink()
        cal.with_user(self.admin).unlink()
        self.assertFalse(tasks.exists())
