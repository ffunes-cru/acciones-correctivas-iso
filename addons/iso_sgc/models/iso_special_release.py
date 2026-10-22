from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from ..tools.approvals import SPECIAL_RELEASE_AREAS, special_release_status

PROTECTED_FIELDS = {"state", "creator_id", "posventa_confirmed", "posventa_confirmed_date"}
BUSINESS_FIELDS = {
    "company_id", "release_type", "date", "deviation_description", "client_impact", "posventa_user_id",
    "purchase_order_number", "code", "material_description", "vendor",
    "of_number", "machine_model", "client_dealer", "sales_note_number",
}


class IsoSpecialRelease(models.Model):
    """Special release (liberación especial): a deviation authorised by four areas, Posventa notified.

    draft -> pending_approval -> approved | rejected   (ported from SpecialReleaseDetails.tsx)
    """

    _name = "iso.special.release"
    _description = "ISO special release"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "id desc"
    _mail_post_access = "read"

    name = fields.Char("Number", readonly=True, copy=False, default="New")
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    release_type = fields.Selection(
        [("raw_material", "Raw material"), ("finished_product", "Finished product")], required=True
    )
    date = fields.Date(required=True, default=fields.Date.context_today)
    deviation_description = fields.Text(required=True)
    client_impact = fields.Text("Client impact / risks", required=True)
    creator_id = fields.Many2one("res.users", "Creator", required=True, default=lambda s: s.env.user, tracking=True)
    state = fields.Selection(
        [("draft", "Draft"), ("pending_approval", "Pending approval"), ("approved", "Approved"), ("rejected", "Rejected")],
        default="draft",
        required=True,
        tracking=True,
        copy=False,
        index=True,
        group_expand="_expand_states",
    )
    # raw material
    purchase_order_number = fields.Char()
    code = fields.Char()
    material_description = fields.Char()
    vendor = fields.Char()
    # finished product
    of_number = fields.Char("OF number")
    machine_model = fields.Char()
    client_dealer = fields.Char("Client / dealer")
    sales_note_number = fields.Char()

    approval_ids = fields.One2many("iso.special.release.approval", "release_id", "Approvals")
    posventa_user_id = fields.Many2one("res.users", "Posventa (notified)", tracking=True)
    posventa_confirmed = fields.Boolean(readonly=True, copy=False, tracking=True)
    posventa_confirmed_date = fields.Datetime(readonly=True, copy=False)
    linked_finding_ids = fields.One2many("iso.finding", "special_release_id", "Linked findings")
    can_confirm_posventa = fields.Boolean(compute="_compute_can_confirm_posventa")
    can_sign = fields.Boolean(compute="_compute_can_sign")

    @api.model
    def _expand_states(self, states, domain=None, order=None):
        always = ("draft", "pending_approval")
        return [k for k, _label in self._fields["state"].selection if k in always or k in states]

    def _my_pending_rows(self):
        self.ensure_one()
        return self.approval_ids.filtered(lambda a: a.can_evaluate and a.user_id == self.env.user)

    @api.depends_context("uid")
    @api.depends("state", "approval_ids.state", "approval_ids.user_id", "approval_ids.excluded")
    def _compute_can_sign(self):
        for r in self:
            r.can_sign = bool(r._my_pending_rows())

    def action_sign_approve(self):
        """One click for the approver: approve every area still pending that is assigned to the current user."""
        for r in self:
            rows = r._my_pending_rows()
            if not rows:
                raise UserError(self.env._("You have no pending signature on this release."))
            for a in rows:
                a.action_evaluate("approved")
        return True

    def action_sign_reject(self):
        """Rejecting needs a comment, so open the signature of the current user."""
        self.ensure_one()
        rows = self._my_pending_rows()
        if not rows:
            raise UserError(self.env._("You have no pending signature on this release."))
        return {
            "type": "ir.actions.act_window", "res_model": "iso.special.release.approval", "res_id": rows[0].id,
            "view_mode": "form", "target": "new",
        }

    next_step = fields.Char("What's next", compute="_compute_next_step")

    @api.depends("state", "posventa_confirmed", "posventa_user_id", "approval_ids.state", "approval_ids.excluded", "approval_ids.user_id")
    def _compute_next_step(self):
        for r in self:
            if r.state == "draft":
                r.next_step = self.env._("Pick an approver for each area and the Posventa person, add any actions, then send for approval.")
            elif r.state == "pending_approval":
                waiting = [
                    f"{a._area_label()} ({a.user_id.name})"
                    for a in r.approval_ids.filtered(lambda a: not a.excluded and a.state == "pending")
                ]
                if not r.posventa_confirmed:
                    waiting.append(self.env._("Posventa confirmation (%s)", r.posventa_user_id.name))
                r.next_step = self.env._("Waiting for: %s.", ", ".join(waiting))
            elif r.state == "approved":
                r.next_step = self.env._("Approved by all areas; Posventa confirmed.")
            else:
                r.next_step = self.env._("Rejected.")

    # ---------------------------------------------------------------- helpers
    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _is_creator_or_admin(self):
        self.ensure_one()
        return self._is_iso_admin() or self.env.user == self.creator_id

    @api.depends_context("uid")
    @api.depends("state", "posventa_user_id", "posventa_confirmed")
    def _compute_can_confirm_posventa(self):
        for r in self:
            r.can_confirm_posventa = (
                r.state == "pending_approval"
                and not r.posventa_confirmed
                and (r._is_iso_admin() or self.env.user == r.posventa_user_id)
            )

    def _transition(self, vals):
        return self.sudo().with_context(iso_transition=True).write(vals)

    # ---------------------------------------------------------------- ORM
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                vals["name"] = self.env["ir.sequence"].next_by_code("iso.special.release") or "New"
        releases = super().create(vals_list)
        for r in releases:
            existing = r.approval_ids.mapped("area")
            r.sudo().write(
                {"approval_ids": [(0, 0, {"area": a}) for a in SPECIAL_RELEASE_AREAS if a not in existing]}
            )
        return releases

    def write(self, vals):
        if not self.env.context.get("iso_transition") and not self._is_iso_admin():
            blocked = PROTECTED_FIELDS & set(vals)
            if blocked:
                raise AccessError(self.env._("Workflow fields can only be changed through the workflow buttons."))
            if BUSINESS_FIELDS & set(vals):
                for r in self:
                    if r.state != "draft" or not r._is_creator_or_admin():
                        raise AccessError(self.env._("Only the creator can edit a special release, and only in draft."))
        return super().write(vals)

    def unlink(self):
        # Legacy: deleting a release also deletes the findings/actions created for it (admin only).
        self.linked_finding_ids.sudo().unlink()
        return super().unlink()

    # ---------------------------------------------------------------- workflow
    def action_send_for_approval(self):
        for r in self:
            if r.state != "draft":
                raise UserError(self.env._("Only a draft can be sent for approval."))
            if not r._is_creator_or_admin():
                raise AccessError(self.env._("Only the creator can send this release for approval."))
            active = r.approval_ids.filtered(lambda a: not a.excluded)
            missing = active.filtered(lambda a: not a.user_id)
            if missing:
                raise ValidationError(
                    self.env._(
                        "Select the approvers for the active areas: %s.",
                        ", ".join(missing.mapped(lambda a: a._area_label())),
                    )
                )
            if not r.posventa_user_id:
                raise ValidationError(self.env._("Select who is notified in Posventa before sending."))
            r._transition({"state": "pending_approval"})
            today = fields.Date.context_today(r)
            partners = active.user_id.partner_id | r.posventa_user_id.partner_id
            r.sudo().message_subscribe(partner_ids=partners.ids)
            for a in active:
                r.sudo().activity_schedule(
                    "mail.mail_activity_data_todo",
                    date_deadline=today,
                    user_id=a.user_id.id,
                    summary=self.env._("Signature required (%s): %s", a._area_label(), r.name),
                )
            r.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=today,
                user_id=r.posventa_user_id.id,
                summary=self.env._("Confirm receipt: %s", r.name),
            )
        return True

    def action_confirm_posventa(self):
        for r in self:
            if r.state != "pending_approval" or r.posventa_confirmed:
                raise UserError(self.env._("Nothing to confirm."))
            if not (r._is_iso_admin() or self.env.user == r.posventa_user_id):
                raise AccessError(self.env._("You are not the designated Posventa person nor an administrator."))
            r._transition({"posventa_confirmed": True, "posventa_confirmed_date": fields.Datetime.now()})
            r.sudo().activity_feedback(
                ["mail.mail_activity_data_todo"], user_id=r.posventa_user_id.id
            )
            r._recompute_state()
        return True

    def _recompute_state(self):
        """Derive the state from the signatures (only once sent)."""
        for r in self:
            if r.state == "draft":
                continue
            new = special_release_status(
                [(a.state, a.excluded) for a in r.approval_ids], r.posventa_confirmed
            )
            if new != r.state:
                r._transition({"state": new})
                if new in ("approved", "rejected"):
                    r._notify_resolution(new)

    def _notify_resolution(self, state):
        self.ensure_one()
        label = self.env._("APPROVED") if state == "approved" else self.env._("REJECTED")
        recipients = (self.creator_id | self.approval_ids.user_id | self.posventa_user_id).partner_id
        self.sudo().message_post(
            body=self.env._(
                "Final resolution of special release %s: %s. The signature circuit is complete.", self.name, label
            ),
            partner_ids=recipients.ids,
            subtype_xmlid="mail.mt_comment",
        )

    def action_add_linked_action(self, description, user, deadline):
        """Create the background finding + action a release may spawn (draft only, creator/admin)."""
        self.ensure_one()
        if self.state != "draft" or not self._is_creator_or_admin():
            raise AccessError(self.env._("Linked actions can only be added by the creator while the release is in draft."))
        if not (description or "").strip():
            raise ValidationError(self.env._("The action description is required."))
        kind = self.env._("Raw material") if self.release_type == "raw_material" else self.env._("Finished product")
        finding = self.env["iso.finding"]._create_with_action(
            {
                "company_id": self.company_id.id,
                "finding_date": self.date,
                "origin": "Muro/ Control de Calidad",
                "type": "Producto no conforme",
                "process": "Otros",
                "description": self.env._(
                    "Action linked to special release %s: deviation of %s. Deviation detail: %s",
                    self.name, kind, self.deviation_description,
                ),
                "owner_id": self.creator_id.id,
                "analysis_user_id": self.creator_id.id,
                "analysis_deadline": self.date,
                "special_release_id": self.id,
            },
            description, user, deadline,
        )
        return finding
