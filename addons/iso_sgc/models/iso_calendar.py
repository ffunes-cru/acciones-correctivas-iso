from datetime import timedelta  # noqa: F401  (used by dashboards later)

from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from ..tools import calendar_rules

TASK_STATES = [("not_started", "Not started"), ("in_progress", "In progress"), ("done", "Done")]
FREQUENCIES = [("annual", "Annual"), ("semester", "Semester"), ("quarterly", "Quarterly"), ("monthly", "Monthly")]
STRUCTURAL_FIELDS = {
    "calendar_id", "name", "activity", "frequency", "label", "user_id", "date_deadline", "is_audit", "audit_process_id",
}
BUSINESS_FIELDS = {"comments", "date_completed", "audited_personnel", "scope", "criteria", "strengths", "line_ids"}


class IsoCalendar(models.Model):
    _name = "iso.calendar"
    _description = "ISO annual planning"
    _inherit = ["mail.thread"]
    _order = "year desc, id desc"
    _mail_post_access = "read"

    name = fields.Char(required=True, tracking=True)
    year = fields.Integer(required=True, default=lambda s: fields.Date.context_today(s).year + 1)
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    description = fields.Text(tracking=True)
    task_ids = fields.One2many("iso.calendar.task", "calendar_id", "Tasks")
    task_count = fields.Integer(compute="_compute_stats")
    done_count = fields.Integer(compute="_compute_stats")
    overdue_count = fields.Integer(compute="_compute_stats")

    @api.depends("task_ids.state", "task_ids.date_deadline")
    def _compute_stats(self):
        today = fields.Date.context_today(self)
        for c in self:
            c.task_count = len(c.task_ids)
            c.done_count = len(c.task_ids.filtered(lambda t: t.state == "done"))
            c.overdue_count = len(c.task_ids.filtered(lambda t: t.state != "done" and t.date_deadline < today))


