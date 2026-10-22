"""Takes screenshots of the main screens with Odoo's own headless-Chrome test browser.

Opt-in (skipped unless ISO_SCREENS=1, which scripts/screens.sh sets), because it needs Chrome and is slow.
Use scripts/screens.sh; images land in the
directory given to --screenshots. This is a development aid to review how simple the UI really looks.
"""

import contextlib
import os
import time
import unittest
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import urljoin

from odoo import fields
from odoo.tests import HttpCase, tagged
from odoo.tests.common import ChromeBrowser


@tagged("post_install", "-at_install", "iso_screens")
@unittest.skipUnless(os.environ.get("ISO_SCREENS"), "opt-in: run scripts/screens.sh")
class TestScreens(HttpCase):
    LANG = os.environ.get("ISO_LANG", "en_US")  # e.g. ISO_LANG=es_AR scripts/screens.sh

    def _mk(self, login, group):
        return self.env["res.users"].with_context(no_reset_password=True).create(
            {"name": login.capitalize(), "login": login, "password": login, "email": f"{login}@example.com",
             "group_ids": [(6, 0, group.ids)], "lang": self.LANG}
        )

    def _data(self):
        if self.LANG != "en_US":
            self.env["res.lang"]._activate_lang(self.LANG)
            self.env["ir.module.module"]._load_module_terms(["iso_sgc"], [self.LANG], overwrite=True)
        ug, ag = self.env.ref("iso_sgc.group_iso_user"), self.env.ref("iso_sgc.group_iso_admin")
        self.admin = self._mk("isoadmin", ag)
        self.analyst, self.owner, self.resp, self.approver = (
            self._mk(n, ug) for n in ("analyst", "owner", "resp", "approver")
        )
        today = fields.Date.context_today(self.env["iso.finding"])
        F, A = self.env["iso.finding"], self.env["iso.finding.action"]
        mk = lambda **kw: F.create({"origin": "Auditoría interna", "type": "Proceso", "process": "Calidad", **kw})  # noqa: E731
        f1 = mk(description="Falta el registro de calibración del calibre pie de rey en la línea 3.",
                owner_id=self.owner.id, analysis_user_id=self.analyst.id, analysis_deadline=today + timedelta(days=5))
        f2 = mk(description="Remito sin firma del proveedor en recepción de materia prima.",
                owner_id=self.owner.id, analysis_user_id=self.analyst.id, analysis_summary="Falta capacitación.")
        f2.with_user(self.analyst).action_save_analysis()
        a1 = A.with_user(self.analyst).create({"finding_id": f2.id, "name": "Capacitar al personal de recepción",
                                               "user_id": self.resp.id, "date_deadline": today + timedelta(days=12)})
        A.with_user(self.analyst).create({"finding_id": f2.id, "name": "Actualizar el instructivo IT-045",
                                          "user_id": self.owner.id, "date_deadline": today + timedelta(days=20)})
        f3 = mk(description="Mejora: etiquetar los estantes del depósito.", category="improvement", type=False,
                process=False, owner_id=self.owner.id)
        mk(description="Pieza soldada fuera de tolerancia.", owner_id=self.owner.id,
           analysis_user_id=self.analyst.id, state="completed")
        self.f1, self.f2, self.a1, self.f3 = f1, f2, a1, f3
        rel = self.env["iso.special.release"].with_user(self.owner).create(
            {"release_type": "raw_material", "deviation_description": "Chapa de 2 mm con espesor 1,9 mm.",
             "client_impact": "Sin impacto en el cliente.", "purchase_order_number": "OC-4471", "vendor": "Aceros SA"}
        )
        users = {"calidad": self.analyst, "ingenieria": self.resp, "comercial": self.approver, "operaciones": self.owner}
        for a in rel.approval_ids:
            a.with_user(self.owner).user_id = users[a.area]
        rel.with_user(self.owner).posventa_user_id = self.resp
        rel.with_user(self.owner).action_send_for_approval()
        rel.approval_ids[0].with_user(self.analyst).action_approve()
        self.rel = rel
        cr = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "Nueva plantilla de soldado en línea Fertec", "description": "Reemplazar la plantilla actual.",
             "objective": "Reducir retrabajos.", "current_situation": "Plantilla manual.",
             "proposed_situation": "Plantilla con topes fijos.", "impact_analysis": "Bajo."}
        )
        self.cr_draft = cr
        cr2 = self.env["iso.change.request"].with_user(self.owner).create(
            {"title": "Cambio de proveedor de tornillería", "description": "d", "objective": "o",
             "current_situation": "a", "proposed_situation": "b", "impact_analysis": "i"}
        )
        for code, u in (("calidad", self.analyst), ("supply_chain", self.resp)):
            cr2.review_ids.filtered(lambda v: v.area_id.code == code).with_user(self.owner).write(
                {"applies": True, "user_id": u.id})
        cr2.with_user(self.owner).review_deadline = today + timedelta(days=10)
        cr2.with_user(self.owner).action_send_to_review()
        for ln in cr2.review_ids.filtered(lambda v: v.area_id.code == "calidad").line_ids[:4]:
            ln.with_user(self.analyst).write({"applies": "yes", "requires_action": "no"})
        self.cr_review = cr2
        self.my_review = cr2.review_ids.filtered(lambda v: v.area_id.code == "calidad")
        wiz = self.env["iso.calendar.wizard"].with_user(self.admin).create({"year": today.year + 1})
        wiz.audit_line_ids.user_id = self.analyst
        wiz.activity_line_ids.user_id = self.resp
        self.cal = self.env["iso.calendar"].browse(wiz.action_create()["res_id"])
        self.audit = self.cal.task_ids.filtered("is_audit")[0]
        self.audit.with_user(self.analyst).write({"comments": "", "strengths": "Buen orden y limpieza."})

    def test_screens(self):
        self._data()
        self.env.cr.flush()
        shots = [
            ("analyst", "action-iso_sgc.action_iso_my_agenda", "01_my_agenda"),
            ("isoadmin", "action-iso_sgc.action_iso_finding", "02_findings_kanban"),
            ("analyst", f"action-iso_sgc.action_iso_finding/{self.f1.id}", "02b_finding_analysis_as_analyst"),
            ("isoadmin", f"action-iso_sgc.action_iso_finding/{self.f2.id}", "03_finding_form_actions"),
            ("resp", f"action-iso_sgc.action_iso_finding_action/{self.a1.id}", "04_action_form"),
            ("isoadmin", f"action-iso_sgc.action_iso_special_release/{self.rel.id}", "05_special_release_form"),
            ("isoadmin", f"action-iso_sgc.action_iso_change_request/{self.cr_draft.id}", "06_change_request_draft"),
            ("analyst", f"action-iso_sgc.action_iso_change_request/{self.cr_review.id}", "07_change_request_as_reviewer"),
            ("analyst", f"iso.change.review/{self.my_review.id}", "07b_review_questionnaire"),
            ("resp", f"action-iso_sgc.action_iso_special_release/{self.rel.id}", "05b_release_as_approver"),
            ("isoadmin", "action-iso_sgc.action_iso_deadline_calendar", "08_deadline_calendar"),
            ("analyst", f"action-iso_sgc.action_iso_calendar_task_mine/{self.audit.id}", "09_audit_task_form"),
            ("isoadmin", "action-iso_sgc.action_iso_calendar_wizard", "10_planning_wizard"),
            ("isoadmin", "action-iso_sgc.action_iso_findings_analysis", "11_findings_pivot"),
            ("isoadmin", f"action-iso_sgc.action_iso_finding/{self.f3.id}", "12_improvement_form"),
        ]
        browser = ChromeBrowser(self, headless=True)
        with self.allow_requests(browser=browser), contextlib.ExitStack() as atexit:
            atexit.callback(self._wait_remaining_requests)
            atexit.enter_context(browser.cleanup)
            if "bus.bus" in self.env.registry:
                from odoo.addons.bus.websocket import CloseCode, WebsocketConnectionHandler, _kick_all  # noqa: PLC0415
                atexit.callback(_kick_all, CloseCode.KILL_NOW)
                atexit.enter_context(patch.object(WebsocketConnectionHandler, "websocket_allowed", return_value=True))
            current = None
            for login, path, name in shots:
                if login != current:
                    self.authenticate(login, login, browser=browser)
                    self.cr.flush()
                    current = login
                browser.navigate_to(urljoin(self.base_url(), "/odoo/" + path), wait_stop=False)
                browser._wait_ready(
                    "!!document.querySelector('.o_action_manager .o_view_controller, .modal-content') "
                    "&& !document.querySelector('.o_loading_indicator, .o_blockUI')", timeout=40,
                )
                time.sleep(2.5)
                browser.take_screenshot(prefix=f"{name}_")
                time.sleep(1.5)
