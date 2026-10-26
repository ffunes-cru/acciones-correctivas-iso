# ISO SGC — guía para agentes de IA y desarrolladores

Antes de cambiar código, leer `addons/iso_sgc/README.md` y, en este orden: `docs/conceptos.md`, `docs/arquitectura.md`,
`docs/flujos.md`, `docs/seguridad.md` (todos en `addons/iso_sgc/docs/`). `docs/referencia.md` es generado.
Reglas de negocio ↔ tests: `docs/BEHAVIOR.md` (raíz del repositorio). Estado del proyecto: `docs/PLAN.md`.

## Qué es esto
Un módulo de Odoo 19 Community (`addons/iso_sgc`) que reemplaza la app React+Firebase de la raíz (`src/`, `server.ts`,
`api/`, `domain/`: **solo referencia**, se borran en el cierre). Sin JavaScript propio. Sin módulos OCA.

## Reglas al cambiar código
- **La regla de negocio va en el modelo**, nunca solo en una vista. Cada `action_*` valida quién y en qué estado.
- Los estados **no se escriben directo**: el método del flujo escribe con `self._transition({...})`; el `write()` del modelo
  usa `self._check_protected(vals, PROTECTED_FIELDS)` (ver `models/iso_abstract_workflow.py`).
- `sudo()` solo dentro de métodos que ya validaron al actor; nunca para "hacer que funcione".
- Mensajes con HTML: `Markup(...) % (...)`; el texto del usuario siempre se escapa (no concatenar f-strings con HTML).
- Textos visibles: `self.env._("texto en inglés")` directo (un alias como `t = self.env._` **no se extrae**). Después
  `scripts/i18n.sh pot && scripts/i18n.sh update`, traducir y correr los tests.
- Odoo 19: `models.Constraint` (no `_sql_constraints`), `group_ids`, `<list>`, `<chatter/>`, `res.groups.privilege`.
- Las reglas puras (sin base de datos) van en `tools/`; el archivo del mixin se llama `iso_abstract_*` para que cargue primero.
- Un campo o botón nuevo cambia la referencia: `scripts/docs.sh` y commitear `docs/referencia.md`.

## Al terminar
1. `./scripts/test-odoo.sh` (falla también por advertencias del módulo, de traducción y de documentación).
2. `ruff check --config ~/odoo_sv/odoo/ruff.toml addons/iso_sgc`.
3. Actualizar el documento que corresponda (`docs/` del módulo, `BEHAVIOR.md`) **en el mismo commit**.
4. Para cambios de interfaz, mirar el resultado real: `ISO_LANG=es_AR ./scripts/screens.sh ./capturas`.

## Trampas conocidas
- `pkill -f` con un patrón que aparece en tu propio comando mata tu shell.
- Odoo puede colgarse al cerrar después de los tests: los scripts hacen `kill -9` como respaldo.
- La opción de entero para quitar el separador de miles es `options="{'enable_formatting': false}"`.
- El puerto 8069 suele estar ocupado por el Odoo de desarrollo: los scripts eligen uno libre.