class IsoCalendarTask(models.Model):
    _name = "iso.calendar.task"
    _description = "ISO calendar task"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "date_deadline, id"
    _mail_post_access = "read"

    calendar_id = fields.Many2one("iso.calendar", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="calendar_id.company_id", store=True, index=True)
    name = fields.Char(required=True)
    activity = fields.Char("Activity", help="Original activity name (without the instance label).")
    frequency = fields.Selection(FREQUENCIES, required=True, default="annual")
    label = fields.Char("Instance", help="T1…T4, Semestre 1, Enero, Ad-hoc…")
    user_id = fields.Many2one("res.users", "Responsible", required=True, tracking=True)
    date_deadline = fields.Date("Deadline", required=True, tracking=True)
    state = fields.Selection(TASK_STATES, default="not_started", required=True, tracking=True, copy=False, index=True)
    comments = fields.Text()
    date_completed = fields.Date("Execution date", copy=False)
    # audits
    is_audit = fields.Boolean("Internal audit", index=True)
    audit_process_id = fields.Many2one("iso.audit.process", "Audited process")
    process_objective = fields.Text(related="audit_process_id.objective", string="Objective")
    process_clauses = fields.Text(related="audit_process_id.clauses", string="Clauses")
    process_deliverable_ids = fields.One2many(related="audit_process_id.deliverable_ids", string="Deliverables")
    audited_personnel = fields.Char()
    scope = fields.Text()
    criteria = fields.Text()
    strengths = fields.Text()
    line_ids = fields.One2many("iso.audit.line", "task_id", "Audit findings")
    shared_user_ids = fields.Many2many("res.users", "iso_calendar_task_shared_rel", "task_id", "user_id", "Shared with")
    can_edit = fields.Boolean(compute="_compute_can_edit")
    is_overdue = fields.Boolean(compute="_compute_is_overdue")

    # ---------------------------------------------------------------- helpers
    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _is_locked(self):
        """A finished audit can only be changed by administrators."""
        self.ensure_one()
        return self.is_audit and self.state == "done" and not self._is_iso_admin()

    def _check_actor(self):
        self.ensure_one()
        if not (self._is_iso_admin() or self.env.user == self.user_id):
            raise AccessError(self.env._("Only the responsible or an administrator can do this."))

    @api.depends_context("uid")
    @api.depends("user_id", "state", "is_audit")
    def _compute_can_edit(self):
        for t in self:
            t.can_edit = (t._is_iso_admin() or self.env.user == t.user_id) and not t._is_locked()

    @api.depends("date_deadline", "state")
    def _compute_is_overdue(self):
        today = fields.Date.context_today(self)
        for t in self:
            t.is_overdue = bool(t.state != "done" and t.date_deadline and t.date_deadline < today)

    def _transition(self, vals):
        return self.sudo().with_context(iso_transition=True).write(vals)

    def _admin_partners(self):
        group = self.env.ref("iso_sgc.group_iso_admin")
        return self.env["res.users"].sudo().search([("all_group_ids", "in", group.id)]).partner_id

    def _schedule_activity(self):
        for t in self:
            t.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=t.date_deadline,
                user_id=t.user_id.id,
                summary=t.name,
            )

    # ---------------------------------------------------------------- ORM
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if "is_audit" not in vals:
                vals["is_audit"] = calendar_rules.guess_is_audit(vals.get("name"), vals.get("activity"))
            if not vals.get("label"):
                vals["label"] = "Ad-hoc"
            if not vals.get("activity"):
                vals["activity"] = "Auditoría Interna" if vals["is_audit"] else vals.get("name")
            if vals["is_audit"]:
                calendar = self.env["iso.calendar"].browse(vals.get("calendar_id"))
                vals.setdefault("scope", calendar.company_id.iso_audit_scope or False)
                vals.setdefault("criteria", calendar_rules.DEFAULT_AUDIT_CRITERIA)
        tasks = super().create(vals_list)
        tasks._schedule_activity()
        return tasks

    def write(self, vals):
        keys = set(vals)
        if not self.env.context.get("iso_transition"):
            if not self._is_iso_admin():
                if (STRUCTURAL_FIELDS | {"state", "shared_user_ids"}) & keys:
                    raise AccessError(self.env._("Only administrators can change the planning of a task."))
                if BUSINESS_FIELDS & keys:
                    for t in self:
                        t._check_actor()
                        if t._is_locked():
                            raise AccessError(self.env._("A finished internal audit can only be modified by administrators."))
            elif "state" in keys:
                raise AccessError(self.env._("Use the workflow buttons to change the status."))
            if {"user_id", "date_deadline"} & keys and any(t.state == "done" for t in self):
                raise UserError(self.env._("A finished task cannot be reassigned or rescheduled."))
        old_users = {t.id: t.user_id for t in self}
        res = super().write(vals)
        if "user_id" in keys or "date_deadline" in keys:
            for t in self.filtered(lambda r: r.state != "done"):
                t.sudo().activity_unlink(["mail.mail_activity_data_todo"])
                t._schedule_activity()
                if "user_id" in keys and old_users[t.id] != t.user_id:
                    t.sudo().message_post(
                        body=self.env._("Task reassigned to %s. Deadline: %s.", t.user_id.name, t.date_deadline),
                        partner_ids=t.user_id.partner_id.ids,
                        subtype_xmlid="mail.mt_comment",
                    )
        return res

    # ---------------------------------------------------------------- workflow
    def action_start(self):
        for t in self:
            t._check_actor()
            if t.state != "not_started":
                raise UserError(self.env._("Only a task that has not started can be started."))
            t._transition({"state": "in_progress"})
        return True

    def action_finish(self):
        for t in self:
            t._check_actor()
            if t.state == "done":
                raise UserError(self.env._("The task is already finished."))
            if not (t.comments or "").strip():
                raise ValidationError(self.env._("A comment / audit conclusion is required to finish the task."))
            if t.is_audit and calendar_rules.has_template_placeholders(t.comments):
                raise ValidationError(
                    self.env._("Adapt the conclusion template (replace the [bracketed] placeholders) before finishing.")
                )
            if t.is_audit and not (t.audited_personnel or "").strip():
                raise ValidationError(self.env._("The audited personnel is required to finish an internal audit."))
            t._transition({"state": "done", "date_completed": t.date_completed or fields.Date.context_today(t)})
            t.sudo().activity_feedback(["mail.mail_activity_data_todo"])
            if self.env.user == t.user_id:
                t.sudo().message_post(
                    body=self.env._("%s completed the task \"%s\".", self.env.user.name, t.name),
                    partner_ids=(t._admin_partners() - self.env.user.partner_id).ids,
                    subtype_xmlid="mail.mt_comment",
                )
        return True

    def action_reopen(self):
        for t in self:
            t._check_actor()
            if t.state != "done":
                raise UserError(self.env._("Only a finished task can be reopened."))
            if t.is_audit and not t._is_iso_admin():
                raise AccessError(self.env._("A finished internal audit can only be reopened by administrators."))
            t._transition({"state": "in_progress", "date_completed": False})
            t._schedule_activity()
        return True

    def action_insert_conclusion_template(self):
        """Pre-fill the conclusion with the standard text; finishing is refused until its placeholders are replaced."""
        for t in self:
            t._check_actor()
            if t._is_locked():
                raise AccessError(self.env._("A finished internal audit can only be modified by administrators."))
            if not (t.comments or "").strip():
                t.comments = calendar_rules.conclusion_template(t.audit_process_id.name or t.activity or t.name)
        return True


