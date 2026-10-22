from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.iso_sgc.tools.approvals import change_request_status_after_review


@tagged("post_install", "-at_install", "iso_sgc")
class TestChangeRequestStatus(TransactionCase):
    def test_rules(self):
        f = change_request_status_after_review
        self.assertEqual(f("pending_review", [(True, "approved"), (True, "rejected"), (True, "pending")]), "rejected")
        self.assertEqual(f("pending_review", [(True, "approved"), (False, "pending"), (True, "approved")]), "pending_approval")
        self.assertEqual(f("pending_review", [(True, "approved"), (True, "pending")]), "pending_review")
        self.assertEqual(f("pending_review", [(True, "approved"), (False, "rejected")]), "pending_approval")
        self.assertEqual(f("pending_review", [(False, "pending")]), "pending_review")


@tagged("post_install", "-at_install", "iso_sgc")
class TestChangeRequest(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        user_g = cls.env.ref("iso_sgc.group_iso_user")
        admin_g = cls.env.ref("iso_sgc.group_iso_admin")

        def mk(login, group=user_g):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {"name": login, "login": login, "email": f"{login}@example.com", "group_ids": [(6, 0, group.ids)]}
            )

        cls.creator, cls.eng, cls.qua, cls.final, cls.other, cls.exec = (
            mk(n) for n in ("creator", "engineer", "quality", "finalapprover", "other", "executor")
        )
        cls.admin = mk("isoadmin", admin_g)
        cls.today = fields.Date.context_today(cls.env["iso.change.request"])
        cls.area = lambda s, code: s.env["iso.change.area"].search([("code", "=", code)])  # noqa: E731

    # ------------------------------------------------------------ helpers
    def _cr(self, **kw):
        vals = {
            "title": "Nueva plantilla de soldado", "description": "d", "objective": "o",
            "current_situation": "a", "proposed_situation": "b", "impact_analysis": "i",
        }
        vals.update(kw)
        return self.env["iso.change.request"].with_user(self.creator).create(vals)

    def _rev(self, cr, code):
        return cr.review_ids.filtered(lambda v: v.area_id.code == code)

    def _ready(self, cr=None, areas=(("ingenieria_procesos", None), ("calidad", None))):
        cr = cr or self._cr()
        users = {"ingenieria_procesos": self.eng, "calidad": self.qua}
        for code, _ in areas:
            r = self._rev(cr, code)
            r.with_user(self.creator).write({"applies": True, "user_id": users[code].id})
        cr.with_user(self.creator).review_deadline = self.today + timedelta(days=7)
        return cr

    def _sent(self, **kw):
        cr = self._ready(**kw)
        cr.with_user(self.creator).action_send_to_review()
        return cr

    def _answer_all(self, review, user, requires="no"):
        for ln in review.line_ids:
            ln.with_user(user).write({"applies": "yes", "requires_action": requires})

    def _approved_reviews(self):
        cr = self._sent()
        for code, u in (("ingenieria_procesos", self.eng), ("calidad", self.qua)):
            rv = self._rev(cr, code)
            self._answer_all(rv, u)
            rv.with_user(u).action_approve()
        return cr

    # ------------------------------------------------------------ creation
    def test_creation_copies_the_questionnaires(self):
        cr = self._cr()
        self.assertRegex(cr.name, r"^SC-\d{4,}$")
        self.assertEqual(cr.state, "draft")
        self.assertEqual(len(cr.review_ids), 8)
        self.assertEqual(sum(len(v.line_ids) for v in cr.review_ids), 74)
        q = self.area("calidad").question_ids[0]
        old_name = q.name
        q.name = "Pregunta cambiada despues"
        self.assertIn(old_name, self._rev(cr, "calidad").line_ids.mapped("name"))

    def test_definition_editable_only_by_creator_in_draft(self):
        cr = self._cr()
        with self.assertRaises(AccessError):
            cr.with_user(self.other).title = "x"
        cr.with_user(self.creator).title = "Nuevo título"
        cr.with_user(self.admin).title = "Admin"
        sent = self._sent()
        with self.assertRaises(AccessError):
            sent.with_user(self.creator).objective = "tarde"

    def test_workflow_fields_are_protected(self):
        cr = self._cr()
        with self.assertRaises(AccessError):
            cr.with_user(self.creator).state = "approved"

    # ------------------------------------------------------------ sending to review
    def test_send_needs_an_area_a_reviewer_and_a_deadline(self):
        cr = self._cr()
        with self.assertRaises(ValidationError):
            cr.with_user(self.creator).action_send_to_review()
        self._rev(cr, "calidad").with_user(self.creator).applies = True
        with self.assertRaises(ValidationError):
            cr.with_user(self.creator).action_send_to_review()  # no reviewer
        self._rev(cr, "calidad").with_user(self.creator).user_id = self.qua
        with self.assertRaises(ValidationError):
            cr.with_user(self.creator).action_send_to_review()  # no deadline
        cr.with_user(self.creator).review_deadline = self.today + timedelta(days=5)
        with self.assertRaises(AccessError):
            cr.with_user(self.other).action_send_to_review()
        cr.with_user(self.creator).action_send_to_review()
        self.assertEqual(cr.state, "pending_review")

    def test_sending_sets_up_the_reviews(self):
        cr = self._sent()
        eng = self._rev(cr, "ingenieria_procesos")
        self.assertEqual((eng.state, eng.date_deadline), ("pending", self.today + timedelta(days=7)))
        other_area = self._rev(cr, "produccion")
        self.assertEqual(other_area.state, "approved")  # not applicable -> auto-approved
        self.assertFalse(other_area.user_id)
        self.assertEqual(cr.activity_ids.user_id, self.eng | self.qua)

    def test_applicability_is_locked_after_sending(self):
        cr = self._sent()
        with self.assertRaises(AccessError):
            self._rev(cr, "produccion").with_user(self.creator).applies = True

    # ------------------------------------------------------------ questionnaire and decisions
    def test_only_the_assigned_reviewer_answers(self):
        cr = self._sent()
        ln = self._rev(cr, "calidad").line_ids[0]
        with self.assertRaises(AccessError):
            ln.with_user(self.eng).applies = "yes"
        with self.assertRaises(AccessError):
            ln.with_user(self.creator).applies = "yes"
        ln.with_user(self.qua).applies = "yes"
        with self.assertRaises(AccessError):
            ln.with_user(self.qua).name = "otra pregunta"

    def test_answering_no_clears_requires_action(self):
        cr = self._sent()
        ln = self._rev(cr, "calidad").line_ids[0]
        ln.with_user(self.qua).write({"applies": "yes", "requires_action": "yes"})
        ln.with_user(self.qua).applies = "no"
        self.assertFalse(ln.requires_action)

    def test_approval_needs_a_complete_questionnaire(self):
        cr = self._sent()
        rv = self._rev(cr, "calidad")
        with self.assertRaises(ValidationError):
            rv.with_user(self.qua).action_approve()  # nothing answered
        for ln in rv.line_ids:
            ln.with_user(self.qua).applies = "yes"
        with self.assertRaises(ValidationError):
            rv.with_user(self.qua).action_approve()  # requires_action unanswered
        for ln in rv.line_ids:
            ln.with_user(self.qua).requires_action = "yes"
        with self.assertRaises(ValidationError):
            rv.with_user(self.qua).action_approve()  # actions not created
        self.assertEqual(rv.action_missing_count, len(rv.line_ids))

    def test_na_and_no_answers_are_enough(self):
        cr = self._sent()
        rv = self._rev(cr, "calidad")
        for i, ln in enumerate(rv.line_ids):
            ln.with_user(self.qua).applies = "no" if i % 2 else "na"
        rv.with_user(self.qua).action_approve()
        self.assertEqual(rv.state, "approved")

    def test_only_the_assigned_reviewer_decides_not_even_admin(self):
        cr = self._sent()
        rv = self._rev(cr, "calidad")
        self._answer_all(rv, self.qua)
        for u in (self.admin, self.creator, self.eng):
            with self.assertRaises(AccessError):
                rv.with_user(u).action_approve()
        rv.with_user(self.qua).action_approve()
        with self.assertRaises(UserError):
            rv.with_user(self.qua).action_approve()  # already decided

    def test_rejection_needs_no_questionnaire_and_rejects_the_request(self):
        cr = self._sent()
        rv = self._rev(cr, "calidad")
        rv.with_user(self.qua).action_decide(False, "No es viable")
        self.assertEqual(rv.comments, "No es viable")
        self.assertEqual(cr.state, "rejected")
        self.assertTrue(cr.message_ids.filtered(lambda m: "REJECTED" in (m.body or "")))

    def test_all_approved_moves_to_final_approval(self):
        cr = self._sent()
        eng = self._rev(cr, "ingenieria_procesos")
        self._answer_all(eng, self.eng)
        eng.with_user(self.eng).action_approve()
        self.assertEqual(cr.state, "pending_review")  # quality still pending
        qua = self._rev(cr, "calidad")
        self._answer_all(qua, self.qua)
        qua.with_user(self.qua).action_approve()
        self.assertEqual(cr.state, "pending_approval")
        self.assertEqual(cr.activity_ids.user_id, self.creator)  # to assign the final approver

    def test_admin_can_reassign_an_absent_reviewer(self):
        cr = self._sent()
        rv = self._rev(cr, "calidad")
        rv.with_user(self.admin).user_id = self.other
        self.assertEqual(cr.activity_ids.filtered(lambda a: a.user_id == self.other).summary.startswith("Review"), True)
        self.assertNotIn(self.qua, cr.activity_ids.user_id)
        with self.assertRaises(AccessError):
            rv.with_user(self.creator).user_id = self.qua

    # ------------------------------------------------------------ linked actions
    def _needs_action(self):
        cr = self._sent()
        rv = self._rev(cr, "calidad")
        ln = rv.line_ids[0]
        ln.with_user(self.qua).write({"applies": "yes", "requires_action": "yes"})
        return cr, rv, ln

    def test_action_creates_a_background_finding(self):
        cr, rv, ln = self._needs_action()
        f = ln.with_user(self.qua).action_link_action("Actualizar procedimiento", self.exec, self.today + timedelta(days=9))
        self.assertEqual(ln.finding_id, f)
        self.assertEqual(f.state, "pending_action")
        self.assertEqual(f.change_request_id, cr)
        self.assertEqual((f.origin, f.type, f.process), ("Gestión de Cambios", "Procedimiento / Documentación", "Otros"))
        self.assertEqual(f.owner_id, self.qua)
        self.assertEqual(f.company_id, cr.company_id)
        self.assertEqual(f.action_ids.user_id, self.exec)
        self.assertIn(cr.name, f.description)
        self.assertIn(ln.name, f.description)
        self.assertEqual(rv.action_missing_count, 0)

    def test_action_rules(self):
        cr, rv, ln = self._needs_action()
        with self.assertRaises(AccessError):
            ln.with_user(self.other).action_link_action("x", self.exec, self.today)
        with self.assertRaises(ValidationError):
            ln.with_user(self.qua).action_link_action("  ", self.exec, self.today)
        other_line = rv.line_ids[1]  # unanswered
        with self.assertRaises(UserError):
            other_line.with_user(self.qua).action_link_action("x", self.exec, self.today)
        ln.with_user(self.qua).action_link_action("ok", self.exec, self.today)
        with self.assertRaises(UserError):
            ln.with_user(self.qua).action_link_action("otra", self.exec, self.today)
        with self.assertRaises(UserError):
            ln.with_user(self.qua).applies = "no"  # remove the action first

    def test_wizard_and_approval_with_actions(self):
        cr, rv, ln = self._needs_action()
        for other in rv.line_ids - ln:
            other.with_user(self.qua).applies = "no"
        w = self.env["iso.change.line.action.wizard"].with_user(self.qua).create(
            {"line_id": ln.id, "description": "Hacer", "user_id": self.exec.id, "date_deadline": self.today}
        )
        w.action_confirm()
        rv.with_user(self.qua).action_approve()
        self.assertEqual(rv.state, "approved")

    def test_removing_an_action_is_for_creator_or_admin(self):
        cr, rv, ln = self._needs_action()
        f = ln.with_user(self.qua).action_link_action("x", self.exec, self.today)
        with self.assertRaises(AccessError):
            ln.with_user(self.other).action_remove_action()
        ln.with_user(self.creator).action_remove_action()
        self.assertFalse(ln.finding_id)
        self.assertFalse(f.exists())

    # ------------------------------------------------------------ final approval and communication
    def test_final_approver_assignment(self):
        cr = self._approved_reviews()
        with self.assertRaises(ValidationError):
            cr.with_user(self.creator).action_send_to_final_approval()
        cr.with_user(self.creator).write({"final_approver_id": self.final.id, "final_deadline": self.today + timedelta(days=3)})
        with self.assertRaises(AccessError):
            cr.with_user(self.other).write({"final_approver_id": self.other.id})
        with self.assertRaises(AccessError):
            cr.with_user(self.other).action_send_to_final_approval()
        cr.with_user(self.creator).action_send_to_final_approval()
        self.assertEqual(cr.final_state, "pending")
        self.assertEqual(cr.activity_ids.user_id, self.final)

    def test_final_decision_only_by_the_final_approver(self):
        cr = self._approved_reviews()
        cr.with_user(self.creator).write({"final_approver_id": self.final.id, "final_deadline": self.today})
        with self.assertRaises(UserError):
            cr.with_user(self.final).action_final_approve()  # not sent yet
        cr.with_user(self.creator).action_send_to_final_approval()
        for u in (self.creator, self.admin, self.qua):
            with self.assertRaises(AccessError):
                cr.with_user(u).action_final_approve()
        cr.with_user(self.final).action_final_decision(True, "Adelante")
        self.assertEqual((cr.state, cr.final_state, cr.final_comments), ("approved", "approved", "Adelante"))
        self.assertTrue(cr.final_date)
        with self.assertRaises(UserError):
            cr.with_user(self.final).action_final_reject()

    def test_final_decision_is_communicated_to_everybody_involved(self):
        cr = self._approved_reviews()
        cr.with_user(self.creator).write({"final_approver_id": self.final.id, "final_deadline": self.today})
        cr.with_user(self.creator).action_send_to_final_approval()
        cr.with_user(self.final).action_final_approve()
        self.assertTrue(cr.communication_sent)
        self.assertTrue(cr.communication_date)
        self.assertIn("4 people", cr.communication_notes)
        msg = cr.message_ids.filtered(lambda m: "Final decision" in (m.body or ""))
        partners = msg.partner_ids
        for u in (self.creator, self.final, self.eng, self.qua):
            self.assertIn(u.partner_id, partners)
        self.assertNotIn(self.other.partner_id, partners)

    def test_final_rejection(self):
        cr = self._approved_reviews()
        cr.with_user(self.creator).write({"final_approver_id": self.final.id, "final_deadline": self.today})
        cr.with_user(self.creator).action_send_to_final_approval()
        cr.with_user(self.final).action_final_reject()
        self.assertEqual((cr.state, cr.final_state), ("rejected", "rejected"))
        self.assertTrue(cr.communication_sent)

    # ------------------------------------------------------------ deletion
    def test_delete_is_admin_only_and_removes_linked_actions(self):
        cr, rv, ln = self._needs_action()
        f = ln.with_user(self.qua).action_link_action("x", self.exec, self.today)
        with self.assertRaises(AccessError):
            cr.with_user(self.creator).unlink()
        cr.with_user(self.admin).unlink()
        self.assertFalse(f.exists())
