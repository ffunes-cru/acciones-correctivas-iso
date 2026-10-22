from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tests import TransactionCase, tagged

from odoo.addons.iso_sgc.tools.approvals import special_release_status


@tagged("post_install", "-at_install", "iso_sgc")
class TestSpecialReleaseStatus(TransactionCase):
    """Pure rule, ported from the legacy TypeScript tests."""

    def test_pending_while_any_area_pending(self):
        rows = [("approved", False), ("pending", False), ("approved", False), ("approved", False)]
        self.assertEqual(special_release_status(rows, True), "pending_approval")

    def test_needs_posventa_even_if_all_approved(self):
        rows = [("approved", False)] * 4
        self.assertEqual(special_release_status(rows, False), "pending_approval")
        self.assertEqual(special_release_status(rows, True), "approved")

    def test_one_rejection_rejects_immediately(self):
        rows = [("rejected", False), ("pending", False), ("pending", False), ("pending", False)]
        self.assertEqual(special_release_status(rows, False), "rejected")

    def test_excluded_areas_are_ignored(self):
        rows = [("approved", False), ("pending", True), ("approved", False), ("approved", False)]
        self.assertEqual(special_release_status(rows, True), "approved")
        rows = [("approved", False), ("rejected", True), ("approved", False), ("approved", False)]
        self.assertEqual(special_release_status(rows, True), "approved")


