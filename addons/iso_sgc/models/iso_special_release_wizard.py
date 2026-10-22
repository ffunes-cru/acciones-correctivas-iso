from odoo import fields, models


class IsoSpecialReleaseActionWizard(models.TransientModel):
    _name = "iso.special.release.action.wizard"
    _description = "Add an action to a special release"

    release_id = fields.Many2one("iso.special.release", required=True)
    description = fields.Text(required=True)
    user_id = fields.Many2one("res.users", "Responsible", required=True)
    date_deadline = fields.Date("Deadline", required=True)

    def action_confirm(self):
        self.ensure_one()
        self.release_id.action_add_linked_action(self.description, self.user_id, self.date_deadline)
        return {"type": "ir.actions.act_window_close"}
