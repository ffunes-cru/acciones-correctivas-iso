# Conceptos de Odoo que usa el módulo

Para quien conoce el negocio pero no Odoo. Cada concepto tiene un ejemplo del propio código.
Documentación oficial: <https://www.odoo.com/documentation/19.0/>.

## Modelo y registro (ORM)
Un **modelo** (`iso.finding`) es una tabla; un **registro** es una fila. Se define como clase Python
(`models/iso_finding.py`); Odoo crea la tabla y los métodos de acceso. Los métodos que empiezan con `_` son
privados; `action_*` son los que llaman los botones.

## Campos calculados y `store`
`pending_user_ids` se **calcula** (`@api.depends`) a partir de las acciones. Con `store=True` se guarda en la base
y se recalcula solo cuando cambian sus dependencias, así se puede buscar y filtrar ("Pendientes de mí").
Sin `store`, como `next_step`, se calcula al leer.

## Mixins: `mail.thread` y `mail.activity.mixin`
- `mail.thread` da el **chatter** (mensajes, seguidores, historial de cambios con `tracking=True`).
- `mail.activity.mixin` da las **actividades** (`activity_schedule`, `activity_feedback`): tareas con fecha límite.
  *Mi agenda* es una vista estándar sobre ellas.
- Propio: `iso.workflow.mixin` (`models/iso_abstract_workflow.py`) con los ayudantes del flujo.

## Grupos, permisos y reglas de registro
- **Grupo:** conjunto de usuarios (`ISO SGC / Usuario`).
- **Permiso de acceso (ACL):** qué puede hacer un grupo con un *modelo* (leer/escribir/crear/borrar).
- **Regla de registro:** qué *filas* alcanza ese permiso (`[('owner_id', '=', user.id)]`). Varias reglas de grupo se suman;
  las *globales* (multiempresa) se aplican siempre. Ver [seguridad](seguridad.md).

## `with_user` y `sudo`
`record.with_user(u)` ejecuta como `u` (así los tests prueban permisos). `record.sudo()` ejecuta sin permisos:
el módulo lo usa **solo dentro de métodos que ya validaron** quién actúa (`_transition`, programar actividades).

## Asistentes (`TransientModel`)
Formularios temporales (`iso.calendar.wizard`, `iso.special.release.action.wizard`) que piden datos y ejecutan una acción
al confirmar; no dejan registros permanentes.

## Secuencias
`ir.sequence` genera `H-0001`, `M-0001`, `LE-0001`, `SC-0001`. Son compartidas entre empresas (un solo contador).

## Datos y `noupdate`
Los archivos de `data/` con `noupdate="1"` se cargan al instalar y **no** se pisan al actualizar: los administradores
pueden editarlos desde la interfaz (procesos de auditoría, preguntas, plantillas) sin que una actualización los revierta.

## Vistas
`form` (formulario), `list` (lista), `kanban` (tablero por estado), `calendar`, `pivot`/`graph` (reportes), `search`
(filtros). Los botones (`<button type="object" name="action_x">`) llaman métodos del modelo. `invisible=`/`readonly=`
con expresiones hacen que cada persona vea solo los botones que le corresponden; **la validación real está en el modelo**.

## Traducciones
El código está en inglés y el español sale de `i18n/es_AR.po`. Los textos deben escribirse con `self.env._("...")`
(no con alias) para que Odoo los extraiga. Ver [operación](operacion.md#traducciones).

## `group_expand`
Hace que el tablero kanban muestre las columnas en el orden del flujo, aunque estén vacías
(`_expand_states` en cada modelo).
