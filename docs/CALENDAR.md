# ISO calendar (M4): what the legacy code really does, and the Odoo design

Read from `ISOCalendarDetails.tsx` (3,392 lines), `NewISOCalendar.tsx` (993), `ISODashboard.tsx` (824),
`auditProcessDetails.ts` (628), `auditReportPDF.ts` (327), `auditTemplatePDF.ts` (361).
Total ≈ 6,500 lines, but the real *logic* is small; most of it is UI state, string heuristics and content.

## 1. Where the 3,392 lines go (estimate from reading)
| Part | Lines | Nature |
|---|---|---|
| Name-matching flags (`isCalidad`, `isProduccion`, `isAuditTask`… 14 of them) | ~320 | **Heuristics** guessing the audit process from the task *name* |
| Handlers (status save, confirm finding, admin edit, add/delete task, mail report, migrate risks) | ~900 | Real rules + Firestore plumbing + hard-coded mails |
| JSX (list, task modal, audit form, admin modals, email modal) | ~2,100 | UI → replaced by Odoo views |

## 2. Domain model
- **Calendar**: year, company, name, description, created by.
- **Task** (one per planned occurrence): name, `originalTaskName` (the activity), frequency, `instanceLabel`
  (T1…T4 / Semestre 1 / Enero / "Ad-hoc"), responsible, deadline, status, comments, completion date, `sharedEmails`.
  Audit tasks add: audited personnel, scope, criteria, strengths and three lists (improvement opportunities,
  minor NCs, major NCs). `auditReportLink` is always written as `''` (dead field, drop).
- Status values are inconsistent in the data: `No iniciado/No iniciada`, `En proceso`, `Finalizado/Finalizada` → normalise to 3 states.
- "Is this an audit?" = name or original name contains "auditor". "Which process?" = keyword match on the name.
  Both become **explicit fields** (`is_audit`, `audit_process_id`).

## 3. Rules to port
**Creation (wizard, `NewISOCalendar`)**
1. Defaults: year = next year; calendar named `Planificación ISO <company> <year>`.
2. **Audits:** 12 fixed processes × 4 quarters = 48 tasks "Auditoría Interna: <process> - T1…T4", dates 15 Mar/Jun/Sep/Dec; each quarter can be removed or re-added; every remaining quarter needs an auditor ("apply one auditor to all" shortcut).
3. **Routine activities** (10 defaults: context analysis, 7 risk-register reviews, supplier evaluation, customer survey; plus custom): frequency → instances: Anual = 30 Nov; Semestral = 30 Jun, 15 Dec; Trimestral = 31 Mar, 30 Jun, 30 Sep, 15 Dec; Mensual = the 28th of each month. Every activity needs a responsible. Changing the frequency regenerates its dates; each date is editable.
4. On save: tasks created, **one mail per responsible** listing their tasks, plus a summary mail to the admin.

**Execution (task modal)**
5. Only the task's responsible or an admin updates it (shared users read only; the Firestore rule was looser than the UI, we follow the UI).
6. To mark *Finalizado*: a comment/conclusion is required; for audits also *audited personnel*. Completion date = the real execution date entered (default today); leaving *Finalizado* clears it.
7. **A finished audit is locked for non-admins** (inline and modal). Finished non-audit tasks stay editable by their responsible (as legacy).
8. Admin edit of responsible/deadline is **not allowed once finished**; reassigning notifies the new responsible.
9. When a responsible finishes a task, the admin is notified (legacy: hard-coded address → Odoo: followers of the *ISO administrators* group).
10. **Visibility of audit tasks:** only admin, the responsible and shared users (legacy enforced it in the UI list and, partly, in rules). Odoo: a read record rule.

