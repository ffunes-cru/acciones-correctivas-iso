from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

MAX_DESCRIPTION = 2000
PROTECTED_FIELDS = {"state", "is_verified", "verification_date", "owner_id"}


class IsoFinding(models.Model):
    """Finding (non-conformity) or improvement opportunity.

    Workflow (ported from the legacy FindingDetails.tsx):
      pending_analysis -> pending_action -> pending_verification -> completed
                                                  \\-> cancelled (a verification failed)
      any pending action rejected -> rejected
    Improvements skip the analysis step.
    """

    _name = "iso.finding"
    _description = "ISO finding"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "id desc"
    _mail_post_access = "read"  # anyone who can read a finding may comment on it

    name = fields.Char("Number", readonly=True, copy=False, default="New")
    company_id = fields.Many2one(
        "res.company", required=True, default=lambda s: s.env.company, index=True
    )
    category = fields.Selection(
        [("corrective", "Corrective"), ("improvement", "Improvement")],
        required=True,
        default="corrective",
    )
    finding_date = fields.Date(required=True, default=fields.Date.context_today)
    origin = fields.Char(required=True)
    type = fields.Char()
    process = fields.Char()
    description = fields.Text(required=True)
    owner_id = fields.Many2one(
        "res.users", "Owner", required=True, default=lambda s: s.env.user, tracking=True
    )
    analysis_user_id = fields.Many2one("res.users", "Analysis responsible", tracking=True)
    analysis_deadline = fields.Date(tracking=True)
    state = fields.Selection(
        [
            ("pending_analysis", "Pending analysis"),
            ("pending_action", "Pending action"),
            ("pending_verification", "Pending verification"),
            ("completed", "Completed"),
            ("cancelled", "Cancelled"),
            ("rejected", "Rejected"),
        ],
        default="pending_analysis",
        required=True,
        tracking=True,
        copy=False,
        index=True,
        group_expand="_expand_states",
    )
    analysis_summary = fields.Text()
    contingency_actions = fields.Text()
    action_ids = fields.One2many("iso.finding.action", "finding_id", "Actions")
    special_release_id = fields.Many2one("iso.special.release", "Special release", ondelete="cascade", copy=False)
    change_request_id = fields.Many2one("iso.change.request", "Change request", ondelete="cascade", copy=False)
    is_verified = fields.Boolean(readonly=True, copy=False)
    verification_date = fields.Datetime(readonly=True, copy=False)
    # Derived (the legacy app stored these as arrays and kept them in sync by hand).
    pending_user_ids = fields.Many2many(
        "res.users",
        string="Pending on",
        compute="_compute_pending_user_ids",
        store=True,
    )

    @api.model
    def _expand_states(self, states, domain=None, order=None):
        """Kanban columns in workflow order; the three open steps are always shown."""
        always = ("pending_analysis", "pending_action", "pending_verification")
        return [k for k, _label in self._fields["state"].selection if k in always or k in states]

    # ---------------------------------------------------------------- helpers
    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _planner(self):
        """Who may add actions: the analyst (corrective) or the owner (improvement)."""
        self.ensure_one()
        return self.owner_id if self.category == "improvement" else self.analysis_user_id

    def _check_can_add_action(self):
        self.ensure_one()
        if self._is_iso_admin():
            pass
        elif self.env.user != self._planner():
            raise AccessError(self.env._("You are not allowed to add actions to this finding."))
        if self.state != "pending_action":
            raise UserError(self.env._("Actions can only be added while the finding is pending action."))

    # ---------------------------------------------------------------- computes
    @api.depends("state", "owner_id", "analysis_user_id", "category", "action_ids.state", "action_ids.user_id")
    def _compute_pending_user_ids(self):
        for f in self:
            users = self.env["res.users"]
            if f.state == "pending_analysis":
                users = f.analysis_user_id
            elif f.state == "pending_action":
                users = f.action_ids.filtered(lambda a: a.state == "pending").user_id | f._planner()
            elif f.state == "pending_verification":
                users = f.owner_id
            f.pending_user_ids = users

    next_step = fields.Char("What's next", compute="_compute_next_step")

    @api.depends("state", "category", "owner_id", "analysis_user_id", "action_ids.state", "action_ids.user_id")
    def _compute_next_step(self):
        for f in self:
            if f.state == "pending_analysis":
                f.next_step = self.env._("%s has to record the cause analysis.", f.analysis_user_id.name or self.env._("An analyst"))
            elif f.state == "pending_action":
                pending = f.action_ids.filtered(lambda a: a.state == "pending")
                if pending:
                    f.next_step = self.env._("Waiting for the actions of: %s.", ", ".join(pending.user_id.mapped("name")))
                else:
                    f.next_step = self.env._("%s has to add the actions.", f._planner().name or self.env._("The planner"))
            elif f.state == "pending_verification":
                f.next_step = self.env._("%s has to verify that each finished action was effective.", f.owner_id.name)
            elif f.state == "completed":
                f.next_step = self.env._("Closed: all actions were effective.")
            elif f.state == "cancelled":
                f.next_step = self.env._("Closed: an action was not effective or nothing was carried out.")
            else:
                f.next_step = self.env._("Closed: an action was rejected.")

    # ---------------------------------------------------------------- constraints
    @api.constrains("description")
    def _check_description_length(self):
        for f in self:
            if len(f.description or "") > MAX_DESCRIPTION:
                raise ValidationError(
                    self.env._("The description cannot exceed %s characters.", MAX_DESCRIPTION)
                )

    @api.constrains("category", "type", "process")
    def _check_corrective_fields(self):
        for f in self:
            if f.category == "corrective" and not (f.type and f.process):
                raise ValidationError(self.env._("Type and process are required for corrective findings."))

    # ---------------------------------------------------------------- ORM
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                # Legacy numbers improvements and corrective findings independently.
                code = "iso.finding.improvement" if vals.get("category") == "improvement" else "iso.finding"
                vals["name"] = self.env["ir.sequence"].next_by_code(code) or "New"
            # The web form always sends its default state, so test for "still the default" rather than "absent".
            if vals.get("category") == "improvement" and vals.get("state", "pending_analysis") == "pending_analysis":
                vals["state"] = "pending_action"
        findings = super().create(vals_list)
        for f in findings:
            f._schedule_analysis_activity()
        return findings

    def write(self, vals):
        if PROTECTED_FIELDS & set(vals) and not self.env.context.get("iso_transition") and not self._is_iso_admin():
            raise AccessError(self.env._("Workflow fields can only be changed through the workflow buttons."))
        res = super().write(vals)
        if "analysis_user_id" in vals or "analysis_deadline" in vals:
            for f in self.filtered(lambda r: r.state == "pending_analysis"):
                f.sudo().activity_unlink(["mail.mail_activity_data_todo"])
                f._schedule_analysis_activity()
        return res

    def _schedule_analysis_activity(self):
        self.ensure_one()
        if self.state == "pending_analysis" and self.analysis_user_id:
            self.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=self.analysis_deadline or fields.Date.context_today(self),
                user_id=self.analysis_user_id.id,
                summary=self.env._("Cause analysis for %s", self.name),
            )

    def _transition(self, vals):
        return self.sudo().with_context(iso_transition=True).write(vals)

    @api.model
    def _create_with_action(self, vals, action_name, user, deadline):
        """Background corrective finding that skips the analysis (born pending_action) with its single action.

        Used when another process (special release, change request) needs somebody to do something.
        The current user must be the planner (analyst) or an administrator, as for any other action.
        """
        finding = self.create({**vals, "category": "corrective", "state": "pending_action"})
        self.env["iso.finding.action"].create(
            {"finding_id": finding.id, "name": action_name, "user_id": user.id, "date_deadline": deadline}
        )
        return finding

    # ---------------------------------------------------------------- workflow
    def action_save_analysis(self):
        """Analysis done -> pending_action. Allowed to admin, owner and analyst."""
        for f in self:
            if f.state != "pending_analysis":
                raise UserError(self.env._("The finding is not pending analysis."))
            if not (f._is_iso_admin() or self.env.user in (f.owner_id | f.analysis_user_id)):
                raise AccessError(self.env._("You are not allowed to save the analysis of this finding."))
            if not (f.analysis_summary or "").strip():
                raise ValidationError(self.env._("The analysis summary is required."))
            f.sudo().activity_feedback(["mail.mail_activity_data_todo"])
            f._transition({"state": "pending_action"})
        return True

    def _after_action_executed(self):
        """Re-evaluate the finding after an action left `pending`."""
        self.ensure_one()
        actions = self.action_ids
        if any(a.state == "pending" for a in actions):
            return
        if any(a.state == "rejected" for a in actions):
            self._transition({"state": "rejected"})
        elif not any(a.state == "finished" for a in actions):
            # Deviation from legacy: with only cancelled actions nothing can be verified,
            # which used to leave the finding stuck in pending_verification forever.
            self._transition({"state": "cancelled"})
        else:
            self._transition({"state": "pending_verification"})
            self.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=fields.Date.context_today(self),
                user_id=self.owner_id.id,
                summary=self.env._("Verify effectiveness of %s", self.name),
            )

    def _after_action_verified(self):
        self.ensure_one()
        if self.state != "pending_verification":
            return
        finished = self.action_ids.filtered(lambda a: a.state == "finished")
        if any(a.verification_state == "unverified" for a in finished):
            return
        ok = all(a.verification_state == "ok" for a in finished)
        self.sudo().activity_feedback(["mail.mail_activity_data_todo"])
        self._transition(
            {
                "state": "completed" if ok else "cancelled",
                "is_verified": ok,
                "verification_date": fields.Datetime.now(),
            }
        )
