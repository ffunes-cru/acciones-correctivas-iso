from odoo import fields, models


class IsoAuditProcess(models.Model):
    """One of the processes audited every quarter (12 by default; data, editable by admins)."""

    _name = "iso.audit.process"
    _description = "ISO audit process"
    _order = "sequence, id"

    name = fields.Char(required=True, translate=False)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    objective = fields.Text()
    clauses = fields.Text(help="One clause per line; leading spaces are kept (sub-clauses).")
    deliverable_ids = fields.One2many("iso.audit.process.deliverable", "process_id", "Deliverables")


class IsoAuditProcessDeliverable(models.Model):
    _name = "iso.audit.process.deliverable"
    _description = "ISO audit process deliverable"
    _order = "sequence, id"

    process_id = fields.Many2one("iso.audit.process", required=True, ondelete="cascade")
    sequence = fields.Integer(default=10)
    name = fields.Char("Title", required=True)
    description = fields.Text()
    evidence = fields.Text(help="One piece of evidence per line.")


class IsoActivityTemplate(models.Model):
    """Routine SGC activity offered by default when creating a calendar (e.g. yearly supplier evaluation)."""

    _name = "iso.activity.template"
    _description = "ISO routine activity template"
    _order = "sequence, id"

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    frequency = fields.Selection(
        [("annual", "Annual"), ("semester", "Semester"), ("quarterly", "Quarterly"), ("monthly", "Monthly")],
        required=True,
        default="annual",
    )


class ResCompany(models.Model):
    _inherit = "res.company"

    iso_audit_scope = fields.Text(
        "ISO audit scope", help="Default scope text of the internal audit reports of this company."
    )
