# Recetas

Cambios habituales, paso a paso. Al terminar cualquiera: correr los tests, regenerar la
[referencia](referencia.md) (`./scripts/docs.sh`), actualizar traducciones si cambió un texto, y commitear todo junto.

## Cambios que no requieren programar (como administrador ISO)

- **Procesos de auditoría** (objetivo, cláusulas, entregables): ISO SGC → Configuración → Procesos de auditoría.
- **Actividades rutinarias que se ofrecen al crear la planificación:** Configuración → Actividades rutinarias.
- **Áreas y preguntas de las solicitudes de cambio:** Configuración → Áreas de solicitudes de cambio.
  Las solicitudes ya creadas **conservan su copia** de las preguntas; el cambio vale para las nuevas.
- **Alcance de auditoría por empresa:** Ajustes → Empresas → pestaña *ISO SGC*.

## Agregar un campo a un hallazgo (o a otro modelo)

1. Declararlo en el modelo (`models/iso_finding.py`) con `string="..."` en inglés.
2. Mostrarlo en la vista (`views/iso_finding_views.xml`); si debe ser de solo lectura en ciertos estados, usar `readonly="state != '...'"`.
3. Si es un campo de **estado** (no se debe editar a mano), agregarlo al conjunto `PROTECTED_FIELDS` del modelo.
4. Actualizar el módulo, traducir el texto nuevo, regenerar la referencia.
5. Agregar el test que ejerza la regla (ver `tests/test_finding_workflow.py`).

## Agregar una acción (botón) al flujo

1. Escribir el método `action_xxx` en el modelo: **primero** validar quién (`AccessError`) y en qué estado (`UserError`), **después** escribir con `self._transition({...})`.
2. Agregar el botón en la vista con `invisible=` para que solo lo vea quien corresponde. La validación real es la del método.
3. Si el cambio avisa a alguien, programar una actividad (`activity_schedule`) o publicar un mensaje (`message_post`); recordar `Markup` si lleva HTML y escapar siempre el texto del usuario.
4. Test con `with_user` para al menos: quien puede, quien no puede, y estado equivocado.
5. Documentar la regla en `docs/BEHAVIOR.md` y el diagrama en [flujos](flujos.md) si cambia un estado.

## Agregar un estado a un proceso

1. Agregarlo a la `Selection` del campo `state`.
2. Si es columna del tablero, incluirlo (o no) en `_expand_states`.
3. Revisar los `invisible`/`readonly` de las vistas y los filtros de búsqueda.
4. Actualizar el diagrama en [flujos](flujos.md) y los tests de transición.

## Agregar un área a las solicitudes de cambio

Alcanza con crearla en Configuración → Áreas de solicitudes de cambio y cargar sus preguntas: las **nuevas** solicitudes ya la incluyen.
(Si las áreas deben figurar en una vista fija, agregar el `code` en los tests de `test_change_request.py`.)

## Agregar una frecuencia a las actividades rutinarias

1. Agregar el valor a `FREQUENCIES` (`models/iso_calendar.py`).
2. Definir sus fechas en `tools/calendar_rules.py::frequency_instances` y su test en `tests/test_calendar_rules.py`.

## Cambiar un permiso

1. Modelo y grupo → `security/ir.model.access.csv`; filas → `security/iso_rules.xml`.
2. Si la regla de registro es más amplia que el permiso real de un campo, **agregar la validación en el modelo** (`write` o el método de acción).
3. Test con `with_user` que pruebe el caso permitido y el prohibido; ver `tests/test_security.py` y `tests/test_review_findings.py`.
4. Actualizar [seguridad](seguridad.md).
