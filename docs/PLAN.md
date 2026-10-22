# Implementation plan: re-platform onto Odoo 19 Community

Decision (2026-10-22): rebuild as a custom Odoo 19 Community module instead of Directus + a React UI.
Reasons: Odoo Community is already run in-house with custom modules (one platform for many apps), it is free
software (LGPL-3) with no licence tiers, and Odoo supplies what we would otherwise build or rent: users, roles,
record rules, multi-company, chatter/activities/mail, sequences, scheduled actions, QWeb PDFs, XLSX export, views.
SQL Server is not required (D-SQL). The Directus work (Dockerfile pin, UPGRADES.md, extensions) was dropped;
it remains in git history (commits 563986e, 465edd8).

## 1. Architecture

```
Odoo 19 CE (existing, or compose.yaml for dev)  ──  PostgreSQL
   └── addons/iso_sgc          (this repo, proprietary)
         models/   iso.finding, iso.finding.action, (next: special release, change request, calendar)
         security/ groups (User/Administrator), ACLs, record rules
         views/    list, form, search, menus
         tools/    pure helpers (reminder schedule)
         tests/    Odoo TransactionCase suites
```
We depend only on Odoo core (`base`, `mail`). **No OCA modules** (see §5).
What we no longer own: auth/users, REST API, React UI, `server.ts`, Vercel, Firebase, Firestore rules,
GitHub-Actions cron.

## 2. Status

| Module / task | State |
|---|---|
| M1 Findings + corrective actions (workflow, rules, chatter, activities, security, views) | **Done** |
| Reminder schedule (`tools/reminders.py`) | Done, tested; cron job not yet wired |
| M2 Special releases (4 area approvals + Posventa confirmation, linked actions, admin amendments, delete cascade) | **Done** (M1+M2+security tested) |
| M3 Change requests (8 area reviews + checklists, final approval, communication) | Todo |
| M4 ISO calendar + tasks (wizard, tasks, audit lines → findings, sharing, visibility, locking, admin replanning) | **Done** (**91 Odoo tests green**). PDFs/report email are M5 |
| M5 Reports: audit template/report as QWeb PDFs, XLSX exports, Sheets export (D3/D4) | Todo |
| M6 Reminders cron + notification history | Todo |
| M7 Firestore → Odoo data migration | Todo |
| M8 UAT, cutover, decommission Firebase/Vercel/GitHub cron, delete legacy code | Todo |

`domain/` (TypeScript rules + 40 vitest tests) is now only a **reference spec** for M2–M4 (approvals, ISO task
access). Delete it once those are ported to Python tests. Finding, special-release and reminder rules are already ported.

## 3. Module design notes (M1, already implemented)

- Numbers `H-0001…` from an `ir.sequence` (replaces the Firestore counter transaction).
- `pending_user_ids` is computed and stored; the legacy app kept `involvedUserIds/pendingActionUserIds` arrays in sync by hand.
- Transitions happen only through buttons/methods that check who may act; direct writes to workflow fields are
  blocked for non-admins. Record rules limit who can write a finding (owner, analyst, action responsibles) and
  who can delete (owner). Admin = group *ISO SGC / Administrator* (implied by Odoo's system admin).
- Notifications = Odoo chatter + **activities** (the responsible gets a to-do with the deadline; it is closed when they
  report). Replaces the Apps-Script mail webhook, `notifications` collection and most of the cron.
- Multi-company is native (`company_id`); the five group companies must exist as `res.company` (open question Q1).

## 4. Phases and exit criteria

1. **M2–M4 models + tests** (one module at a time, each ported from `docs/BEHAVIOR.md` rows, tests first).
   Exit: every row of BEHAVIOR.md for the module has a passing test.
2. **M5/M6**: QWeb audit PDFs compared side by side with legacy output; Sheets export writes the same 4 sheets
   (needs `google-api-python-client`, declared in `external_dependencies`, and outbound HTTPS); reminder cron sends
   each milestone once.
3. **Spanish UI**: add `i18n/es_AR.po` (source strings are English so Odoo's translation tooling works).
4. **M7 migration**: script (Odoo JSON-RPC/ORM) from a Firestore export; users matched by email and sent a
   password-reset mail; numbers continue after the highest legacy number. Verify counts per entity, per-finding
   action counts, status distribution, sequence next value.
5. **UAT** with real users on a copy, then cutover and decommission.

## 5. Why not the OCA `mgmtsystem` modules (checked against the 19.0 branch)

- `base_tier_validation` (the OCA approvals engine) is **not available on 19.0**: three migration PRs were closed unmerged.
- `mgmtsystem_nonconformity` requires a *partner* and a *manager* on every record, has no per-action implementation
  report/verification/rejection, and pulls in `document_page_procedure` (another OCA repo). Our workflow differs
  enough that bending it costs more than the ~330 lines of our own model.
- They are Beta and AGPL, and each is one more thing to port at every Odoo major version.
Revisit if OCA ports `base_tier_validation` to 19.0 and M2/M3 prove clumsy.

## 6. Test strategy

- **Odoo TransactionCase** (`addons/iso_sgc/tests`), run with `scripts/test-odoo.sh` (throw-away DB, uses your Odoo
  checkout via `ODOO_DIR`). Tests act as different users (`with_user`) to prove permissions, not just states.
- Pure logic (reminders) is tested without a DB (`BaseCase`).
- Optional later: Odoo tours for the happy path through the UI.
- CI: run the same script in a container once a remote exists.

## 7. Decisions

| # | Decision |
|---|---|
| D-SQL | SQL Server **not required**; PostgreSQL (Odoo's) is the database. If BI needs the data in SQL Server, add an ETL/linked-server feed later. |
| D2 | Users log in with Odoo user/password (Odoo can also add Google OAuth later). |
| D3, D4 | Google Sheets export and audit PDFs/Excel **kept**, rebuilt as an Odoo scheduled action and QWeb reports. |
| D6 | Code is company property and **proprietary** (`license: Other proprietary`). |
| D7 | Pin the Odoo image (digest) in `Dockerfile` before production; Odoo majors yearly → budget one port of `iso_sgc` per major. |
| R1 | The permissive Firestore rules are replaced by the stricter rules in BEHAVIOR.md. |

## 8. Open questions

- ~~Q1~~ Answered: the five companies exist in the same database; `company_id` + multi-company record rules isolate them (tested).
- ~~Q2~~ Answered: it will share an existing instance, so Odoo's own authentication is mandatory and our groups gate access (tested). `compose.yaml` stays as a dev convenience (untested: no Docker daemon here).
- **Q3** The local server has **no outgoing mail**. Activities (to-dos in the Odoo UI/systray) work without it, but emailed notifications (assignments, final resolutions, reminders) need `ir.mail_server` in production. Tests do not depend on mail.
- ~~Q4~~ Answered: origin/type/process stay free text for now.
