from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from ..tools.approvals import change_request_status_after_review

MISSIONS = [
    ("safety", "Safety and environment"),
    ("productivity", "Productivity"),
    ("quality", "Quality"),
    ("costs", "Costs"),
    ("other", "Other"),
]
DEFINITION_FIELDS = {
    "title", "company_id", "mission", "description", "objective", "current_situation", "proposed_situation",
    "impact_analysis", "review_deadline",
}
PROTECTED_FIELDS = {
    "state", "creator_id", "final_state", "final_date", "final_comments",
    "communication_sent", "communication_date", "communication_notes",
}


class IsoChangeArea(models.Model):
    """An area that reviews a change request, with its impact questionnaire (data, editable by admins)."""

    _name = "iso.change.area"
    _description = "ISO change request area"
    _order = "sequence, id"

    name = fields.Char(required=True)
    code = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    question_ids = fields.One2many("iso.change.question", "area_id", "Questions")


class IsoChangeQuestion(models.Model):
    _name = "iso.change.question"
    _description = "ISO change request question"
    _order = "sequence, id"

    area_id = fields.Many2one("iso.change.area", required=True, ondelete="cascade")
    sequence = fields.Integer(default=10)
    name = fields.Char("Question", required=True)
    active = fields.Boolean(default=True)


