# Implementation plan: re-platform onto Directus + SQL Server

Goal: **minimise the code we maintain.** Use maintained software (Directus) for everything
generic, and keep only the ISO-specific layer. Hosted in Docker, data in the company SQL Server.

## 1. Target architecture

```
Browser ── nginx (web) ──┬── static UI (ui/, React, @directus/sdk)
                         └── /api, /admin ──> Directus ──> SQL Server (company)
                                               │  ├─ extensions/enforce-workflow  (hooks, uses domain/)
                                               │  ├─ extensions/numbering         (SEQUENCE-backed numbers)
                                               │  ├─ extensions/reminders         (scheduled hook: deadline mails, SMTP)
                                               │  ├─ extensions/sheets-export     (scheduled hook: Google Sheets mirror)
                                               │  └─ Auth: Directus local users + passwords
                                               └── uploads volume
```

What we own: `domain/` (pure rules), `extensions/` (thin glue), `ui/` (screens), schema snapshot, ETL.
What we do not own any more: auth, users, REST API, audit/revision log, admin screens, email transport, `server.ts`,
Vercel, Firebase. Scheduled work is written as **extension hooks, not Directus Flows** (Flows may be capped on the free tier, see §6).

## 2. Size budget (estimates, to be re-measured at the end of phase 4)

| Area | Today (lines) | Target | How |
|---|---|---|---|
| `server.ts` + `api/` + Vercel/Actions | ~1,830 | ~300 (reminders extension) | Cron/notify logic moves to one scheduled extension using `domain/reminders` |
| Google Sheets sync (`googleWorkspace.ts`, `GoogleSheetsSyncStatus`, server routes) | ~1,900 | ~300 | **Kept (D3)** but rewritten as one server-side extension: service account only, SQL → 4 sheets (Acciones Correctivas, Acciones de Mejora, Liberaciones Especiales, MOC). Client OAuth path and token caching dropped |
| Audit PDFs (`auditTemplatePDF`, `auditReportPDF`, `auditProcessDetails`) | ~1,320 | ~1,300 | **Kept (D4)**, moved to `ui/` unchanged (client-side jsPDF, no server stack) |
| `UserManagement`, `UserSelect`, `NotificationLog` | ~1,170 | ~200 | Directus Data Studio + a small user picker |
| `UserManual` + `userManualPDF` | ~1,320 | docs/ (or ~300 if a PDF is still wanted) | Markdown manual |
| Business rules (inline in components) | ~1,500 | ~600 in `domain/` (done, 40 tests) | Extracted |
| Details/New screens (Finding, SpecialRelease, ChangeRequest, ISOCalendar) | ~11,000 | ~4,000–5,000 | Shared approval panel, shared form/list/dashboard components, data via SDK hooks |
| **Total custom code** | **~25,400** | **~8,000–10,000** | (was 6–8k before D3/D4 kept Sheets and PDFs) |

## 3. Phases

**Phase 0 — done (this branch)**
- Repo initialised, baseline commit of the original code on `main`, work on `replatform/directus`.
- `domain/`: finding workflow, approvals, ISO task access, reminders — 40 unit tests.
- `Dockerfile` (targets `directus`, `web`), `compose.yaml` (with throwaway SQL Server for dev), `.env.example`.
- Proprietary LICENSE, this plan.

**Phase 1 — proof of concept (≈2 weeks). Exit criteria, all must pass:**
1. `docker compose --profile dev up` boots **Directus 12.5.0 with no licence key** on SQL Server 2022
   (**confirms the mssql driver ships in the v12 image**).
2. **Core-tier audit (blocking, see §6 D1):** with no key, verify we can still (a) create ~25 collections,
   (b) run our users as API-only (not counted as Studio seats), (c) enforce per-role access for the rules in
   `docs/BEHAVIOR.md`, with at most 3 Studio admins and no Flows. Record exactly what is blocked.
3. Local users: create, log in, reset password by SMTP mail.
4. Create `findings` + `corrective_actions`; a non-owner cannot change status. **Enforced in the extension
   even if Directus permissions are coarse** (defence in depth, and the fallback if custom access rules are licence-gated).
5. Special release: status stays `pending_approval` until 4 areas + Posventa confirm (hook calling `domain`).
6. Sequential number from a SQL Server `SEQUENCE`, no duplicates under concurrent inserts.
7. Scheduled extension sends a reminder mail through the company SMTP and dedupes via `notification_history`.
8. Scheduled extension mirrors one table to a Google Sheet with the service account (needs outbound HTTPS to Google).
9. **Written answer from Directus on the licence question (D1)**, with a price quote if a paid tier is needed.