@tagged("post_install", "-at_install", "iso_sgc")
class TestSpecialRelease(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        user_g = cls.env.ref("iso_sgc.group_iso_user")
        admin_g = cls.env.ref("iso_sgc.group_iso_admin")

        def mk(login, group=user_g):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {"name": login, "login": login, "email": f"{login}@example.com", "group_ids": [(6, 0, group.ids)]},
            )

        cls.creator, cls.q, cls.e, cls.c, cls.o, cls.pv, cls.other = (
            mk(n) for n in ("creator", "quality", "engineering", "commercial", "operations", "posventa", "other")
        )
        cls.admin = mk("isoadmin", admin_g)
        cls.today = fields.Date.context_today(cls.env["iso.special.release"])

    def _release(self, **kw):
        vals = {
            "release_type": "raw_material",
            "deviation_description": "Material fuera de especificación",
            "client_impact": "Ninguno",
            "purchase_order_number": "OC-1",
        }
        vals.update(kw)
        return self.env["iso.special.release"].with_user(self.creator).create(vals)

    def _ready(self, exclude=()):
        r = self._release()
        users = {"calidad": self.q, "ingenieria": self.e, "comercial": self.c, "operaciones": self.o}
        for a in r.approval_ids:
            if a.area in exclude:
                a.with_user(self.creator).excluded = True
            else:
                a.with_user(self.creator).user_id = users[a.area]
        r.with_user(self.creator).posventa_user_id = self.pv
        return r

    def _sent(self, exclude=()):
        r = self._ready(exclude)
        r.with_user(self.creator).action_send_for_approval()
        return r

    def _row(self, r, area):
        return r.approval_ids.filtered(lambda a: a.area == area)

    # ------------------------------------------------------------ creation / draft
    def test_creation(self):
        r = self._release()
        self.assertRegex(r.name, r"^LE-\d{4,}$")
        self.assertEqual(r.state, "draft")
        self.assertEqual(sorted(r.approval_ids.mapped("area")), ["calidad", "comercial", "ingenieria", "operaciones"])

    def test_commercial_cannot_be_excluded(self):
        r = self._release()
        with self.assertRaises(ValidationError):
            self._row(r, "comercial").with_user(self.creator).excluded = True

    def test_excluding_clears_approver_and_signature(self):
        r = self._ready()
        row = self._row(r, "calidad")
        row.with_user(self.creator).excluded = True
        self.assertFalse(row.user_id)
        self.assertEqual(row.state, "pending")

    def test_only_creator_edits_draft(self):
        r = self._release()
        with self.assertRaises(AccessError):
            r.with_user(self.other).client_impact = "x"
        r.with_user(self.creator).client_impact = "y"
        r.with_user(self.admin).client_impact = "z"

    def test_cannot_edit_after_sending(self):
        r = self._sent()
        with self.assertRaises(AccessError):
            r.with_user(self.creator).client_impact = "tarde"

    def test_non_admin_cannot_force_state(self):
        r = self._release()
        with self.assertRaises(AccessError):
            r.with_user(self.creator).state = "approved"

    # ------------------------------------------------------------ sending
    def test_send_requires_approvers_and_posventa(self):
        r = self._release()
        with self.assertRaises(ValidationError):
            r.with_user(self.creator).action_send_for_approval()
        r = self._ready()
        r.posventa_user_id = False
        with self.assertRaises(ValidationError):
            r.with_user(self.creator).action_send_for_approval()

    def test_excluded_areas_do_not_need_approvers(self):
        r = self._sent(exclude=("calidad", "ingenieria", "operaciones"))
        self.assertEqual(r.state, "pending_approval")

    def test_only_creator_sends(self):
        r = self._ready()
        with self.assertRaises(AccessError):
            r.with_user(self.other).action_send_for_approval()

    def test_sending_creates_activities(self):
        r = self._sent()
        users = r.activity_ids.user_id
        self.assertEqual(users, self.q | self.e | self.c | self.o | self.pv)

    # ------------------------------------------------------------ evaluation
    def test_only_assigned_approver_or_admin_evaluates(self):
        r = self._sent()
        row = self._row(r, "calidad")
        with self.assertRaises(AccessError):
            row.with_user(self.other).action_evaluate("approved")
        with self.assertRaises(AccessError):
            row.with_user(self.e).action_evaluate("approved")  # another area's approver
        row.with_user(self.q).action_evaluate("approved")
        self.assertEqual(row.state, "approved")
        self.assertTrue(row.action_date)
        self._row(r, "ingenieria").with_user(self.admin).action_evaluate("approved")

    def test_rejection_needs_comment_and_rejects_release(self):
        r = self._sent()
        row = self._row(r, "calidad")
        with self.assertRaises(ValidationError):
            row.with_user(self.q).action_evaluate("rejected", "  ")
        row.with_user(self.q).action_evaluate("rejected", "no cumple")
        self.assertEqual(r.state, "rejected")

    def test_cannot_evaluate_twice_or_in_draft(self):
        r = self._ready()
        with self.assertRaises(UserError):
            self._row(r, "calidad").with_user(self.q).action_evaluate("approved")
        r.with_user(self.creator).action_send_for_approval()
        row = self._row(r, "calidad")
        row.with_user(self.q).action_evaluate("approved")
        with self.assertRaises(UserError):
            row.with_user(self.q).action_evaluate("approved")

    def test_approved_needs_all_areas_and_posventa(self):
        r = self._sent()
        for area, user in (("calidad", self.q), ("ingenieria", self.e), ("comercial", self.c), ("operaciones", self.o)):
            self._row(r, area).with_user(user).action_evaluate("approved")
        self.assertEqual(r.state, "pending_approval")  # Posventa has not confirmed yet
        with self.assertRaises(AccessError):
            r.with_user(self.other).action_confirm_posventa()
        r.with_user(self.pv).action_confirm_posventa()
        self.assertEqual(r.state, "approved")
        self.assertTrue(r.posventa_confirmed_date)

    def test_posventa_first_then_areas(self):
        r = self._sent()
        r.with_user(self.pv).action_confirm_posventa()
        self.assertEqual(r.state, "pending_approval")
        for area, user in (("calidad", self.q), ("ingenieria", self.e), ("comercial", self.c), ("operaciones", self.o)):
            self._row(r, area).with_user(user).action_evaluate("approved")
        self.assertEqual(r.state, "approved")

    def test_resolution_is_posted_once(self):
        r = self._sent()
        before = len(r.message_ids)
        self._row(r, "calidad").with_user(self.q).action_evaluate("rejected", "no")
        posted = r.message_ids[: len(r.message_ids) - before].filtered(lambda m: "Final resolution" in (m.body or ""))
        self.assertEqual(len(posted), 1)
        # an admin amendment that leaves the release rejected must not announce it again
        self._row(r, "ingenieria").with_user(self.admin).action_admin_set("rejected", "tampoco")
        self.assertEqual(r.state, "rejected")
        again = r.message_ids.filtered(lambda m: "Final resolution" in (m.body or ""))
        self.assertEqual(len(again), 1)

    # ------------------------------------------------------------ admin amendments
    def test_admin_can_amend_signature_and_state_follows(self):
        r = self._sent()
        row = self._row(r, "calidad")
        row.with_user(self.q).action_evaluate("rejected", "no")
        self.assertEqual(r.state, "rejected")
        with self.assertRaises(AccessError):
            row.with_user(self.creator).action_admin_set("pending")
        row.with_user(self.admin).action_admin_set("pending")
        self.assertEqual(r.state, "pending_approval")
        self.assertFalse(row.action_date)
        with self.assertRaises(ValidationError):
            row.with_user(self.admin).action_admin_set("rejected", "")

    # ------------------------------------------------------------ linked actions
    def test_linked_action_creates_background_finding(self):
        r = self._release()
        f = r.with_user(self.creator).action_add_linked_action("Reinspeccionar lote", self.o, self.today + timedelta(days=3))
        self.assertEqual(f.state, "pending_action")
        self.assertEqual(f.special_release_id, r)
        self.assertEqual(f.owner_id, self.creator)
        self.assertEqual(f.origin, "Muro/ Control de Calidad")
        self.assertEqual(f.action_ids.user_id, self.o)
        self.assertIn(r.name, f.description)

    def test_linked_action_only_creator_and_only_in_draft(self):
        r = self._ready()
        with self.assertRaises(AccessError):
            r.with_user(self.other).action_add_linked_action("x", self.o, self.today)
        r.with_user(self.creator).action_send_for_approval()
        with self.assertRaises(AccessError):
            r.with_user(self.creator).action_add_linked_action("x", self.o, self.today)

    def test_wizard(self):
        r = self._release()
        w = self.env["iso.special.release.action.wizard"].with_user(self.creator).create(
            {"release_id": r.id, "description": "Hacer", "user_id": self.o.id, "date_deadline": self.today},
        )
        w.action_confirm()
        self.assertEqual(len(r.linked_finding_ids), 1)

    def test_delete_is_admin_only_and_cascades(self):
        r = self._release()
        f = r.with_user(self.creator).action_add_linked_action("x", self.o, self.today)
        with self.assertRaises(AccessError):
            r.with_user(self.creator).unlink()
        r.with_user(self.admin).unlink()
        self.assertFalse(f.exists())
