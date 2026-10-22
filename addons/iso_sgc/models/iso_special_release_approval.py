from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

PROTECTED_FIELDS = {"state", "action_date", "area", "release_id"}
AREAS = [
    ("calidad", "Quality"),
    ("ingenieria", "Engineering"),
    ("comercial", "Commercial"),
    ("operaciones", "Operations"),
]


class IsoSpecialReleaseApproval(models.Model):
    _name = "iso.special.release.approval"
    _description = "ISO special release signature"
    _order = "release_id, id"

    release_id = fields.Many2one("iso.special.release", required=True, ondelete="cascade", index=True)
    area = fields.Selection(AREAS, required=True)
    user_id = fields.Many2one("res.users", "Approver")
    excluded = fields.Boolean(help="Area not involved in this release (not allowed for Commercial).")
    state = fields.Selection(
        [("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")],
        default="pending",
        required=True,
        copy=False,
    )
    comments = fields.Text()
    action_date = fields.Datetime(readonly=True, copy=False)
    release_state = fields.Selection(related="release_id.state", string="Release status")
    can_evaluate = fields.Boolean(compute="_compute_can_evaluate")

    _sql_constraints = [("area_unique", "unique(release_id, area)", "Each area signs only once per release.")]

    @api.depends("release_id.name", "area")
    def _compute_display_name(self):
        for a in self:
            a.display_name = f"{a.release_id.name} · {a._area_label()}"

    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _area_label(self):
        return dict(AREAS).get(self.area, self.area)

    @api.constrains("area", "excluded")
    def _check_commercial_not_excluded(self):
        for a in self:
            if a.area == "comercial" and a.excluded:
                raise ValidationError(self.env._("The Commercial area cannot be excluded."))

    @api.depends_context("uid")
    @api.depends("state", "excluded", "user_id", "release_id.state")
    def _compute_can_evaluate(self):
        for a in self:
            a.can_evaluate = (
                a.release_id.state == "pending_approval"
                and a.state == "pending"
                and not a.excluded
                and (self._is_iso_admin() or self.env.user == a.user_id)
            )

    # ---------------------------------------------------------------- ORM
    def write(self, vals):
        if not self.env.context.get("iso_transition") and not self._is_iso_admin():
            if PROTECTED_FIELDS & set(vals):
                raise AccessError(self.env._("Signatures can only be changed through the workflow buttons."))
            if {"user_id", "excluded"} & set(vals):
                for a in self:
                    if a.release_id.state != "draft" or not a.release_id._is_creator_or_admin():
                        raise AccessError(self.env._("Approvers can only be changed by the creator, in draft."))
        res = super().write(vals)
        if "excluded" in vals:
            # Legacy: toggling exclusion resets the signature and clears the approver when excluding.
            for a in self:
                reset = {"state": "pending", "comments": False, "action_date": False}
                if a.excluded:
                    reset["user_id"] = False
                a.sudo().with_context(iso_transition=True).write(reset)
        return res

    # ---------------------------------------------------------------- workflow
    def action_evaluate(self, status, comments=None):
        self.ensure_one()
        release = self.release_id
        if status not in ("approved", "rejected"):
            raise UserError(self.env._("Invalid evaluation."))
        if release.state != "pending_approval" or self.excluded or self.state != "pending":
            raise UserError(self.env._("This signature cannot be evaluated now."))
        if not (self._is_iso_admin() or self.env.user == self.user_id):
            raise AccessError(self.env._("You are not the assigned approver for this area, nor an administrator."))
        comments = comments if comments is not None else self.comments
        if status == "rejected" and not (comments or "").strip():
            raise ValidationError(self.env._("Comments are required when rejecting."))
        self.sudo().with_context(iso_transition=True).write(
            {"state": status, "comments": comments, "action_date": fields.Datetime.now()}
        )
        release.sudo().activity_feedback(["mail.mail_activity_data_todo"], user_id=self.user_id.id)
        release._recompute_state()
        return True

    def action_approve(self):
        return self.action_evaluate("approved")

    def action_reject(self):
        return self.action_evaluate("rejected")

    def action_admin_set(self, status, comments=None):
        """Administrators may amend any signature once the release left draft (legacy handleAdminEditApproval)."""
        self.ensure_one()
        if not self._is_iso_admin():
            raise AccessError(self.env._("Only administrators can amend a signature."))
        if self.release_id.state == "draft":
            raise UserError(self.env._("Use the approver fields while the release is in draft."))
        if status not in ("pending", "approved", "rejected"):
            raise UserError(self.env._("Invalid status."))
        comments = comments if comments is not None else self.comments
        if status == "rejected" and not (comments or "").strip():
            raise ValidationError(self.env._("Comments are required when rejecting."))
        self.sudo().with_context(iso_transition=True).write(
            {"state": status, "comments": comments, "action_date": False if status == "pending" else fields.Datetime.now()}
        )
        self.release_id._recompute_state()
        return True

    def action_admin_approve(self):
        return self.action_admin_set("approved")

    def action_admin_reject(self):
        return self.action_admin_set("rejected")

    def action_admin_reset(self):
        return self.action_admin_set("pending")
