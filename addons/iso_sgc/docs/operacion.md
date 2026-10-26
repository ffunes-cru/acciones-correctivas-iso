# Operación

## Instalar y actualizar

El módulo se agrega al `addons_path` del Odoo existente (en esta máquina, un enlace simbólico en
`~/odoo_sv/odoo/addons/iso_sgc`).

```bash
./odoo-bin -d <base> -i iso_sgc --stop-after-init      # primera vez
./odoo-bin -d <base> -u iso_sgc --stop-after-init      # después de cada cambio (y reiniciar el servidor)
```

Luego dar el grupo **ISO SGC / Usuario** a cada persona y **Administrador** a Calidad.
Las cinco empresas del grupo deben existir como `res.company` en la misma base; el aislamiento entre ellas es automático.

## Comandos frecuentes

| Qué | Comando |
|---|---|
| Correr todos los tests (base descartable, puerto libre, ~2 min) | `./scripts/test-odoo.sh` |
| Capturas de pantalla (Chrome headless; `ISO_LANG=es_AR` para español) | `./scripts/screens.sh ./capturas` |
| Actualizar traducciones | `./scripts/i18n.sh pot` y `./scripts/i18n.sh update` |
| Regenerar la referencia y el sitio Doxygen | `./scripts/docs.sh html` |
| Lint con la configuración de Odoo | `ruff check --config ~/odoo_sv/odoo/ruff.toml addons/iso_sgc` |

`ODOO_DIR` apunta al checkout de Odoo (por defecto `~/odoo_sv/odoo`). Los scripts usan bases descartables
(`iso_sgc_*_<pid>`) y las borran al terminar.

El script de tests **falla también por advertencias** del propio módulo (APIs obsoletas, errores de lint de vistas,
etiquetas duplicadas).

## Traducciones

Los textos se escriben en inglés y el español vive en `i18n/es_AR.po`. Al agregar o cambiar un texto:

1. `./scripts/i18n.sh pot` — regenera `iso_sgc.pot`.
2. `./scripts/i18n.sh update` — regenera `es_AR.po` conservando lo traducido; lo nuevo queda vacío.
3. Traducir las entradas vacías (vocabulario: *Hallazgo, Acción, Liberación especial, Solicitud de cambio, Planificación, Firma, Revisión sectorial*).
4. Correr los tests: `test_translation` falla si falta alguna entrada, si no coinciden los `%s`/HTML, o si el `.pot`/`.po` quedó viejo.

> Escribir siempre `self.env._("texto")`. Con un alias (`t = self.env._`) el extractor **no** ve los textos.

## Correo y notificaciones

- Las **actividades** (tareas en la agenda y en el reloj de Odoo) funcionan sin correo.
- Los **correos** (asignaciones, resoluciones, avisos) requieren un servidor saliente (`Ajustes → Técnico → Servidores de correo saliente`).
  Sin él, Odoo encola los correos y quedan sin enviar.
- Los **recordatorios de vencimiento** (30 días, 3 días, el día, vencida) están definidos y testeados en `tools/reminders.py`
  pero **todavía no hay tarea programada que los use** (pendiente M6).

## Documentación generada

`docs/referencia.md` se genera desde Odoo (`scripts/docs.sh`) y `test_documentacion` falla si quedó desactualizado.
El sitio HTML (`scripts/docs.sh html`, requiere `doxygen` y `graphviz`) queda en `docs/_doxygen/html/index.html`
(no se versiona).

## Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| "No tiene permiso para acceder a ISO …" | Falta el grupo *ISO SGC / Usuario*. |
| No veo una auditoría | Solo la ven administradores, su responsable y con quienes se compartió. |
| Un botón no aparece | Depende del estado y de quién eres; ver [flujos](flujos.md). |
| Falla el test de traducción | Hay textos nuevos sin traducir: ver [Traducciones](#traducciones). |
| Falla `test_referencia_actualizada` | Cambió un modelo, campo, permiso o botón: `./scripts/docs.sh` y commitear. |
| `Port 8069 is in use` al probar | Usar siempre `scripts/test-odoo.sh` (elige un puerto libre). |
| La actividad desapareció pero el ítem sigue pendiente | Alguien marcó "Hecho" la actividad a mano. El ítem sigue pendiente en su tablero; completarlo con el botón del flujo. |