class IsoChangeRequest(models.Model):
    """Change request (solicitud de cambio): definition -> sector reviews -> final approval -> communication.

    draft -> pending_review -> pending_approval -> approved | rejected   (any area rejection -> rejected)
    """

    _name = "iso.change.request"
    _description = "ISO change request"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "id desc"
    _mail_post_access = "read"

    name = fields.Char("Number", readonly=True, copy=False, default="New")
    title = fields.Char(required=True, tracking=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda s: s.env.company, index=True)
    mission = fields.Selection(MISSIONS, required=True, default="quality")
    description = fields.Text("Proposal", required=True)
    objective = fields.Text(required=True)
    current_situation = fields.Text(required=True)
    proposed_situation = fields.Text(required=True)
    impact_analysis = fields.Text(required=True)
    creator_id = fields.Many2one("res.users", "Creator", required=True, default=lambda s: s.env.user, tracking=True)
    state = fields.Selection(
        [
            ("draft", "Draft"),
            ("pending_review", "Sector review"),
            ("pending_approval", "Final approval"),
            ("approved", "Approved"),
            ("rejected", "Rejected"),
        ],
        default="draft",
        required=True,
        tracking=True,
        copy=False,
        index=True,
        group_expand="_expand_states",
    )
    review_deadline = fields.Date("Review deadline")
    review_ids = fields.One2many("iso.change.review", "request_id", "Sector reviews")
    # stage 3
    final_approver_id = fields.Many2one("res.users", "Final approver", tracking=True)
    final_deadline = fields.Date("Final approval deadline")
    final_state = fields.Selection(
        [("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")], copy=False, tracking=True
    )
    final_comments = fields.Text(copy=False)
    final_date = fields.Datetime(copy=False)
    # stage 4
    communication_sent = fields.Boolean(copy=False)
    communication_date = fields.Datetime(copy=False)
    communication_notes = fields.Text(copy=False)
    linked_finding_ids = fields.One2many("iso.finding", "change_request_id", "Linked actions")
    can_edit_definition = fields.Boolean(compute="_compute_permissions")
    can_send_final = fields.Boolean(compute="_compute_permissions")
    can_decide_final = fields.Boolean(compute="_compute_permissions")
    can_review = fields.Boolean(compute="_compute_permissions")
    pending_review_count = fields.Integer(compute="_compute_pending_review_count")

    next_step = fields.Char("What's next", compute="_compute_next_step")

    @api.depends("state", "final_state", "final_approver_id", "review_ids.state", "review_ids.applies", "review_ids.user_id")
    def _compute_next_step(self):
        for r in self:
            t = self.env._
            if r.state == "draft":
                r.next_step = t("Complete the proposal, tick the areas that must review it, set the deadline and send it to review.")
            elif r.state == "pending_review":
                waiting = [
                    f"{v.area_id.name} ({v.user_id.name})" for v in r.review_ids.filtered(lambda v: v.applies and v.state == "pending")
                ]
                r.next_step = t("Waiting for the review of: %s.", ", ".join(waiting))
            elif r.state == "pending_approval":
                if r.final_state == "pending":
                    r.next_step = t("Waiting for the final decision of %s.", r.final_approver_id.name)
                else:
                    r.next_step = t("All reviews are approved. %s has to choose the final approver.", r.creator_id.name)
            elif r.state == "approved":
                r.next_step = t("Approved. The decision was communicated to everyone involved.")
            else:
                r.next_step = t("Rejected.")

    # ---------------------------------------------------------------- helpers
    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _is_creator_or_admin(self):
        self.ensure_one()
        return self._is_iso_admin() or self.env.user == self.creator_id

    def _transition(self, vals):
        return self.sudo().with_context(iso_transition=True).write(vals)

    @api.model
    def _expand_states(self, states, domain=None, order=None):
        always = ("draft", "pending_review", "pending_approval")
        return [k for k, _label in self._fields["state"].selection if k in always or k in states]

    def action_open_my_review(self):
        """One click for a reviewer: open the questionnaire assigned to the current user."""
        self.ensure_one()
        mine = self.review_ids.filtered("can_decide")
        if not mine:
            raise UserError(self.env._("You have no open review on this request."))
        return {
            "type": "ir.actions.act_window", "res_model": "iso.change.review", "res_id": mine[0].id,
            "view_mode": "form", "target": "current",
        }

    @api.depends_context("uid")
    @api.depends("state", "creator_id", "final_state", "final_approver_id", "review_ids.state", "review_ids.user_id",
                 "review_ids.applies")
    def _compute_permissions(self):
        for r in self:
            mine = r._is_iso_admin() or self.env.user == r.creator_id
            r.can_edit_definition = r.state == "draft" and mine
            r.can_send_final = r.state == "pending_approval" and r.final_state in (False, "pending") and mine
            r.can_decide_final = (
                r.state == "pending_approval" and r.final_state == "pending" and self.env.user == r.final_approver_id
            )
            r.can_review = any(v.can_decide for v in r.review_ids)

    @api.depends("review_ids.state", "review_ids.applies")
    def _compute_pending_review_count(self):
        for r in self:
            r.pending_review_count = len(r.review_ids.filtered(lambda v: v.applies and v.state == "pending"))

    # ---------------------------------------------------------------- ORM
    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                vals["name"] = self.env["ir.sequence"].next_by_code("iso.change.request") or "New"
        requests = super().create(vals_list)
        areas = self.env["iso.change.area"].search([])
        for r in requests:
            # Each request keeps its own copy of the questions (later edits of the template never change history).
            r.sudo().write(
                {
                    "review_ids": [
                        (
                            0, 0,
                            {
                                "area_id": a.id,
                                "line_ids": [(0, 0, {"sequence": q.sequence, "name": q.name}) for q in a.question_ids],
                            },
                        )
                        for a in areas
                    ]
                }
            )
        return requests

    def write(self, vals):
        if not self.env.context.get("iso_transition") and not self._is_iso_admin():
            if PROTECTED_FIELDS & set(vals):
                raise AccessError(self.env._("Workflow fields can only be changed through the workflow buttons."))
            if (DEFINITION_FIELDS | {"final_approver_id", "final_deadline"}) & set(vals):
                for r in self:
                    if not r._is_creator_or_admin():
                        raise AccessError(self.env._("Only the creator can edit this change request."))
                    if DEFINITION_FIELDS & set(vals) and r.state != "draft":
                        raise AccessError(self.env._("The definition can only be edited while the request is in draft."))
                    if {"final_approver_id", "final_deadline"} & set(vals) and not (
                        r.state == "pending_approval" and r.final_state in (False, "pending")
                    ):
                        raise AccessError(self.env._("The final approver can only be set at the final approval stage."))
        return super().write(vals)

    def unlink(self):
        self.linked_finding_ids.sudo().unlink()
        return super().unlink()

    # ---------------------------------------------------------------- stage 1 -> 2
    def action_send_to_review(self):
        for r in self:
            if r.state != "draft":
                raise UserError(self.env._("Only a draft can be sent to review."))
            if not r._is_creator_or_admin():
                raise AccessError(self.env._("Only the creator can send this request to review."))
            active = r.review_ids.filtered("applies")
            if not active:
                raise ValidationError(self.env._("Mark at least one area as applicable."))
            missing = active.filtered(lambda v: not v.user_id)
            if missing:
                raise ValidationError(
                    self.env._("Select the reviewer of: %s.", ", ".join(missing.mapped("area_id.name")))
                )
            if not r.review_deadline:
                raise ValidationError(self.env._("Set the review deadline."))
            for v in r.review_ids:
                if v.applies:
                    v._transition({"state": "pending", "date_deadline": r.review_deadline})
                else:
                    # Non-applicable areas are approved automatically (legacy).
                    v._transition({"state": "approved", "user_id": False, "date_deadline": False})
            r._transition({"state": "pending_review"})
            partners = active.user_id.partner_id
            r.sudo().message_subscribe(partner_ids=partners.ids)
            for v in active:
                r.sudo().activity_schedule(
                    "mail.mail_activity_data_todo",
                    date_deadline=r.review_deadline,
                    user_id=v.user_id.id,
                    summary=self.env._("Review %s for %s", v.area_id.name, r.name),
                )
        return True

    # ---------------------------------------------------------------- stage 2 -> 3
    def _after_review_decision(self):
        self.ensure_one()
        new = change_request_status_after_review(
            self.state, [(v.applies, v.state) for v in self.review_ids]
        )
        if new == self.state:
            return
        self._transition({"state": new})
        if new == "rejected":
            self.sudo().message_post(
                body=self.env._("Change request %s was REJECTED during the sector review.", self.name),
                partner_ids=self.creator_id.partner_id.ids,
                subtype_xmlid="mail.mt_comment",
            )
        elif new == "pending_approval":
            self.sudo().message_post(
                body=self.env._("All sector reviews are approved. Assign the final approver for %s.", self.name),
                partner_ids=self.creator_id.partner_id.ids,
                subtype_xmlid="mail.mt_comment",
            )
            self.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=fields.Date.context_today(self),
                user_id=self.creator_id.id,
                summary=self.env._("Assign the final approver of %s", self.name),
            )

    def action_send_to_final_approval(self):
        for r in self:
            if r.state != "pending_approval" or r.final_state not in (False, "pending"):
                raise UserError(self.env._("The request is not waiting for a final approver."))
            if not r._is_creator_or_admin():
                raise AccessError(self.env._("Only the creator can assign the final approver."))
            if not r.final_approver_id:
                raise ValidationError(self.env._("Select the final approver."))
            if not r.final_deadline:
                raise ValidationError(self.env._("Set the final approval deadline."))
            r.sudo().activity_unlink(["mail.mail_activity_data_todo"])
            r._transition({"final_state": "pending"})
            r.sudo().message_subscribe(partner_ids=r.final_approver_id.partner_id.ids)
            r.sudo().activity_schedule(
                "mail.mail_activity_data_todo",
                date_deadline=r.final_deadline,
                user_id=r.final_approver_id.id,
                summary=self.env._("Final approval of %s", r.name),
            )
        return True

    # ---------------------------------------------------------------- stage 3 -> 4
    def action_final_decision(self, approve, comments=None):
        self.ensure_one()
        if self.state != "pending_approval" or self.final_state != "pending":
            raise UserError(self.env._("This request is not waiting for the final decision."))
        if self.env.user != self.final_approver_id:
            raise AccessError(self.env._("Only the assigned final approver can decide."))
        comments = comments if comments is not None else self.final_comments
        self._transition(
            {
                "final_state": "approved" if approve else "rejected",
                "final_comments": comments,
                "final_date": fields.Datetime.now(),
                "state": "approved" if approve else "rejected",
            }
        )
        self.sudo().activity_feedback(["mail.mail_activity_data_todo"])
        # Stage 4: communicate the decision to everybody involved.
        involved = (self.creator_id | self.final_approver_id | self.review_ids.filtered("applies").user_id)
        label = self.env._("APPROVED") if approve else self.env._("REJECTED")
        self.sudo().message_post(
            body=self.env._(
                "Final decision on %s (%s): %s. Final approver: %s.<br/>Comments: %s",
                self.name, self.title, label, self.env.user.name, comments or self.env._("No comments."),
            ),
            partner_ids=involved.partner_id.ids,
            subtype_xmlid="mail.mt_comment",
        )
        self._transition(
            {
                "communication_sent": True,
                "communication_date": fields.Datetime.now(),
                "communication_notes": self.env._(
                    "Notification sent to %s people: %s", len(involved), ", ".join(involved.mapped("name"))
                ),
            }
        )
        return True

    def action_final_approve(self):
        return self.action_final_decision(True)

    def action_final_reject(self):
        return self.action_final_decision(False)


