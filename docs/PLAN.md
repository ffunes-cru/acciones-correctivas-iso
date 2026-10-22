# Implementation plan: re-platform onto Directus + SQL Server

Goal: **minimise the code we maintain.** Use maintained software (Directus) for everything
generic, and keep only the ISO-specific layer. Hosted in Docker, data in the company SQL Server.

## 1. Target architecture

```
Browser ── nginx (web) ──┬── static UI (ui/, React, @directus/sdk)
                         └── /api, /admin ──> Directus ──> SQL Server (company)
                                               │  ├─ extensions/enforce-workflow  (hooks, uses domain/)
                                               │  ├─ extensions/numbering         (SEQUENCE-backed numbers)
                                               │  ├─ Flows: reminders, emails (SMTP)
                                               │  └─ Auth: Active Directory (LDAP/OIDC)
                                               └── uploads volume
```

What we own: `domain/` (pure rules), `extensions/` (thin glue), `ui/` (screens), schema snapshot, ETL.
What we do not own any more: auth, users, roles/permissions engine, REST API, audit/revision log,
admin screens, email transport, scheduler, `server.ts`, Vercel, Firebase, Google Sheets sync.

## 2. Size budget (estimates, to be re-measured at the end of phase 4)

| Area | Today (lines) | Target | How |
|---|---|---|---|
| `server.ts` + `api/` + Vercel/Actions | ~1,830 | 0 | Directus + Flows replace API, cron, notify |
| Google Sheets sync (`googleWorkspace.ts`, `GoogleSheetsSyncStatus`, server routes) | ~1,900 | 0 | Dropped; Directus export / SQL reporting instead (decision D3) |
| `UserManagement`, `UserSelect`, `NotificationLog` | ~1,170 | ~0–200 | Directus Data Studio |
| `UserManual` + `userManualPDF` | ~1,320 | docs/ | Markdown manual |
| Business rules (inline in components) | ~1,500 | ~350 in `domain/` (done, tested) | Extracted |
| Details/New screens (Finding, SpecialRelease, ChangeRequest, ISOCalendar) | ~11,000 | ~4,000–5,000 | Shared approval panel, shared form/list/dashboard components, data via SDK hooks |
| **Total custom code** | **~25,400** | **~6,000–8,000** | |

## 3. Phases

**Phase 0 — done (this branch)**
- Repo initialised, baseline commit of the original code on `main`, work on `replatform/directus`.
- `domain/`: finding workflow, approvals, ISO task access, reminders — 40 unit tests.
- `Dockerfile` (targets `directus`, `web`), `compose.yaml` (with throwaway SQL Server for dev), `.env.example`.
- LGPL-3.0 licence files, this plan.

**Phase 1 — proof of concept (≈2 weeks). Exit criteria, all must pass:**
1. `docker compose --profile dev up` boots Directus on SQL Server 2022 (**confirms the mssql driver ships in the image**).
2. Login against the company Active Directory (LDAP/OIDC). Roles mapped from AD groups.
3. Create `findings` + `corrective_actions`; a non-owner cannot change status (Directus policy + hook).
4. Special release: status stays `pending_approval` until 4 areas + Posventa confirm (hook calling `domain`).
5. Sequential number from a SQL Server `SEQUENCE`, gap-tolerant, no duplicates under concurrent inserts.
6. A Flow sends a reminder mail through the company SMTP and dedupes via `notification_history`.
7. **Written confirmation of the Directus licence terms (D1).**

**Phase 2 — schema + permissions (≈2 weeks)**
- Relational model (see §4), kept in git as `schema/snapshot.yaml` (`directus schema snapshot` / `apply`).
- Policies replicating `firestore.rules` (see `docs/BEHAVIOR.md` for the rule-by-rule mapping).
- Extensions: `enforce-workflow`, `numbering`. Both import `domain/` and contain no rules of their own.

**Phase 3 — UI in `ui/` (≈3–4 weeks)**
- Vite + React + `@directus/sdk` + TanStack Query. Port screens one module at a time, in this order:
  findings → special releases → change requests → ISO calendar → dashboards/reports.
