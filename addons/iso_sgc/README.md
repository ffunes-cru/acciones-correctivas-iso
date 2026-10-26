# ISO SGC

Módulo de Odoo 19 (Community) para gestionar el **Sistema de Gestión de la Calidad (ISO 9001)**: hallazgos y
acciones correctivas, liberaciones especiales, solicitudes de cambio y la planificación anual de auditorías
y tareas del SGC.

Reemplaza a la aplicación anterior (React + Firebase + Vercel, de un solo desarrollador), que hoy es solo
referencia en la raíz del repositorio. Se mantiene **una sola plataforma** (Odoo) en lugar de un stack por aplicación.

## Alcance

| Proceso | Qué resuelve | Quién interviene |
|---|---|---|
| **Hallazgos y acciones** | Registrar una no conformidad o mejora, analizar la causa, asignar acciones, verificar su eficacia y cerrar. | Dueño, responsable del análisis, responsables de acciones |
| **Liberaciones especiales** | Autorizar un desvío de materia prima o producto terminado con la firma de 4 áreas (Calidad, Ingeniería, Comercial, Operaciones) y la confirmación de Posventa. | Creador, aprobadores, Posventa |
| **Solicitudes de cambio** | Evaluar un cambio con cuestionarios de 8 áreas, generar las acciones que surjan, y cerrar con una aprobación final comunicada a todos. | Creador, revisores sectoriales, aprobador final |
| **Planificación anual** | Generar las 48 auditorías internas (12 procesos × 4 trimestres) y las actividades rutinarias del año; ejecutarlas, levantar hallazgos desde las auditorías y compartir informes. | Administradores, auditores/responsables |
| **Mi agenda** | Una sola lista/calendario con todo lo que espera a cada persona, con fecha límite. | Todos |

**Fuera de alcance (todavía):** informes PDF y envío por correo, espejo a Google Sheets, recordatorios de
vencimiento por correo y la migración de datos desde Firebase. Ver [estado y pendientes](#estado).

## Documentación

Leer en este orden. Los diagramas son [Mermaid](https://mermaid.js.org/).

| Documento | Para qué |
|---|---|
| [Conceptos](docs/conceptos.md) | El negocio en palabras simples y el glosario. Empezar acá. |
| [Conceptos de Odoo](docs/odoo.md) | Las piezas de Odoo que usa el módulo, con ejemplos del propio código. |
| [Arquitectura](docs/arquitectura.md) | Cómo está armado, qué hace cada archivo y las decisiones de diseño. |
| [Flujos](docs/flujos.md) | Estados de cada proceso y qué acción los cambia. |
| [Seguridad](docs/seguridad.md) | Quién ve y hace qué, y cómo se garantiza. |
| [Operación](docs/operacion.md) | Instalación, tests, traducciones, capturas, documentación y problemas comunes. |
| [Recetas](docs/recetas.md) | Paso a paso para los cambios más habituales. |
| [Referencia](docs/referencia.md) | **Generada** desde Odoo: modelos, campos, permisos y puntos de entrada. |
| Sitio Doxygen | **Generado** con `scripts/docs.sh html`: estos documentos y el código con buscador y grafos de llamadas. |

Documentos de ingeniería del proyecto (en inglés, en `docs/` de la raíz del repositorio): `PLAN.md`,
`BEHAVIOR.md` (reglas de negocio ↔ tests), `CALENDAR.md`, `UI.md`, `REVIEW.md` y `MAINTAINABILITY.md`.

## Inicio rápido

```bash
# Instalar o actualizar en una base existente (agregar este addons al addons_path)
./odoo-bin -d <base> -i iso_sgc --stop-after-init      # primera vez
./odoo-bin -d <base> -u iso_sgc --stop-after-init      # después de cada cambio

# Tests (base descartable, puerto libre; ~2 min)
./scripts/test-odoo.sh

# Capturas de pantalla de las pantallas principales, en inglés o español
ISO_LANG=es_AR ./scripts/screens.sh ./capturas

# Traducciones y documentación generada
./scripts/i18n.sh pot && ./scripts/i18n.sh update
./scripts/docs.sh html
```

Permisos: dar a cada usuario el grupo **ISO SGC / Usuario** (o **Administrador**). Los administradores de Odoo
son administradores ISO automáticamente.

## Estado

| Módulo funcional | Estado |
|---|---|
| M1 Hallazgos y acciones | Hecho |
| M2 Liberaciones especiales | Hecho |
| M3 Solicitudes de cambio | Hecho |
| M4 Planificación anual y auditorías | Hecho |
| UI (agenda, tableros, calendarios, botones de un clic) | Hecho, sin JavaScript propio |
| Traducción al español (es_AR) | Hecha, con tests |
| M5 Informes PDF (QWeb), correo del informe, espejo a Google Sheets | Pendiente |
| M6 Recordatorios de vencimiento por correo (cron) | Pendiente (la regla está en `tools/reminders.py`, con tests) |
| M7 Migración desde Firebase | Pendiente |
| M8 Puesta en marcha y baja del sistema anterior | Pendiente |

Los correos salientes requieren un servidor de correo configurado en Odoo (`ir.mail_server`); las actividades
(tareas pendientes dentro de Odoo) funcionan sin él.

## Licencia

Propietaria, solo uso interno. Ver `LICENSE` en la raíz del repositorio.
