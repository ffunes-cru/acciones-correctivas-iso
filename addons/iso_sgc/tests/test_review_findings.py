"""Regression tests for problems found in the code review (see docs/REVIEW.md)."""

from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged


@tagged("post_install", "-at_install", "iso_sgc")
class TestReviewFindings(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        ug, ag = cls.env.ref("iso_sgc.group_iso_user"), cls.env.ref("iso_sgc.group_iso_admin")

        def mk(login, group=ug):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {"name": login, "login": login, "email": f"{login}@example.com", "group_ids": [(6, 0, group.ids)]},
            )

        cls.owner, cls.analyst, cls.resp, cls.other = mk("owner"), mk("analyst"), mk("resp"), mk("other")
        cls.admin = mk("isoadmin", ag)
        cls.today = fields.Date.context_today(cls.env["iso.finding"])

    def _finding_with_action(self):
        f = self.env["iso.finding"].with_user(self.owner).create(
            {"origin": "x", "type": "t", "process": "p", "description": "original",
             "analysis_user_id": self.analyst.id, "analysis_summary": "ok"},
        )
        f.with_user(self.analyst).action_save_analysis()
        a = self.env["iso.finding.action"].with_user(self.analyst).create(
            {"finding_id": f.id, "name": "hacer", "user_id": self.resp.id, "date_deadline": self.today + timedelta(days=3)},
        )
        return f, a

    # --- an action's responsible may report their action, nothing else -------------------------
    def test_action_responsible_cannot_edit_the_finding(self):
        f, _a = self._finding_with_action()
        with self.assertRaises(AccessError):
            f.with_user(self.resp).description = "reescrito por el responsable de una acción"
        f.with_user(self.owner).description = "el dueño sí puede"

    def test_action_responsible_cannot_postpone_or_reassign_their_action(self):
        _f, a = self._finding_with_action()
        for vals in ({"date_deadline": self.today + timedelta(days=90)}, {"user_id": self.other.id}, {"name": "otra cosa"}):
            with self.assertRaises(AccessError):
                a.with_user(self.resp).write(vals)
        # the planner (analyst) may re-plan, and so may an admin
        a.with_user(self.analyst).date_deadline = self.today + timedelta(days=10)
        a.with_user(self.admin).user_id = self.other

    def test_responsible_can_still_write_the_implementation_comment(self):
        _f, a = self._finding_with_action()
        a.with_user(self.resp).implementation_comment = "avance"
        self.assertEqual(a.implementation_comment, "avance")

    # --- chatter messages: markup must render, user text must be escaped -----------------------
    def test_final_decision_message_renders_its_line_break(self):
        cr = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "t", "description": "d", "objective": "o", "current_situation": "a",
             "proposed_situation": "b", "impact_analysis": "i"},
        )
        review = cr.review_ids.filtered(lambda v: v.area_id.code == "calidad")
        review.with_user(self.owner).write({"applies": True, "user_id": self.analyst.id})
        cr.with_user(self.owner).review_deadline = self.today
        cr.with_user(self.owner).action_send_to_review()
        review.with_user(self.analyst).action_decide(False, "no")
        cr2 = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "t2", "description": "d", "objective": "o", "current_situation": "a",
             "proposed_situation": "b", "impact_analysis": "<b>i</b>"},
        )
        cr2.review_ids.filtered(lambda v: v.area_id.code == "calidad").with_user(self.owner).write(
            {"applies": True, "user_id": self.analyst.id},
        )
        cr2.with_user(self.owner).review_deadline = self.today
        cr2.with_user(self.owner).action_send_to_review()
        r2 = cr2.review_ids.filtered(lambda v: v.area_id.code == "calidad")
        for line in r2.line_ids:
            line.with_user(self.analyst).write({"applies": "no"})
        r2.with_user(self.analyst).action_approve()
        cr2.with_user(self.owner).write({"final_approver_id": self.admin.id, "final_deadline": self.today})
        cr2.with_user(self.owner).action_send_to_final_approval()
        cr2.with_user(self.admin).action_final_decision(True, "<script>x</script> ok")
        msg = cr2.message_ids.filtered(lambda m: "Final decision" in (m.body or ""))[0]
        self.assertIn("<br", str(msg.body))  # a real line break...
        self.assertNotIn("&lt;br", str(msg.body))  # ...not the escaped text
        self.assertNotIn("<script>", str(msg.body))  # user-typed comments are escaped
        self.assertIn("&lt;script&gt;", str(msg.body))

    def test_planning_digest_is_a_real_list_and_names_are_escaped(self):
        wiz = self.env["iso.calendar.wizard"].with_user(self.admin).create({"year": 2033})
        wiz.audit_line_ids.user_id = self.analyst
        wiz.activity_line_ids.user_id = self.analyst
        wiz.activity_line_ids[0].name = "Revisar <i>algo</i>"
        cal = self.env["iso.calendar"].browse(wiz.action_create()["res_id"])
        digest = cal.message_ids.filtered(lambda m: "were assigned" in (m.body or "") or "asignaron" in (m.body or ""))[0]
        body = str(digest.body)
        self.assertIn("<li>", body)
        self.assertNotIn("&lt;li&gt;", body)
        self.assertNotIn("<i>algo", body)  # task names are escaped, not interpreted as markup

    def test_share_message_escapes_what_the_user_typed(self):
        cal = self.env["iso.calendar"].with_user(self.admin).create({"name": "c", "year": 2034})
        task = self.env["iso.calendar.task"].with_user(self.admin).create(
            {"calendar_id": cal.id, "name": "Auditoría Interna: X - T1", "user_id": self.analyst.id,
             "date_deadline": self.today},
        )
        w = self.env["iso.calendar.share.wizard"].with_user(self.analyst).create(
            {"task_id": task.id, "user_ids": [(6, 0, self.other.ids)], "message": "<img src=x onerror=alert(1)>"},
        )
        w.action_send()
        body = str(task.message_ids[0].body)
        self.assertNotIn("<img", body)

    def test_replanning_an_action_moves_its_todo(self):
        _f, a = self._finding_with_action()
        self.assertEqual(a.activity_ids.user_id, self.resp)
        a.with_user(self.analyst).write({"user_id": self.other.id, "date_deadline": self.today + timedelta(days=20)})
        self.assertEqual(a.activity_ids.user_id, self.other)
        self.assertEqual(a.activity_ids.date_deadline, self.today + timedelta(days=20))
        self.assertEqual(len(a.activity_ids), 1)