class IsoChangeReview(models.Model):
    _name = "iso.change.review"
    _description = "ISO change request sector review"
    _order = "request_id, area_id"

    request_id = fields.Many2one("iso.change.request", required=True, ondelete="cascade", index=True)
    area_id = fields.Many2one("iso.change.area", required=True)
    applies = fields.Boolean("Applicable", help="Does this area have to review the change?")
    user_id = fields.Many2one("res.users", "Reviewer")
    date_deadline = fields.Date("Deadline")
    state = fields.Selection(
        [("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")],
        default="pending",
        required=True,
        copy=False,
    )
    comments = fields.Text()
    action_date = fields.Datetime(readonly=True, copy=False)
    line_ids = fields.One2many("iso.change.review.line", "review_id", "Questionnaire")
    request_state = fields.Selection(related="request_id.state", string="Request status")
    can_decide = fields.Boolean(compute="_compute_can_decide")
    unanswered_count = fields.Integer(compute="_compute_progress")
    action_missing_count = fields.Integer(compute="_compute_progress")

    _sql_constraints = [("area_unique", "unique(request_id, area_id)", "One review per area.")]

    @api.depends("request_id.name", "area_id.name")
    def _compute_display_name(self):
        for v in self:
            v.display_name = f"{v.request_id.name} · {v.area_id.name}"

    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _transition(self, vals):
        return self.sudo().with_context(iso_transition=True).write(vals)

    @api.depends_context("uid")
    @api.depends("state", "applies", "user_id", "request_id.state")
    def _compute_can_decide(self):
        for v in self:
            v.can_decide = (
                v.request_id.state == "pending_review"
                and v.applies
                and v.state == "pending"
                and self.env.user == v.user_id
            )

    @api.depends("line_ids.applies", "line_ids.requires_action", "line_ids.finding_id")
    def _compute_progress(self):
        for v in self:
            v.unanswered_count = len(
                v.line_ids.filtered(lambda ln: not ln.applies or (ln.applies == "yes" and not ln.requires_action))
            )
            v.action_missing_count = len(
                v.line_ids.filtered(lambda ln: ln.applies == "yes" and ln.requires_action == "yes" and not ln.finding_id)
            )

    def write(self, vals):
        if not self.env.context.get("iso_transition") and not self._is_iso_admin():
            keys = set(vals)
            if {"state", "action_date", "area_id", "request_id", "date_deadline"} & keys:
                raise AccessError(self.env._("Reviews can only be changed through the workflow buttons."))
            if {"applies", "user_id"} & keys:
                for v in self:
                    if v.request_id.state != "draft" or not v.request_id._is_creator_or_admin():
                        raise AccessError(self.env._("Areas and reviewers can only be set by the creator, in draft."))
            if "comments" in keys:
                for v in self:
                    if self.env.user != v.user_id or v.request_id.state != "pending_review" or v.state != "pending":
                        raise AccessError(self.env._("Only the assigned reviewer can comment while the review is open."))
        elif self._is_iso_admin() and not self.env.context.get("iso_transition") and "user_id" in vals:
            # Admin escape hatch (not in the legacy app): reassign an absent reviewer of an open review.
            for v in self:
                if v.request_id.state not in ("draft", "pending_review") or (v.request_id.state != "draft" and v.state != "pending"):
                    raise UserError(self.env._("Only the reviewer of an open review can be reassigned."))
        old = {v.id: v.user_id for v in self}
        res = super().write(vals)
        if "user_id" in vals and not self.env.context.get("iso_transition"):
            for v in self.filtered(lambda r: r.request_id.state == "pending_review" and r.state == "pending"):
                if old[v.id] != v.user_id:
                    v.request_id.sudo().activity_unlink(["mail.mail_activity_data_todo"], user_id=old[v.id].id)
                    v.request_id.sudo().activity_schedule(
                        "mail.mail_activity_data_todo",
                        date_deadline=v.date_deadline,
                        user_id=v.user_id.id,
                        summary=self.env._("Review %s for %s", v.area_id.name, v.request_id.name),
                    )
        return res

    # ---------------------------------------------------------------- decisions
    def action_decide(self, approve, comments=None):
        self.ensure_one()
        req = self.request_id
        if req.state != "pending_review" or not self.applies or self.state != "pending":
            raise UserError(self.env._("This review is not open."))
        if self.env.user != self.user_id:
            raise AccessError(self.env._("Only the assigned reviewer can decide this review."))
        if approve:
            if any(not ln.applies for ln in self.line_ids):
                raise ValidationError(self.env._('Answer "Applies" for every question before approving.'))
            if any(ln.applies == "yes" and not ln.requires_action for ln in self.line_ids):
                raise ValidationError(self.env._('Answer "Requires action" for every applicable question before approving.'))
            if self.action_missing_count:
                raise ValidationError(
                    self.env._("Some questions require an action that has not been created yet. Create each one before approving.")
                )
        self._transition(
            {
                "state": "approved" if approve else "rejected",
                "comments": comments if comments is not None else self.comments,
                "action_date": fields.Datetime.now(),
            }
        )
        req.sudo().activity_feedback(["mail.mail_activity_data_todo"], user_id=self.user_id.id)
        req._after_review_decision()
        return True

    def action_approve(self):
        return self.action_decide(True)

    def action_reject(self):
        return self.action_decide(False)


