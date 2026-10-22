{
    "name": "ISO SGC - Findings, actions and approvals",
    "summary": "ISO quality system: findings, corrective actions, special releases, "
    "change requests and audit calendar.",
    "version": "19.0.1.0.0",
    "category": "Quality",
    "author": "Franco Funes",
    "license": "Other proprietary",
    "depends": ["base", "mail"],
    "data": [
        "security/iso_security.xml",
        "security/ir.model.access.csv",
        "security/iso_rules.xml",
        "data/ir_sequence.xml",
        "data/iso_audit_data.xml",
        "views/iso_finding_views.xml",
        "views/iso_special_release_views.xml",
        "views/iso_calendar_views.xml",
        "views/iso_menus.xml",
    ],
    "installable": True,
    "application": True,
}
