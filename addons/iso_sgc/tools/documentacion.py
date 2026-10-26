"""Genera docs/referencia.md a partir del propio Odoo, para que no se desactualice.

Se arma con los metadatos del ORM (modelos, campos, relaciones), los registros de seguridad y los
archivos del módulo, no con análisis estático: así incluye vínculos que en Odoo no son llamadas de
Python (botones de vistas, acciones de menú).

Regenerar (y luego commitear docs/referencia.md):

    ./odoo-bin shell -d <base> --no-http <<< \\
        "from odoo.addons.iso_sgc.tools.documentacion import escribir; escribir(env)"

El test tests/test_documentacion.py falla si el archivo quedó desactualizado.
"""

import re
from pathlib import Path

from lxml import etree

MODULO = "iso_sgc"
RAIZ = Path(__file__).resolve().parent.parent
ARCHIVO = RAIZ / "docs" / "referencia.md"
RELACIONALES = ("many2one", "one2many", "many2many")
# campos que aporta mail.thread / mail.activity.mixin: ruido en la referencia
CAMPOS_MAIL = {
    "message_ids", "message_follower_ids", "message_partner_ids", "message_is_follower", "message_needaction",
    "message_needaction_counter", "message_has_error", "message_has_error_counter", "message_attachment_count",
    "message_has_sms_error", "website_message_ids", "activity_ids", "activity_state", "activity_user_id",
    "activity_type_id", "activity_type_icon", "activity_date_deadline", "my_activity_date_deadline",
    "activity_summary", "activity_exception_decoration", "activity_exception_icon", "has_message",
    "rating_ids",
}
CAMPOS_ORM = {"id", "display_name", "create_uid", "create_date", "write_uid", "write_date"}


def _modelos(env):
    """Los modelos del módulo (prefijo `iso.`), ordenados por nombre, sin los abstractos."""
    nombres = sorted(n for n in env.registry if n.startswith("iso.") and not env[n]._abstract)
    return [env[n] for n in nombres]


def generar(env):
    """Arma el texto completo de `docs/referencia.md` a partir del registro de Odoo."""
    todos = _modelos(env)
    persistentes = [m for m in todos if not m._transient]
    secciones = [
        "# Referencia generada del módulo ISO SGC",
        ("> Archivo generado por `tools/documentacion.py`: no editar a mano. "
        "Cómo regenerarlo: ver el encabezado de ese archivo."),
        "## Diagrama de datos",
        _diagrama(persistentes),
        "## Modelos y campos",
        *(_tabla_campos(m) for m in persistentes),
        "## Puntos de entrada",
        ("Métodos públicos (`action_*`, invocables por RPC o desde botones) y quién los usa. Los botones se buscan "
        "en `views/*.xml`; las llamadas de Python, por nombre en `models/`."),
        _puntos_de_entrada(todos),
        "## Permisos por modelo",
        "L = leer, E = escribir, C = crear, B = borrar. Sin fila: el grupo no accede al modelo.",
        _matriz_acceso(env),
        "## Reglas de registro",
        ("Filtran qué registros ve o modifica cada grupo. Las reglas de grupos distintos de un mismo usuario se "
        "suman (O lógico); las globales (multiempresa) se combinan con Y."),
        _reglas(env),
    ]
    return "\n\n".join(secciones) + "\n"


def escribir(env):
    """Escribe `docs/referencia.md` (se usa desde `scripts/docs.sh`)."""
    ARCHIVO.write_text(generar(env), encoding="utf-8")
    return ARCHIVO


# ----------------------------------------------------------------------------- secciones
def _diagrama(modelos):
    """Diagrama entidad-relación (Mermaid) con las relaciones many2one almacenadas."""
    ids = {m._name: m._name.replace(".", "_") for m in modelos}
    lineas = ["```mermaid", "erDiagram"]
    for m in modelos:
        for nombre, campo in sorted(m._fields.items()):
            if campo.type == "many2one" and campo.comodel_name in ids and campo.store and not campo.related:
                lineas.append(f"    {ids[campo.comodel_name]} ||--o{{ {ids[m._name]} : \"{nombre}\"")
    lineas.append("```")
    return "\n".join(lineas)


