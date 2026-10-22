from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

PROTECTED_FIELDS = {"state", "execution_date", "verification_state", "verification_date", "finding_id"}


class IsoFindingAction(models.Model):
    _name = "iso.finding.action"
    _description = "ISO finding action"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "date_deadline, id"
    _mail_post_access = "read"

    finding_id = fields.Many2one("iso.finding", required=True, ondelete="cascade", index=True)
    company_id = fields.Many2one(related="finding_id.company_id", store=True)
    name = fields.Text("Description", required=True)
    user_id = fields.Many2one("res.users", "Responsible", required=True, tracking=True)
    date_deadline = fields.Date("Deadline", required=True, tracking=True)
    state = fields.Selection(
        [
            ("pending", "Pending"),
            ("finished", "Finished"),
            ("cancelled", "Cancelled"),
            ("rejected", "Rejected"),
        ],
        default="pending",
        required=True,
        tracking=True,
        copy=False,
    )
    implementation_comment = fields.Text()
    execution_date = fields.Datetime(readonly=True, copy=False)
    verification_state = fields.Selection(
        [("unverified", "Not verified"), ("ok", "Effective"), ("nok", "Not effective")],
        default="unverified",
        required=True,
        tracking=True,
        copy=False,
    )
    verification_comment = fields.Text()
    verification_date = fields.Datetime(readonly=True, copy=False)

    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    # ---------------------------------------------------------------- ORM
    @api.model_create_multi
    def create(self, vals_list):
        today = fields.Date.context_today(self)
        for vals in vals_list:
            finding = self.env["iso.finding"].browse(vals.get("finding_id"))
            if not finding.exists():
                raise ValidationError(self.env._("An action must belong to a finding."))
            finding._check_can_add_action()
            deadline = fields.Date.to_date(vals.get("date_deadline"))
            if deadline and deadline < today:
                raise ValidationError(self.env._("The deadline of an action cannot be in the past."))
        actions = super().create(vals_list)
        for a in actions:
            a.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=a.date_deadline,
                user_id=a.user_id.id,
                summary=self.env._("Action for %s", a.finding_id.name),
                note=a.name,
            )
            a.finding_id.sudo().message_post(body=self.env._("Action assigned to %s: %s", a.user_id.name, a.name))
        return actions

    def write(self, vals):
        if PROTECTED_FIELDS & set(vals) and not self.env.context.get("iso_transition") and not self._is_iso_admin():
            raise AccessError(self.env._("Workflow fields can only be changed through the workflow buttons."))
        return super().write(vals)

    # ---------------------------------------------------------------- workflow
    def action_execute(self, state, comment=None):
        """The responsible reports the outcome. A comment is mandatory (legacy rule)."""
        self.ensure_one()
        if state not in ("finished", "cancelled", "rejected"):
            raise UserError(self.env._("Invalid outcome."))
        if self.state != "pending":
            raise UserError(self.env._("This action was already reported."))
        if not (self._is_iso_admin() or self.env.user == self.user_id):
            raise AccessError(self.env._("Only the responsible can report this action."))
        comment = comment if comment is not None else self.implementation_comment
        if not (comment or "").strip():
            raise ValidationError(self.env._("The implementation report is required."))
        self.sudo().with_context(iso_transition=True).write(
            {"state": state, "implementation_comment": comment, "execution_date": fields.Datetime.now()}
        )
        self.sudo().activity_feedback(["mail.mail_activity_data_todo"])
        self.finding_id._after_action_executed()
        return True

    def action_finish(self):
        return self.action_execute("finished")

    def action_cancel_action(self):
        return self.action_execute("cancelled")

    def action_reject(self):
        return self.action_execute("rejected")

    def action_verify(self, ok, comment=None):
        """The finding owner verifies a finished action's effectiveness."""
        self.ensure_one()
        finding = self.finding_id
        if not (self._is_iso_admin() or self.env.user == finding.owner_id):
            raise AccessError(self.env._("Only the finding owner can verify actions."))
        if self.state != "finished" or self.verification_state != "unverified":
            raise UserError(self.env._("Only finished, unverified actions can be verified."))
        self.sudo().with_context(iso_transition=True).write(
            {
                "verification_state": "ok" if ok else "nok",
                "verification_comment": comment if comment is not None else self.verification_comment,
                "verification_date": fields.Datetime.now(),
            }
        )
        finding._after_action_verified()
        return True

    def action_verify_ok(self):
        return self.action_verify(True)

    def action_verify_nok(self):
        return self.action_verify(False)
