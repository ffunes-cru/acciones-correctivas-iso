from odoo.tests import TransactionCase, tagged

from odoo.addons.iso_sgc.tools.documentacion import ARCHIVO, generar


@tagged("post_install", "-at_install", "iso_sgc")
class TestDocumentacion(TransactionCase):
    def test_referencia_actualizada(self):
        """docs/referencia.md refleja los modelos, permisos y puntos de entrada actuales."""
        self.assertEqual(
            ARCHIVO.read_text(encoding="utf-8"),
            generar(self.env),
            "docs/referencia.md está desactualizado: regenerarlo como indica tools/documentacion.py y commitearlo.",
        )
