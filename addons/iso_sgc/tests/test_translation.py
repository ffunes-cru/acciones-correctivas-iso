"""The Spanish translation must stay complete: new strings in the code fail these tests until translated.

Workflow when you add or change a user-visible string:
    scripts/i18n.sh pot       # refresh i18n/iso_sgc.pot
    scripts/i18n.sh update    # refresh i18n/es_AR.po (new entries come out empty)
    ... translate the empty entries ...
"""

import io
import re
from datetime import timedelta
from pathlib import Path

import polib

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import TransactionCase, tagged
from odoo.tools.translate import trans_export

I18N = Path(__file__).resolve().parent.parent / "i18n"
# %s, %d, %(name)s and any HTML tag must survive translation untouched
KEEP = re.compile(r"%\(\w+\)[sd]|%[sd]|</?\w+[^>]*>")


@tagged("post_install", "-at_install", "iso_sgc")
class TestTranslation(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.po = polib.pofile(str(I18N / "es_AR.po"))
        cls.pot = polib.pofile(str(I18N / "iso_sgc.pot"))

    def test_every_string_is_translated(self):
        empty = [e.msgid for e in self.po if not e.msgstr.strip()]
        self.assertFalse(empty, f"{len(empty)} untranslated strings in es_AR.po, e.g. {empty[:3]}")

    def test_placeholders_and_markup_are_preserved(self):
        for e in self.po:
            self.assertEqual(sorted(KEEP.findall(e.msgid)), sorted(KEEP.findall(e.msgstr)),
                             f"placeholders differ in: {e.msgid!r}")

    def test_template_and_translation_match_the_code(self):
        buf = io.BytesIO()
        self.assertTrue(trans_export(False, ["iso_sgc"], buf, "po", self.env))
        in_code = {e.msgid for e in polib.pofile(buf.getvalue().decode())}
        self.assertEqual(in_code - {e.msgid for e in self.pot}, set(), "strings missing from iso_sgc.pot: run scripts/i18n.sh pot")
        self.assertEqual(in_code - {e.msgid for e in self.po}, set(), "strings missing from es_AR.po: run scripts/i18n.sh update")

    def test_spanish_is_what_the_user_sees(self):
        self.env["res.lang"]._activate_lang("es_AR")
        self.env["ir.module.module"]._load_module_terms(["iso_sgc"], ["es_AR"], overwrite=True)
        owner = self.env["res.users"].with_context(no_reset_password=True).create(
            {"name": "u", "login": "u", "email": "u@example.com", "lang": "es_AR",
             "group_ids": [(6, 0, self.env.ref("iso_sgc.group_iso_user").ids)]}
        )
        F = self.env["iso.finding"].with_user(owner).with_context(lang="es_AR")
        # selection labels
        labels = dict(F.fields_get(["state"])["state"]["selection"])
        self.assertEqual(labels["pending_analysis"], "Pendiente de análisis")
        self.assertEqual(labels["rejected"], "Rechazado")
        # computed guidance and error messages follow the user's language
        f = F.create({"origin": "x", "type": "t", "process": "p", "description": "d", "analysis_user_id": owner.id})
        self.assertIn("análisis de causa", f.next_step)
        with self.assertRaises(ValidationError) as cm:
            f.action_save_analysis()
        self.assertIn("resumen del análisis es obligatorio", str(cm.exception))
        # the same record in English
        self.assertIn("cause analysis", f.with_context(lang="en_US").next_step)