- Refactor while porting: no component over ~400 lines; one `ApprovalPanel` shared by special releases and change requests.
- PDFs (audit template/report) are kept only if auditors use them today (D4).
- Enable the `web` service in compose (`--profile full`).

**Phase 4 — data migration + cutover (≈2 weeks)**
- ETL script `migrate/` : Firestore export → SQL Server. Map Firebase uids → Directus users by email.
- Verify: row counts per collection, per-finding action counts, status distribution, number sequences continue after max.
- Parallel run, then switch DNS; archive Firebase; delete Vercel project, GitHub cron, service-account keys.
- Delete the legacy app from the repo (root `src/`, `server.ts`, `api/`, `firestore.rules`, …).

## 4. Data model (SQL Server)

| Firestore | Table(s) | Notes |
|---|---|---|
| `findings` | `findings` | status, category (`corrective`/`improvement`), owner, analyst |
| `findings/*/analysis/current` | `finding_analyses` (1:1) | |
| `findings/*/correctiveActions` | `corrective_actions` | FK finding |
| `findings.involvedUserIds/pendingActionUserIds` | `finding_users` (finding_id, user_id, role, pending) | arrays → join table |
| `special_releases` (+ nested `approvals`, `notifications`, `linkedActions`) | `special_releases`, `special_release_approvals` (one row per area incl. `posventa`), `special_release_links` | |
| `change_requests` (+ nested `reviews`, checklists) | `change_requests`, `change_request_reviews` (8 rows), `review_checklist_items` | |
| `iso_calendars` / `tasks` | `iso_calendars`, `iso_tasks`, `iso_task_shares` | `sharedEmails` → table |
| `config/counters` | `SEQUENCE`s: `seq_finding`, `seq_special_release`, `seq_change_request`, … | |
| `notifications`, `notificationHistory` | `notifications`, `notification_history` (unique `item_id`+`milestone`) | |
| `users` | `directus_users` (+ AD) | placeholder users become pre-provisioned users |

## 5. Test strategy

1. **Unit (`domain/`, vitest)** — exists, 40 tests. Every rule lives here first. Run: `cd domain && npm test`.
2. **API integration (`tests/api/`, vitest against compose `dev` profile)** — one test per row of
   `docs/BEHAVIOR.md`: log in as owner/analyst/responsible/other/admin and assert allowed vs. 403, and that hooks
   produce the right status. Added in phase 2 as each rule is implemented. CI runs them with `docker compose`.
3. **E2E smoke (Playwright, phase 3)** — 5–6 happy paths: raise finding → analyse → act → verify;
   special release 4-sign-off; change request review → approval.
4. **Migration checks (phase 4)** — scripted counts/invariants (§3).

## 6. Decisions and risks (need an owner)

| # | Item | Status |
|---|---|---|
| D1 | **Directus licence (BSL 1.1).** "Internal use" does not by itself grant free production use; the free grant is conditioned on organisation size/revenue (threshold to be confirmed on directus.io/bsl). Confirm company eligibility or buy a licence. | **Blocking for production** |
| D2 | Authentication: AD via LDAP vs. Entra ID/OIDC; group → role mapping. | Open |
| D3 | Drop Google Sheets sync? (assumed yes; export from SQL instead) | Assumed |
| D4 | Keep PDF audit template/report and Excel exports? | Open — ask users |
| D5 | Is anything else reading the Firestore/Sheet data (BI, other apps)? | Open |
| D6 | **Ownership of the original code** (written by an employee, repo not public): confirm the company holds the rights before relicensing. See `docs/LICENSING.md`. | Open |
| D7 | Directus version pin and upgrade policy (pin exact tag; quarterly bump with CI). | Open |
| R1 | Existing rules in `firestore.rules` are looser than the UI (e.g. any user can create actions, `/test/connection` is world-writable). Phase 2 tightens them to what the UI actually allows; behaviour changes are listed in `docs/BEHAVIOR.md`. | Tracked |
| R2 | Firebase web config (`firebase-applet-config.json`) is committed; it is not a secret but should be removed with the legacy app. | Tracked |