class IsoAuditLine(models.Model):
    """Opportunity / minor NC / major NC noted in an audit; 'confirming' raises the corresponding finding."""

    _name = "iso.audit.line"
    _description = "ISO audit finding line"
    _order = "kind, id"

    task_id = fields.Many2one("iso.calendar.task", required=True, ondelete="cascade", index=True)
    kind = fields.Selection(
        [("opportunity", "Improvement opportunity"), ("minor", "Minor nonconformity"), ("major", "Major nonconformity")],
        required=True,
    )
    text = fields.Text(required=True)
    process = fields.Char("Originating process", help="Required for nonconformities.")
    user_id = fields.Many2one("res.users", "Responsible")
    date_deadline = fields.Date("Deadline")
    finding_id = fields.Many2one("iso.finding", "Finding", readonly=True, copy=False)
    can_confirm = fields.Boolean(compute="_compute_can_confirm")

    @api.depends_context("uid")
    @api.depends("finding_id", "task_id.state", "task_id.user_id", "task_id.is_audit")
    def _compute_can_confirm(self):
        for ln in self:
            t = ln.task_id
            ln.can_confirm = bool(
                not ln.finding_id and ln.id and (t._is_iso_admin() or self.env.user == t.user_id) and not t._is_locked()
            )

    def _check_task_editable(self):
        for ln in self:
            t = ln.task_id
            if not self.env.context.get("iso_transition") and not t._is_iso_admin():
                t._check_actor()
                if t._is_locked():
                    raise AccessError(self.env._("A finished internal audit can only be modified by administrators."))

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        lines._check_task_editable()
        return lines

    def write(self, vals):
        self._check_task_editable()
        if not self.env.context.get("iso_transition") and any(ln.finding_id for ln in self):
            raise UserError(self.env._("A confirmed item is linked to a finding and can no longer be edited."))
        return super().write(vals)

    def unlink(self):
        self._check_task_editable()
        if any(ln.finding_id for ln in self):
            raise UserError(self.env._("A confirmed item is linked to a finding and cannot be deleted."))
        return super().unlink()

    def action_confirm(self):
        """Raise the finding: opportunity -> improvement (already pending action); NC -> corrective (pending analysis)."""
        for ln in self:
            t = ln.task_id
            t._check_actor()
            if t._is_locked():
                raise AccessError(self.env._("A finished internal audit can only be modified by administrators."))
            if ln.finding_id:
                raise UserError(self.env._("This item is already linked to a finding."))
            if not (ln.text or "").strip():
                raise ValidationError(self.env._("Write a description before linking the finding."))
            if not ln.user_id:
                raise ValidationError(self.env._("Select a responsible."))
            if not ln.date_deadline:
                raise ValidationError(self.env._("Select a deadline."))
            if ln.kind != "opportunity" and not (ln.process or "").strip():
                raise ValidationError(self.env._("Fill in the process that generates the deviation."))
            base = {
                "company_id": t.company_id.id,
                "finding_date": fields.Date.context_today(ln),
                "origin": "Auditoría Interna",
                "owner_id": self.env.user.id,
            }
            if ln.kind == "opportunity":
                finding = self.env["iso.finding"].create(
                    {
                        **base,
                        "category": "improvement",
                        "type": "Mejora",
                        "process": "Mejora",
                        "description": self.env._(
                            "Improvement opportunities detected during the internal audit (%s)", t.name
                        ),
                    }
                )
                self.env["iso.finding.action"].create(
                    {"finding_id": finding.id, "name": ln.text, "user_id": ln.user_id.id, "date_deadline": ln.date_deadline}
                )
            else:
                label = self.env._("Minor nonconformities") if ln.kind == "minor" else self.env._("Major nonconformities")
                finding = self.env["iso.finding"].create(
                    {
                        **base,
                        "category": "corrective",
                        "type": "No conformidad menor" if ln.kind == "minor" else "No conformidad mayor",
                        "process": ln.process,
                        "description": self.env._(
                            "%s detected during the internal audit (%s) - Detail: %s", label, t.name, ln.text
                        ),
                        "analysis_user_id": ln.user_id.id,
                        "analysis_deadline": ln.date_deadline,
                    }
                )
            ln.sudo().with_context(iso_transition=True).write({"finding_id": finding.id})
        return True
