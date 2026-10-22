from datetime import timedelta

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import Form, TransactionCase, tagged
from odoo.tools.safe_eval import safe_eval


@tagged("post_install", "-at_install", "iso_sgc")
class TestUI(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        user_g = cls.env.ref("iso_sgc.group_iso_user")

        def mk(login):
            return cls.env["res.users"].with_context(no_reset_password=True).create(
                {"name": login, "login": login, "email": f"{login}@example.com", "group_ids": [(6, 0, user_g.ids)]},
            )

        cls.owner, cls.analyst, cls.other = mk("owner"), mk("analyst"), mk("other")
        cls.admin = cls.env["res.users"].with_context(no_reset_password=True).create(
            {"name": "isoadmin", "login": "isoadmin", "email": "isoadmin@example.com",
             "group_ids": [(6, 0, cls.env.ref("iso_sgc.group_iso_admin").ids)]},
        )
        cls.today = fields.Date.context_today(cls.env["iso.finding"])

    # ------------------------------------------------------------ every declared view builds
    def test_all_views_build(self):
        wanted = {
            "iso.finding": ["kanban", "list", "form", "pivot", "graph", "search"],
            "iso.finding.action": ["list", "calendar", "form", "pivot", "search"],
            "iso.special.release": ["kanban", "list", "form", "search"],
            "iso.special.release.approval": ["form"],
            "iso.change.request": ["kanban", "list", "form", "search"],
            "iso.change.review": ["form"],
            "iso.calendar": ["list", "form"],
            "iso.calendar.task": ["list", "calendar", "form", "search"],
            "iso.audit.process": ["list", "form"],
            "iso.change.area": ["list", "form"],
            "iso.calendar.wizard": ["form"],
        }
        for model, types in wanted.items():
            user = self.admin if model.endswith(".wizard") else self.owner  # the planning wizard is admin-only
            for t in types:
                try:
                    view = self.env[model].with_user(user).get_views([(False, t)])["views"][t]
                except Exception as e:  # noqa: BLE001
                    self.fail(f"{model} / {t} view does not build: {e}")
                self.assertTrue(view["arch"], f"{model} {t} view has no arch")

    # ------------------------------------------------------------ real flows through the real views
    def test_create_finding_through_the_form(self):
        with Form(self.env["iso.finding"].with_user(self.owner)) as f:
            f.origin = "Auditoría"
            f.type = "Proceso"
            f.process = "Calidad"
            f.description = "Falta un registro"
            f.analysis_user_id = self.analyst
            f.analysis_deadline = self.today + timedelta(days=5)
        rec = f.record
        self.assertEqual(rec.state, "pending_analysis")
        self.assertEqual(rec.owner_id, self.owner)
        self.assertIn(self.analyst.name, rec.next_step)

    def test_create_change_request_through_the_form(self):
        with Form(self.env["iso.change.request"].with_user(self.owner)) as f:
            f.title = "Nueva plantilla"
            f.description = "d"
            f.objective = "o"
            f.current_situation = "a"
            f.proposed_situation = "b"
            f.impact_analysis = "i"
        self.assertEqual(f.record.state, "draft")
        self.assertEqual(len(f.record.review_ids), 8)

    def test_create_special_release_through_the_form(self):
        with Form(self.env["iso.special.release"].with_user(self.owner)) as f:
            f.release_type = "raw_material"
            f.deviation_description = "Material fuera de especificación"
            f.client_impact = "Ninguno"
        self.assertEqual(f.record.state, "draft")
        self.assertEqual(len(f.record.approval_ids), 4)

    def test_improvement_hides_analysis_fields_and_needs_no_type(self):
        with Form(self.env["iso.finding"].with_user(self.owner)) as f:
            f.category = "improvement"
            f.origin = "Idea"
            f.description = "Mejorar algo"
        self.assertEqual(f.record.state, "pending_action")

    # ------------------------------------------------------------ "what's next" guidance
    def test_next_step_follows_the_finding(self):
        f = self.env["iso.finding"].with_user(self.owner).create(
            {"origin": "x", "type": "t", "process": "p", "description": "d", "analysis_user_id": self.analyst.id},
        )
        self.assertIn("cause analysis", f.next_step)
        f.analysis_summary = "ok"
        f.with_user(self.analyst).action_save_analysis()
        self.assertIn("add the actions", f.next_step)
        a = self.env["iso.finding.action"].with_user(self.analyst).create(
            {"finding_id": f.id, "name": "x", "user_id": self.other.id, "date_deadline": self.today},
        )
        self.assertIn(self.other.name, f.next_step)
        a.with_user(self.other).action_execute("finished", "ok")
        self.assertIn("verify", f.next_step)
        a.with_user(self.owner).action_verify(True)
        self.assertIn("effective", f.next_step)
        self.assertIn("Closed", f.next_step)

    def test_next_step_special_release_and_change_request(self):
        r = self.env["iso.special.release"].with_user(self.owner).create(
            {"release_type": "raw_material", "deviation_description": "d", "client_impact": "i"},
        )
        self.assertIn("send for approval", r.next_step)
        cr = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "t", "description": "d", "objective": "o", "current_situation": "a",
             "proposed_situation": "b", "impact_analysis": "i"},
        )
        self.assertIn("send it to review", cr.next_step)

    # ------------------------------------------------------------ "My agenda"
    def test_my_agenda_shows_only_my_iso_todos(self):
        self.env["iso.finding"].with_user(self.owner).create(
            {"origin": "x", "type": "t", "process": "p", "description": "d", "analysis_user_id": self.analyst.id},
        )
        # An unrelated activity of the same person must not show up.
        partner = self.env.ref("base.partner_admin")
        partner.activity_schedule("mail.mail_activity_data_todo", user_id=self.analyst.id, summary="not ours")
        action = self.env.ref("iso_sgc.action_iso_my_agenda")
        domain = safe_eval(action.domain, {"uid": self.analyst.id})
        mine = self.env["mail.activity"].with_user(self.analyst).search(domain)
        self.assertTrue(mine)
        self.assertEqual(set(mine.mapped("res_model")), {"iso.finding"})
        self.assertEqual(mine.user_id, self.analyst)
        self.assertFalse(self.env["mail.activity"].with_user(self.owner).search(
            safe_eval(action.domain, {"uid": self.owner.id}),
        ))

    # ------------------------------------------------------------ one-click actions and ordering
    def test_kanban_columns_follow_the_workflow(self):
        F = self.env["iso.finding"]
        self.assertEqual(F._expand_states([]), ["pending_analysis", "pending_action", "pending_verification"])
        self.assertEqual(
            F._expand_states(["rejected", "completed"]),
            ["pending_analysis", "pending_action", "pending_verification", "completed", "rejected"],
        )
        self.assertEqual(self.env["iso.special.release"]._expand_states(["approved"])[:3],
                         ["draft", "pending_approval", "approved"])
        self.assertEqual(self.env["iso.change.request"]._expand_states([]), ["draft", "pending_review", "pending_approval"])

    def test_approver_signs_in_one_click(self):
        rel = self.env["iso.special.release"].with_user(self.owner).create(
            {"release_type": "raw_material", "deviation_description": "d", "client_impact": "i"},
        )
        users = {"calidad": self.analyst, "ingenieria": self.analyst, "comercial": self.other, "operaciones": self.owner}
        for a in rel.approval_ids:
            a.with_user(self.owner).user_id = users[a.area]
        rel.with_user(self.owner).posventa_user_id = self.other
        self.assertFalse(rel.with_user(self.analyst).can_sign)  # still draft
        rel.with_user(self.owner).action_send_for_approval()
        mine = rel.with_user(self.analyst)
        self.assertTrue(mine.can_sign)
        mine.action_sign_approve()  # the analyst holds two areas: both are signed at once
        self.assertEqual(rel.approval_ids.filtered(lambda a: a.user_id == self.analyst).mapped("state"), ["approved", "approved"])
        self.assertFalse(rel.with_user(self.analyst).can_sign)
        with self.assertRaises(UserError):
            rel.with_user(self.analyst).action_sign_approve()

    def test_reject_opens_the_signature_to_type_a_comment(self):
        rel = self.env["iso.special.release"].with_user(self.owner).create(
            {"release_type": "raw_material", "deviation_description": "d", "client_impact": "i"},
        )
        for a in rel.approval_ids:
            a.with_user(self.owner).user_id = self.analyst
        rel.with_user(self.owner).posventa_user_id = self.other
        rel.with_user(self.owner).action_send_for_approval()
        act = rel.with_user(self.analyst).action_sign_reject()
        self.assertEqual(act["res_model"], "iso.special.release.approval")
        self.assertIn(act["res_id"], rel.approval_ids.ids)

    def test_reviewer_opens_their_questionnaire_in_one_click(self):
        cr = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "t", "description": "d", "objective": "o", "current_situation": "a",
             "proposed_situation": "b", "impact_analysis": "i"},
        )
        review = cr.review_ids.filtered(lambda v: v.area_id.code == "calidad")
        review.with_user(self.owner).write({"applies": True, "user_id": self.analyst.id})
        cr.with_user(self.owner).review_deadline = self.today
        self.assertFalse(cr.with_user(self.analyst).can_review)  # not sent yet
        cr.with_user(self.owner).action_send_to_review()
        self.assertTrue(cr.with_user(self.analyst).can_review)
        self.assertFalse(cr.with_user(self.other).can_review)
        act = cr.with_user(self.analyst).action_open_my_review()
        self.assertEqual((act["res_model"], act["res_id"]), ("iso.change.review", review.id))

    def test_agenda_defaults_to_the_next_30_days(self):
        action = self.env.ref("iso_sgc.action_iso_my_agenda")
        self.assertIn("search_default_iso_next_30", action.context)
        arch = self.env["mail.activity"].get_view(self.env.ref("iso_sgc.view_iso_activity_search").id, "search")["arch"]
        self.assertIn("iso_next_30", arch)

    # ------------------------------------------------------------ names and formats seen in the screenshots
    def test_display_names_are_readable(self):
        cr = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "t", "description": "d", "objective": "o", "current_situation": "a",
             "proposed_situation": "b", "impact_analysis": "i"},
        )
        review = cr.review_ids.filtered(lambda v: v.area_id.code == "calidad")
        self.assertEqual(review.display_name, f"{cr.name} · Calidad")
        rel = self.env["iso.special.release"].with_user(self.owner).create(
            {"release_type": "raw_material", "deviation_description": "d", "client_impact": "i"},
        )
        self.assertTrue(rel.approval_ids[0].display_name.startswith(f"{rel.name} · "))

    def test_year_is_shown_without_a_thousands_separator(self):
        for xmlid in ("iso_sgc.view_iso_calendar_wizard_form", "iso_sgc.view_iso_calendar_form"):
            self.assertIn("'enable_formatting': false", self.env.ref(xmlid).arch, xmlid)