def _tabla_campos(modelo):
    """Tabla de campos de un modelo, sin los que aportan mail.thread y el ORM."""
    filas = [
        f"### `{modelo._name}`",
        f"{modelo._description}.",
        "",
        "| Campo | Tipo | Etiqueta | Notas |",
        "|---|---|---|---|",
    ]
    for nombre, campo in sorted(modelo._fields.items()):
        if nombre in CAMPOS_MAIL or nombre in CAMPOS_ORM or nombre.startswith("_"):
            continue
        tipo = campo.type + (f" → `{campo.comodel_name}`" if campo.type in RELACIONALES else "")
        notas = []
        if campo.required:
            notas.append("obligatorio")
        if campo.compute:
            notas.append("calculado" + (" y guardado" if campo.store else ""))
        if campo.related:
            notas.append(f"related `{campo.related}`")
        if campo.type == "selection" and isinstance(campo.selection, list):
            notas.append("valores: " + ", ".join(f"`{k}`" for k, _v in campo.selection))
        filas.append(f"| `{nombre}` | {tipo} | {campo.string} | {'; '.join(notas)} |")
    return "\n".join(filas)


def _texto_archivos(carpeta, patron):
    """Contenido de los archivos que coinciden con `patron` dentro de `carpeta`, por nombre."""
    return {p.name: p.read_text(encoding="utf-8") for p in sorted((RAIZ / carpeta).glob(patron))}


def _botones(env):
    """{(modelo_de_la_vista, método): {archivos}} con los botones `type="object"` de cada vista."""
    botones = {}
    for archivo in sorted((RAIZ / "views").glob("*.xml")):
        for registro in etree.parse(str(archivo)).iter("record"):
            if registro.get("model") != "ir.ui.view":
                continue
            modelo = registro.findtext("field[@name='model']")
            arch = registro.find("field[@name='arch']")
            if modelo is None or arch is None:
                continue
            for boton in arch.iter("button"):
                if boton.get("type") == "object" and boton.get("name"):
                    botones.setdefault((modelo, boton.get("name")), set()).add(archivo.name)
    return botones


def _modelos_relacionados(env, nombre_modelo):
    """El modelo y los modelos a los que apuntan sus campos relacionales (listas incrustadas en un formulario)."""
    modelo = env[nombre_modelo]
    return {nombre_modelo} | {c.comodel_name for c in modelo._fields.values() if c.type in RELACIONALES}


def _puntos_de_entrada(modelos):
    """Tabla de métodos `action_*` con los botones que los usan y los archivos que los llaman."""
    env = modelos[0].env
    botones = _botones(env)
    codigo = _texto_archivos("models", "*.py")
    filas = ["| Modelo | Método | Botones en vistas | Llamado desde |", "|---|---|---|---|"]
    for m in modelos:
        for nombre in sorted(n for n in _definidos_en(type(m)) if n.startswith("action_")):
            archivos = sorted(
                {f for (vista, metodo), fs in botones.items() if metodo == nombre
                 and m._name in _modelos_relacionados(env, vista) for f in fs},
            )
            llamadas = sorted(f for f, t in codigo.items() if re.search(rf"\.{nombre}\(|\"{nombre}\"", t))
            filas.append(f"| `{m._name}` | `{nombre}` | {', '.join(archivos) or '—'} | {', '.join(llamadas) or '—'} |")
    return "\n".join(filas)


def _definidos_en(clase):
    """Métodos definidos por el propio módulo (no heredados de mail, base...)."""
    return {n for c in clase.mro() if getattr(c, "__module__", "").startswith(f"odoo.addons.{MODULO}") for n in vars(c)}


def _matriz_acceso(env):
    """Matriz de permisos de acceso (`ir.model.access`) de los modelos del módulo."""
    accesos = env["ir.model.access"].sudo().search([("model_id.model", "=like", "iso.%")], order="model_id, group_id")
    filas = ["| Modelo | Grupo | L | E | C | B |", "|---|---|---|---|---|---|"]
    for a in accesos:
        permisos = [("x" if p else "") for p in (a.perm_read, a.perm_write, a.perm_create, a.perm_unlink)]
        grupo = a.group_id.display_name if a.group_id else "(todos)"
        filas.append(f"| `{a.model_id.model}` | {grupo} | " + " | ".join(permisos) + " |")
    return "\n".join(filas)


def _reglas(env):
    """Reglas de registro (`ir.rule`) de los modelos del módulo."""
    reglas = env["ir.rule"].sudo().search([("model_id.model", "=like", "iso.%")], order="model_id, name")
    filas = ["| Modelo | Regla | Grupos | Operaciones | Dominio |", "|---|---|---|---|---|"]
    for r in reglas:
        ops = "".join(
            letra for letra, activo in (("L", r.perm_read), ("E", r.perm_write), ("C", r.perm_create), ("B", r.perm_unlink))
            if activo
        )
        grupos = ", ".join(r.groups.mapped("display_name")) or "global"
        dominio = (r.domain_force or "").replace("|", "\\|")
        filas.append(f"| `{r.model_id.model}` | {r.name} | {grupos} | {ops} | `{dominio}` |")
    return "\n".join(filas)