**Findings raised from an audit (`handleConfirmFinding`)** — each item needs text, responsible, deadline; NCs also need the originating process.
11. *Opportunity* → **improvement finding** already in `pending_action` (analysis skipped), origin "Auditoría Interna", type/process "Mejora", owner = the confirming user, with one action (text, responsible, deadline). Uses the **improvement** number series.
12. *Minor / major NC* → **corrective finding** in `pending_analysis`, origin "Auditoría Interna", type "No conformidad menor/mayor", process = entered process, owner = confirming user, analyst = responsible, analysis deadline = deadline. Corrective series.
13. The item is then marked confirmed and keeps the link to the finding; mails go to the owner and the assignee.
14. Company of the finding = calendar company (legacy guessed "Fertec" if the calendar *name* contained it, else TMC).

**Reports / sharing**
15. Audit report PDF (header, process, year, execution date, auditor, audited personnel, status, scope, criteria, strengths, opportunities, minor NCs, major NCs, conclusion) and a pre-audit **template/checklist PDF** built from the process definition. Both kept (D4).
16. "Send report": PDF attached, to chosen users and/or typed emails; recipients are **added to `sharedEmails`** (this grants access to that audit task).
17. Defaults when opening an audit: conclusion text per process, scope text (company/calendar), criteria text (ISO 9001:2015 etc.).

**Admin-only:** rename calendar, add ad-hoc task (label "Ad-hoc"; counts as an audit if the name says "auditoría"), delete task, delete calendar (cascades). `handleMigrateRiesgos` is a one-off data fix → **not ported**.

**Dashboard:** calendars by year with completed/overdue counts, "my tasks" across calendars, overdue highlighting; deadlines also feed the reminder milestones (`tools/reminders.py`).

## 4. Odoo design
Models:
- `iso.calendar` (year, company_id, name, description, task_ids; delete cascades) — admin only create/edit/delete.
- `iso.calendar.task` (calendar_id, name, activity (originalTaskName), frequency, label, user_id, date_deadline, state[3], comments, date_completed, is_audit, audit_process_id, audited_personnel, scope, criteria, strengths, shared_user_ids, line_ids, `can_edit`). Mail thread + activity for the responsible.
- `iso.audit.process` — **data**, the 12 processes with objective, clauses and deliverables (converted from `auditProcessDetails.ts` by a script, editable by admins afterwards) + default conclusion text.
- `iso.audit.line` (task_id, kind opportunity|minor|major, text, process, user_id, date_deadline, finding_id) — replaces the three embedded arrays; "confirm" = create the finding and store `finding_id`.
- `iso.calendar.wizard` (year, company, auditors per process/quarter, routine activities with frequency/responsible) generates the tasks; frequency→dates as in rule 3 (pure function, unit-tested).
- `iso.calendar.share.wizard` (users + extra emails) → sends the PDF and adds users to `shared_user_ids`.
- Reports (QWeb): `audit report`, `audit template`.
Reuse: findings creation via the M1 model, reminders via `tools/reminders.py`, security groups from M1.

## 5. Size (estimate)
| Piece | Lines |
|---|---|
| Python models + wizards + pure frequency/date helper | ~700 |
| XML views/menus/security | ~600 |
| Audit process data (generated from the TS, 12 processes) | ~700 (generated, not hand-maintained) |
| QWeb reports (2) | ~400 |
| Tests | ~500 |
| **Custom code to maintain** (excl. generated data & tests) | **~1,700** vs ~6,500 legacy |

## 6. Decisions I need / assumptions to confirm
1. **Lock rule:** keep "only finished *audits* are locked" (legacy), or lock every finished task? (assumed: legacy)
2. **Improvement numbering:** keep the separate `M-` series (done in M1) — matches legacy; the migration will keep both number ranges.
3. **Admin notifications:** replace `psantilli@crucianelli.com` by the *ISO administrators* group. OK?
4. **Shared users from typed emails:** external emails can receive the PDF but, as before, get no system access; only registered users can be shared with. OK?
5. **Audit process content** (12 processes, ~600 lines of Spanish text) migrates verbatim into data records; admins can edit it later.
6. The fixed list of 12 processes and 10 routine activities becomes configuration data (editable), not code.