**Phase 2 — schema + permissions (≈2 weeks)**
- Relational model (see §4), kept in git as `schema/snapshot.yaml` (`directus schema snapshot` / `apply`).
- Directus roles/permissions replicating `firestore.rules` as far as the tier allows, rest in `enforce-workflow` (see `docs/BEHAVIOR.md` for the rule-by-rule mapping).
- Extensions: `enforce-workflow`, `numbering`. Both import `domain/` and contain no rules of their own.

**Phase 3 — UI in `ui/` (≈3–4 weeks)**
- Vite + React + `@directus/sdk` + TanStack Query. Port screens one module at a time, in this order:
  findings → special releases → change requests → ISO calendar → dashboards/reports.
- Refactor while porting: no component over ~400 lines; one `ApprovalPanel` shared by special releases and change requests.
- Audit PDFs and Excel exports are kept (D4).
- Enable the `web` service in compose (`--profile full`).

**Phase 4 — data migration + cutover (≈2 weeks)**
- ETL script `migrate/` : Firestore export → SQL Server. Map Firebase uids → Directus users by email; users get a one-time password-reset mail (no passwords to migrate).
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

## 6. Decisions and risks

### D1 — Directus licence: the pasted MSCL text is not the whole story (re-assessed)
Directus **12** is under the *Monospace Sustainable Core License* (MSCL-1.0-GPL; it replaced the BSL used by v11; each
version converts to GPL-3.0 after 4 years). The licence text itself permits **internal use for any purpose that is not a
"Competing Use"**, so *legally* running it internally is fine. But it also forbids circumventing the **license-key
functionality**, and Directus uses that to tier the product:

- Unlicensed self-hosted = **Core tier**. Per user reports on the Directus forum (**unconfirmed, verify**): **3 Studio
  seats, 5 Flows, 50 collections**, and *custom access rules* sit behind a licence.
- Seats count only users with App/Admin access to the Studio; API-only users (our UI's end users) do **not** count.
- Free **Open Innovation Grant** (full features) is limited to **< US$5M revenue and < 50 employees**, assessed by
  legal entity of whoever logs in to the Studio. A company above that needs a **paid licence** (forum users quote
  **≈US$500–600/month**, unconfirmed). Licence activation binds to the DB project id + absolute `PUBLIC_URL`.
- Not found in the docs: the exact Core limits, whether LDAP/SSO is gated (we no longer need it), or how multi-company
  groups are treated.

**Consequence for the design:** keep Directus's role in the stack *replaceable*. All rules live in `domain/` and are
enforced by our extension, scheduled jobs are extensions (not Flows), users are API-only. If Core is enough, cost is zero.
If not, decide in phase 1 between (a) paying the licence (~US$6–7k/year, to be quoted) and (b) replacing the Directus layer
with a thin custom API (Fastify + `mssql`/Drizzle, ~1,500 extra lines: auth, CRUD, revisions) with no vendor dependency.
Note v12.5 also needs outbound access to Directus's licensing/analytics services; confirm this is acceptable to IT
(the analytics opt-out is reported as Enterprise-only).

### Others
| # | Item | Status |
|---|---|---|
| D2 | Authentication: **Directus local users + password** (no AD). | **Decided** |
| D3 | Keep Google Sheets sync, rewritten as one server-side extension. | **Decided** (what do the sheets feed? worth asking: it may be replaceable by SQL views later) |
| D4 | Keep audit PDFs and Excel exports. | **Decided** |
| D5 | No other consumers of Firestore/Sheet data. | **Decided** (the Sheet is still a consumer; keep its layout stable) |
| D6 | Code is company property; **kept proprietary** (`LICENSE`, `UNLICENSED`). | **Decided** |
| D7 | Pin exact Directus version + digest, upgrade procedure, Dependabot. | **Implemented** (`docs/UPGRADES.md`) |
| R1 | Tighten the loose `firestore.rules` to what the UI actually allows; changes are listed in `docs/BEHAVIOR.md`. | Accepted |
| R2 | Firebase web config in repo; removed with the legacy app. | Accepted |
| R3 | Password auth means we now own password-reset mail deliverability and lockout policy (Directus provides the mechanics). | New |
| R4 | The Sheets mirror needs outbound HTTPS to Google and a stored service-account key (store as a Docker secret/env, never in git). | New |