class IsoChangeReviewLine(models.Model):
    _name = "iso.change.review.line"
    _description = "ISO change request questionnaire line"
    _order = "review_id, sequence, id"

    review_id = fields.Many2one("iso.change.review", required=True, ondelete="cascade", index=True)
    sequence = fields.Integer(default=10)
    name = fields.Char("Question", required=True)
    applies = fields.Selection([("yes", "Yes"), ("no", "No"), ("na", "N/A")], string="Applies")
    requires_action = fields.Selection([("yes", "Yes"), ("no", "No")], string="Requires action")
    finding_id = fields.Many2one("iso.finding", "Action", readonly=True, copy=False)
    can_link = fields.Boolean(compute="_compute_can_link")

    def _is_iso_admin(self):
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    @api.depends_context("uid")
    @api.depends("applies", "requires_action", "finding_id", "review_id.can_decide")
    def _compute_can_link(self):
        for ln in self:
            ln.can_link = bool(
                ln.id and ln.review_id.can_decide and ln.applies == "yes" and ln.requires_action == "yes" and not ln.finding_id
            )

    def write(self, vals):
        if not self.env.context.get("iso_transition") and not self._is_iso_admin():
            if {"name", "review_id", "sequence", "finding_id"} & set(vals):
                raise AccessError(self.env._("The questionnaire structure cannot be changed."))
            for ln in self:
                if not ln.review_id.can_decide:
                    raise AccessError(self.env._("Only the assigned reviewer can answer the questionnaire, while the review is open."))
                if ln.finding_id and {"applies", "requires_action"} & set(vals):
                    raise UserError(self.env._("Remove the linked action before changing this answer."))
        if "applies" in vals and vals["applies"] != "yes":
            vals = {**vals, "requires_action": False}
        return super().write(vals)

    def action_link_action(self, description, user, deadline):
        """The reviewer raises the action a question requires: a background finding + action."""
        self.ensure_one()
        review = self.review_id
        if not review.can_decide:
            raise AccessError(self.env._("Only the assigned reviewer can create actions, while the review is open."))
        if self.finding_id:
            raise UserError(self.env._("This question already has a linked action."))
        if not (self.applies == "yes" and self.requires_action == "yes"):
            raise UserError(self.env._('Only questions answered "Applies: Yes" and "Requires action: Yes" take an action.'))
        if not (description or "").strip():
            raise ValidationError(self.env._("The action description is required."))
        req = review.request_id
        finding = self.env["iso.finding"]._create_with_action(
            {
                "company_id": req.company_id.id,
                "finding_date": fields.Date.context_today(self),
                "origin": "Gestión de Cambios",
                "type": "Procedimiento / Documentación",
                "process": "Otros",
                "description": self.env._(
                    "Action linked to change request %s. Area: %s. Question: %s",
                    req.name, review.area_id.name, self.name,
                ),
                "owner_id": self.env.user.id,
                "analysis_user_id": self.env.user.id,
                "analysis_deadline": fields.Date.context_today(self),
                "change_request_id": req.id,
            },
            description, user, deadline,
        )
        self.sudo().with_context(iso_transition=True).write({"finding_id": finding.id})
        return finding

    def action_remove_action(self):
        """Creator or admin removes a linked action (deletes the background finding)."""
        for ln in self:
            req = ln.review_id.request_id
            if not req._is_creator_or_admin():
                raise AccessError(self.env._("Only the creator or an administrator can remove linked actions."))
            if ln.finding_id:
                finding = ln.finding_id
                ln.sudo().with_context(iso_transition=True).write({"finding_id": False})
                finding.sudo().unlink()
        return True


class IsoChangeLineActionWizard(models.TransientModel):
    _name = "iso.change.line.action.wizard"
    _description = "Create the action required by a change request question"

    line_id = fields.Many2one("iso.change.review.line", required=True)
    description = fields.Text(required=True)
    user_id = fields.Many2one("res.users", "Responsible", required=True)
    date_deadline = fields.Date("Deadline", required=True)

    def action_confirm(self):
        self.ensure_one()
        self.line_id.action_link_action(self.description, self.user_id, self.date_deadline)
        return {"type": "ir.actions.act_window_close"}
