from odoo import models
from odoo.exceptions import AccessError


class IsoWorkflowMixin(models.AbstractModel):
    """Helpers shared by every ISO workflow model.

    The convention of the whole module: *state-like fields are never written directly*. Workflow methods
    (`action_*`) validate who may act and in which state, then write through `_transition`, which marks the
    write as trusted (`iso_transition` context key) and runs it with elevated rights. `write()` overrides
    reject protected fields unless the write is trusted or comes from an administrator.
    """

    _name = "iso.workflow.mixin"
    _description = "ISO workflow helpers"

    def _is_iso_admin(self):
        """True for members of *ISO SGC / Administrator* (Odoo system administrators are members)."""
        return self.env.user.has_group("iso_sgc.group_iso_admin")

    def _transition(self, vals):
        """Write `vals` as the workflow does: trusted and with elevated rights (the caller already checked)."""
        return self.sudo().with_context(iso_transition=True).write(vals)

    def _check_protected(self, vals, protected):
        """Raise unless the write is trusted (workflow method) or done by an administrator."""
        if (
            set(protected) & set(vals)
            and not self.env.context.get("iso_transition")
            and not self._is_iso_admin()
        ):
            raise AccessError(self.env._("Workflow fields can only be changed through the workflow buttons."))
