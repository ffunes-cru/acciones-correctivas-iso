import re
from datetime import date

from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

from ..tools import calendar_rules
from .iso_calendar import FREQUENCIES

QUARTERS = [("T1", "T1"), ("T2", "T2"), ("T3", "T3"), ("T4", "T4")]
QUARTER_DATES = {q: (m, d) for q, m, d in calendar_rules.AUDIT_QUARTERS}


class IsoCalendarWizard(models.TransientModel):
    """Generates a yearly planning: 12 processes x 4 audit quarters + routine activities."""

    _name = "iso.calendar.wizard"
    _description = "Create ISO annual planning"

    year = fields.Integer(required=True, default=lambda s: fields.Date.context_today(s).year + 1)
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company)
    name = fields.Char(required=True)
    description = fields.Text()
    global_auditor_id = fields.Many2one("res.users", "Apply this auditor to all audits")
    global_responsible_id = fields.Many2one("res.users", "Apply this responsible to all routine activities")
    audit_line_ids = fields.One2many("iso.calendar.wizard.audit", "wizard_id", "Internal audits")
    activity_line_ids = fields.One2many("iso.calendar.wizard.activity", "wizard_id", "Routine activities")

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        year = res.get("year") or fields.Date.context_today(self).year + 1
        company = self.env["res.company"].browse(res.get("company_id") or self.env.company.id)
        res.setdefault("name", self.env._("ISO planning %s %s", company.name, year))
        res["audit_line_ids"] = [
            (0, 0, {"process_id": p.id, "quarter": q, "date": d})
            for p in self.env["iso.audit.process"].search([])
            for q, d in calendar_rules.audit_instances(year)
        ]
        res["activity_line_ids"] = [
            (0, 0, {"name": t.name, "frequency": t.frequency}) for t in self.env["iso.activity.template"].search([])
        ]
        return res

    @api.onchange("year")
    def _onchange_year(self):
        for ln in self.audit_line_ids:
            m, d = QUARTER_DATES[ln.quarter]
            ln.date = date(self.year, m, d)
        self.name = self.env._("ISO planning %s %s", self.company_id.name, self.year)

    @api.onchange("company_id")
    def _onchange_company(self):
        self.name = self.env._("ISO planning %s %s", self.company_id.name, self.year)

    @api.onchange("global_auditor_id")
    def _onchange_global_auditor(self):
        if self.global_auditor_id:
            self.audit_line_ids.user_id = self.global_auditor_id

    @api.onchange("global_responsible_id")
    def _onchange_global_responsible(self):
        if self.global_responsible_id:
            self.activity_line_ids.user_id = self.global_responsible_id

    def action_create(self):
        self.ensure_one()
        if not self.env.user.has_group("iso_sgc.group_iso_admin"):
            raise AccessError(self.env._("Only administrators can create the annual planning."))
        if any(not ln.user_id for ln in self.audit_line_ids):
            raise ValidationError(self.env._("Assign an auditor to every quarter of every internal-audit process."))
        if any(not ln.user_id for ln in self.activity_line_ids):
            raise ValidationError(self.env._("Assign a responsible to every routine activity."))
        calendar = self.env["iso.calendar"].create(
            {
                "name": self.name, "year": self.year, "company_id": self.company_id.id,
                "description": self.description,
            }
        )
        vals_list = []
        for ln in self.audit_line_ids:
            vals_list.append(
                {
                    "calendar_id": calendar.id,
                    "name": calendar_rules.audit_task_name(ln.process_id.name, ln.quarter),
                    "activity": "Auditoría Interna",
                    "frequency": "quarterly",
                    "label": ln.quarter,
                    "user_id": ln.user_id.id,
                    "date_deadline": ln.date,
                    "is_audit": True,
                    "audit_process_id": ln.process_id.id,
                }
            )
        for ln in self.activity_line_ids:
            for label, planned in calendar_rules.frequency_instances(ln.frequency, self.year):
                vals_list.append(
                    {
                        "calendar_id": calendar.id,
                        "name": calendar_rules.routine_task_name(ln.name, label),
                        "activity": ln.name,
                        "frequency": ln.frequency,
                        "label": label,
                        "user_id": ln.user_id.id,
                        "date_deadline": planned,
                        "is_audit": False,
                    }
                )
        tasks = self.env["iso.calendar.task"].create(vals_list)
        # One digest per responsible (replaces the legacy per-user mail) and a summary for the administrators.
        for user in tasks.user_id:
            mine = tasks.filtered(lambda t: t.user_id == user)
            lines = "".join(f"<li>{t.name} ({t.date_deadline})</li>" for t in mine)
            calendar.message_post(
                body=self.env._("%s, you were assigned %s tasks in %s:", user.name, len(mine), calendar.name)
                + f"<ul>{lines}</ul>",
                partner_ids=user.partner_id.ids,
                subtype_xmlid="mail.mt_comment",
            )
        calendar.message_post(
            body=self.env._("Annual planning %s published with %s tasks.", self.year, len(tasks)),
            partner_ids=tasks[:1]._admin_partners().ids,
            subtype_xmlid="mail.mt_comment",
        )
        return {
            "type": "ir.actions.act_window", "res_model": "iso.calendar", "res_id": calendar.id,
            "view_mode": "form", "target": "current",
        }


