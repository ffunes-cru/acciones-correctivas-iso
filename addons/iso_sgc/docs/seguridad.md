# Seguridad

El módulo vive en un Odoo **compartido con otras aplicaciones**: la autenticación es la de Odoo y todo acceso
pasa por los grupos de este módulo. Nada se puede hacer sin iniciar sesión.

## Grupos

| Grupo | Para quién | Notas |
|---|---|---|
| **ISO SGC / Usuario** (`group_iso_user`) | Cualquier persona que participe | Implica *Usuario interno* de Odoo. Sin este grupo no se ve el menú ni se accede a los modelos. |
| **ISO SGC / Administrador** (`group_iso_admin`) | Calidad / quien administra el SGC | Implica *Usuario*. Los **administradores de Odoo** (`base.group_system`) lo reciben automáticamente. |

## Cuatro capas, de afuera hacia adentro

1. **Menú por grupo:** el menú raíz es visible solo para `group_iso_user`; *Configuración* y *Crear planificación*, solo para administradores.
2. **Permisos de acceso** (`security/ir.model.access.csv`): qué modelos puede leer/escribir/crear/borrar cada grupo. Ver la [matriz generada](referencia.md#permisos-por-modelo).
3. **Reglas de registro** (`security/iso_rules.xml`): *qué registros*. Resumen:

   | Regla | Efecto |
   |---|---|
   | Multiempresa (global) | Cada usuario ve solo registros de sus empresas permitidas. |
   | Hallazgo: escribe el dueño o el responsable del análisis | Quien solo es responsable de una *acción* **no** edita el hallazgo. Borrar: solo el dueño. |
   | Acción: escribe el responsable, el dueño o el analista | Y además el método limita *qué campos* (ver capa 4). |
   | Tareas de auditoría: solo el administrador, su responsable y los usuarios con quienes se compartió | Las demás tareas las ven todos. |
   | Liberación / solicitud: escribe su creador | Las transiciones las hacen los métodos del flujo. |
   | Revisión y cuestionario: escribe el revisor (o el creador, en borrador) | |
4. **Validación en el modelo** (la más importante): cada método `action_*` comprueba grupo, pertenencia y estado,
   y el `write()` de cada modelo rechaza cambios directos a campos de estado de quien no es administrador
   (`_check_protected`). Una llamada RPC a mano no se salta nada.

## Quién puede qué (resumen)

| Proceso | Acción | Quién |
|---|---|---|
| Hallazgo | Guardar análisis | Dueño, responsable del análisis, admin |
| Hallazgo | Agregar acciones | Responsable del análisis (mejora: dueño), admin |
| Acción | Finalizar / cancelar / rechazar | Su responsable, admin |
| Acción | Cambiar descripción, responsable o fecha | Quien planifica (analista; dueño si es mejora), admin |
| Acción | Verificar eficacia | Dueño del hallazgo, admin |
| Liberación | Editar / enviar | Creador (solo en borrador), admin |
| Liberación | Firmar | Aprobador asignado, admin; **Posventa confirma**: la persona designada, admin |
| Cambio | Editar definición / enviar a revisión | Creador (borrador), admin |
| Cambio | Responder y decidir una revisión | **Solo** el revisor asignado; un admin puede reasignarlo |
| Cambio | Decisión final | **Solo** el aprobador final asignado |
| Planificación | Crear, editar, borrar | Solo administradores |
| Tarea | Iniciar, finalizar, comentar | Su responsable, admin |
| Tarea | Re-planificar (responsable, fecha) | Solo administradores, y no si ya está finalizada |

## Diagnosticar un "no tiene permiso"

1. ¿El usuario tiene el grupo *ISO SGC / Usuario*? (Ajustes → Usuarios).
2. ¿El registro es de una empresa que el usuario tiene habilitada (selector de empresas, arriba a la derecha)?
3. ¿Es una auditoría? Solo la ven el administrador, su responsable y con quienes se compartió.
4. ¿El mensaje habla de "botones del flujo"? Se intentó cambiar un estado a mano: usar el botón correspondiente.
5. Para ver qué regla aplica: [Referencia → Reglas de registro](referencia.md#reglas-de-registro).

## Lo que **no** hace el módulo

- No cifra datos ni archivos adjuntos más allá de lo que hace Odoo.
- Los correos salientes dependen de la configuración de correo de Odoo; las actividades no.
- Los hallazgos son legibles por cualquier usuario del grupo en su empresa (como en la aplicación anterior);
  solo las auditorías tienen visibilidad restringida.
