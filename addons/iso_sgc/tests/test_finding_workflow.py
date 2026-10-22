from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install", "iso_sgc")
class TestFindingWorkflow(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        group = cls.env.ref("iso_sgc.group_iso_user")
        admin_group = cls.env.ref("iso_sgc.group_iso_admin")

        def mkuser(login, groups):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {"name": login, "login": login, "email": f"{login}@example.com", "group_ids": [(6, 0, groups.ids)]},
            )

        cls.owner = mkuser("owner", group)
        cls.analyst = mkuser("analyst", group)
        cls.resp1 = mkuser("resp1", group)
        cls.resp2 = mkuser("resp2", group)
        cls.other = mkuser("other", group)
        cls.admin = mkuser("isoadmin", admin_group)
        cls.tomorrow = fields.Date.context_today(cls.env["iso.finding"]) + timedelta(days=1)

    # -------------------------------------------------------------- helpers
    def _finding(self, **kw):
        vals = {
            "origin": "Auditoría interna",
            "type": "Proceso",
            "process": "Calidad",
            "description": "Falta registro",
            "owner_id": self.owner.id,
            "analysis_user_id": self.analyst.id,
            "analysis_deadline": self.tomorrow,
        }
        vals.update(kw)
        return self.env["iso.finding"].with_user(self.owner).create(vals)

    def _to_pending_action(self, f=None):
        f = f or self._finding()
        f.analysis_summary = "Causa raíz"
        f.with_user(self.analyst).action_save_analysis()
        return f

    def _add(self, f, user, who=None, deadline=None):
        return self.env["iso.finding.action"].with_user(who or self.analyst).create(
            {"finding_id": f.id, "name": "Hacer algo", "user_id": user.id, "date_deadline": deadline or self.tomorrow},
        )

    # -------------------------------------------------------------- creation
    def test_creation_sequence_and_initial_state(self):
        f = self._finding()
        self.assertRegex(f.name, r"^H-\d{4,}$")
        self.assertEqual(f.state, "pending_analysis")
        self.assertEqual(f.pending_user_ids, self.analyst)
        imp = self._finding(category="improvement", type=False, process=False)
        self.assertEqual(imp.state, "pending_action")
        # improvements are numbered independently of corrective findings (legacy behaviour)
        self.assertRegex(imp.name, r"^M-\d{4,}$")
        self.assertEqual(int(self._finding().name[2:]), int(f.name[2:]) + 1)

    def test_validation(self):
        with self.assertRaises(ValidationError):
            self._finding(description="x" * 2001)
        self._finding(description="x" * 2000)
        with self.assertRaises(ValidationError):
            self._finding(type=False)

    def test_workflow_fields_cannot_be_written_directly(self):
        f = self._finding()
        with self.assertRaises(AccessError):
            f.with_user(self.owner).write({"state": "completed"})
        f.with_user(self.admin).write({"state": "pending_action"})  # admin override

    # -------------------------------------------------------------- analysis
    def test_analysis_permissions_and_transition(self):
        f = self._finding()
        f.analysis_summary = "ok"
        with self.assertRaises(AccessError):
            f.with_user(self.other).action_save_analysis()
        f.with_user(self.analyst).action_save_analysis()
        self.assertEqual(f.state, "pending_action")
        with self.assertRaises(UserError):  # not pending analysis any more
            f.with_user(self.analyst).action_save_analysis()

    def test_analysis_requires_summary(self):
        f = self._finding()
        with self.assertRaises(ValidationError):
            f.with_user(self.analyst).action_save_analysis()

    # -------------------------------------------------------------- adding actions
    def test_who_can_add_actions_corrective(self):
        f = self._to_pending_action()
        self._add(f, self.resp1)  # analyst
        self._add(f, self.resp1, who=self.admin)
        for who in (self.owner, self.other):
            with self.assertRaises(AccessError):
                self._add(f, self.resp1, who=who)

    def test_who_can_add_actions_improvement(self):
        f = self._finding(category="improvement", type=False, process=False)
        self._add(f, self.resp1, who=self.owner)
        with self.assertRaises(AccessError):
            self._add(f, self.resp1, who=self.analyst)

    def test_action_deadline_not_in_past(self):
        f = self._to_pending_action()
        with self.assertRaises(ValidationError):
            self._add(f, self.resp1, deadline=fields.Date.context_today(f) - timedelta(days=1))
        self._add(f, self.resp1, deadline=fields.Date.context_today(f))  # today is fine

    def test_cannot_add_action_before_analysis(self):
        f = self._finding()
        with self.assertRaises(UserError):
            self._add(f, self.resp1)

    def test_action_assignment_schedules_activity(self):
        f = self._to_pending_action()
        a = self._add(f, self.resp1)
        self.assertEqual(a.activity_ids.user_id, self.resp1)

    # -------------------------------------------------------------- execution
    def test_only_responsible_executes_and_comment_required(self):
        f = self._to_pending_action()
        a = self._add(f, self.resp1)
        with self.assertRaises(AccessError):
            a.with_user(self.other).action_execute("finished", "hecho")
        with self.assertRaises(ValidationError):
            a.with_user(self.resp1).action_execute("finished", "   ")
        a.with_user(self.resp1).action_execute("finished", "hecho")
        self.assertEqual(a.state, "finished")
        self.assertTrue(a.execution_date)
        with self.assertRaises(UserError):
            a.with_user(self.resp1).action_execute("finished", "otra vez")

    def test_pending_users_follow_the_actions(self):
        f = self._to_pending_action()
        a1, a2 = self._add(f, self.resp1), self._add(f, self.resp2)
        self.assertEqual(f.pending_user_ids, self.resp1 | self.resp2 | self.analyst)
        a1.with_user(self.resp1).action_execute("finished", "ok")
        self.assertEqual(f.state, "pending_action")
        self.assertNotIn(self.resp1, f.pending_user_ids)
        self.assertIn(self.resp2, f.pending_user_ids)
        a2.with_user(self.resp2).action_execute("finished", "ok")
        self.assertEqual(f.state, "pending_verification")
        self.assertEqual(f.pending_user_ids, self.owner)

    def test_rejected_action_rejects_finding_when_all_done(self):
        f = self._to_pending_action()
        a1, a2 = self._add(f, self.resp1), self._add(f, self.resp2)
        a1.with_user(self.resp1).action_execute("finished", "ok")
        a2.with_user(self.resp2).action_execute("rejected", "no aplica")
        self.assertEqual(f.state, "rejected")
        self.assertFalse(f.pending_user_ids)

    def test_all_cancelled_cancels_finding(self):
        """Deviation from legacy (which got stuck in pending_verification)."""
        f = self._to_pending_action()
        a = self._add(f, self.resp1)
        a.with_user(self.resp1).action_execute("cancelled", "ya no hace falta")
        self.assertEqual(f.state, "cancelled")

    # -------------------------------------------------------------- verification
    def _finished(self, n=2):
        f = self._to_pending_action()
        actions = [self._add(f, self.resp1) for _ in range(n)]
        for a in actions:
            a.with_user(self.resp1).action_execute("finished", "ok")
        return f, actions

    def test_only_owner_verifies(self):
        _f, (a1, _a2) = self._finished()
        for who in (self.other, self.analyst, self.resp1):
            with self.assertRaises(AccessError):
                a1.with_user(who).action_verify(True)
        a1.with_user(self.owner).action_verify(True)
        self.assertEqual(a1.verification_state, "ok")

    def test_all_verified_ok_completes(self):
        f, (a1, a2) = self._finished()
        a1.with_user(self.owner).action_verify(True)
        self.assertEqual(f.state, "pending_verification")  # one still open
        a2.with_user(self.owner).action_verify(True)
        self.assertEqual(f.state, "completed")
        self.assertTrue(f.is_verified)
        self.assertTrue(f.verification_date)
        self.assertFalse(f.pending_user_ids)

    def test_any_failed_verification_cancels(self):
        f, (a1, a2) = self._finished()
        a1.with_user(self.owner).action_verify(True)
        a2.with_user(self.owner).action_verify(False, "no fue efectiva")
        self.assertEqual(f.state, "cancelled")
        self.assertFalse(f.is_verified)

    def test_cannot_verify_twice_or_unfinished(self):
        _f, (a1, _a2) = self._finished()
        a1.with_user(self.owner).action_verify(True)
        with self.assertRaises(UserError):
            a1.with_user(self.owner).action_verify(True)
        f2 = self._to_pending_action()
        pending = self._add(f2, self.resp1)
        with self.assertRaises(UserError):
            pending.with_user(self.owner).action_verify(True)

    def test_cancelled_actions_do_not_block_closing(self):
        """Deviation from legacy, where a cancelled action could never be verified."""
        f = self._to_pending_action()
        a1, a2 = self._add(f, self.resp1), self._add(f, self.resp1)
        a1.with_user(self.resp1).action_execute("finished", "ok")
        a2.with_user(self.resp1).action_execute("cancelled", "sobra")
        self.assertEqual(f.state, "pending_verification")
        a1.with_user(self.owner).action_verify(True)
        self.assertEqual(f.state, "completed")
