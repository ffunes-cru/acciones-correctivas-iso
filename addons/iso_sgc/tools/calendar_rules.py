"""Pure rules of the ISO calendar (ported from NewISOCalendar.tsx / ISOCalendarDetails.tsx).

Task labels and generated names stay in Spanish on purpose: they are data users read and that the
migrated legacy tasks already carry.
"""

from datetime import date

AUDIT_QUARTERS = (("T1", 3, 15), ("T2", 6, 15), ("T3", 9, 15), ("T4", 12, 15))
MONTHS_ES = (
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
)

DEFAULT_AUDIT_CRITERIA = """Los criterios de auditoría utilizados como referencia son los requisitos establecidos en:
❖ La norma ISO 9001:2015;
❖ Los documentos del SGC.
❖ Los Requisitos Legales Reglamentarios aplicables para la actividad.
❖ Enmienda 1 ISO/ IAF publicada en Febrero de 2024."""


def audit_instances(year):
    """[(quarter, planned_date)] for the 4 quarterly audits of a process."""
    return [(q, date(year, m, d)) for q, m, d in AUDIT_QUARTERS]


def frequency_instances(frequency, year):
    """[(label, planned_date)] for a routine activity of the given frequency."""
    if frequency == "annual":
        return [("Instancia Anual", date(year, 11, 30))]
    if frequency == "semester":
        return [("Semestre 1", date(year, 6, 30)), ("Semestre 2", date(year, 12, 15))]
    if frequency == "quarterly":
        return [
            ("Trimestre 1", date(year, 3, 31)),
            ("Trimestre 2", date(year, 6, 30)),
            ("Trimestre 3", date(year, 9, 30)),
            ("Trimestre 4", date(year, 12, 15)),
        ]
    if frequency == "monthly":
        return [(MONTHS_ES[m - 1], date(year, m, 28)) for m in range(1, 13)]
    raise ValueError(f"Unknown frequency {frequency!r}")


def audit_task_name(process_name, quarter):
    """Name of an audit task, e.g. "Auditoría Interna: Producción - T2"."""
    return f"Auditoría Interna: {process_name} - {quarter}"


def routine_task_name(activity_name, label):
    """Name of a routine-activity task, e.g. "Realizar Evaluación de proveedores - Semestre 1"."""
    return f"{activity_name} - {label}"


def guess_is_audit(name, activity=None):
    """Legacy heuristic: an audit is any task whose (original) name contains 'auditor' (also matches 'auditoría')."""
    return "auditor" in (name or "").lower() or "auditor" in (activity or "").lower()


def conclusion_template(process_name):
    """Standard audit conclusion for a process, with [bracketed] placeholders the auditor must replace."""
    return (
        f"La auditoría realizada al proceso {process_name} del Sistema de Gestión de la Calidad de la organización, "
        "bajo los criterios de ISO 9001:2015 y requisitos legales aplicables, permitió verificar que los procesos "
        "auditados cumplen/no cumplen en gran medida con los criterios establecidos. Se identificaron [número] no "
        "conformidades menores relacionadas con [tema], que no comprometen la eficacia global del sistema pero "
        "requieren acciones correctivas. Asimismo, se observaron oportunidades de mejora en [áreas específicas], "
        "cuya implementación fortalecerá la capacidad del sistema para alcanzar los resultados previstos. En "
        "conclusión, el sistema es conforme y eficaz dentro del alcance auditado, sujeto a la corrección de las "
        "no conformidades detectadas."
    )


TEMPLATE_PLACEHOLDERS = ("[número]", "[tema]", "[áreas específicas]")


def has_template_placeholders(text):
    """True while the standard conclusion still contains its fill-in markers (it was not adapted)."""
    return any(p in (text or "") for p in TEMPLATE_PLACEHOLDERS)