class IsoCalendarWizardAudit(models.TransientModel):
    _name = "iso.calendar.wizard.audit"
    _description = "Planning wizard: audit instance"
    _order = "id"

    wizard_id = fields.Many2one("iso.calendar.wizard", required=True, ondelete="cascade")
    process_id = fields.Many2one("iso.audit.process", required=True)
    quarter = fields.Selection(QUARTERS, required=True)
    date = fields.Date(required=True)
    user_id = fields.Many2one("res.users", "Auditor")


class IsoCalendarWizardActivity(models.TransientModel):
    _name = "iso.calendar.wizard.activity"
    _description = "Planning wizard: routine activity"
    _order = "id"

    wizard_id = fields.Many2one("iso.calendar.wizard", required=True, ondelete="cascade")
    name = fields.Char(required=True)
    frequency = fields.Selection(FREQUENCIES, required=True, default="annual")
    user_id = fields.Many2one("res.users", "Responsible")


class IsoCalendarShareWizard(models.TransientModel):
    """Share an audit with people: grants them access to it and notifies them."""

    _name = "iso.calendar.share.wizard"
    _description = "Share an ISO audit"

    task_id = fields.Many2one("iso.calendar.task", required=True)
    user_ids = fields.Many2many("res.users", string="Users")
    extra_emails = fields.Char(help="Comma-separated addresses of people without a user: they get the notification only, no access.")
    message = fields.Text()

    def action_send(self):
        self.ensure_one()
        task = self.task_id
        task._check_actor()
        emails = [e.strip() for e in (self.extra_emails or "").split(",") if e.strip()]
        bad = [e for e in emails if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e)]
        if bad:
            raise ValidationError(self.env._("Invalid email address: %s", ", ".join(bad)))
        if not self.user_ids and not emails:
            raise ValidationError(self.env._("Select at least one recipient."))
        if task.is_audit and self.user_ids:
            task._transition({"shared_user_ids": [(4, u.id) for u in self.user_ids]})
        body = self.env._("Internal audit report shared: %s.", task.name) + (f"<br/>{self.message}" if self.message else "")
        task.sudo().message_post(body=body, partner_ids=self.user_ids.partner_id.ids, subtype_xmlid="mail.mt_comment")
        if emails:
            self.env["mail.mail"].sudo().create(
                {"subject": task.name, "body_html": body, "email_to": ",".join(emails), "auto_delete": True}
            )
        return {"type": "ir.actions.act_window_close"}
