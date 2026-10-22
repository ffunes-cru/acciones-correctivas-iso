# Behaviour inventory (source of truth for tests)

Each row is a rule the current app enforces, where it comes from, and where it is/will be tested.
`O:` = Odoo test in `addons/iso_sgc/tests/` (green). `U` = legacy TypeScript unit test in `domain/` (spec to port). `todo` = not ported yet.

## Findings
| Rule | Legacy source | Test |
|---|---|---|
| Company ∈ the 5 group companies (now `res.company`); description ≤ 2000 chars | rules `isValidFinding` | O `test_validation` (company: Q1) |
| Saving analysis moves finding to `pending_action` (summary required) | `handleAnalysisSubmit` | O `test_analysis_*` |
| Analysis can be saved by admin, owner or analyst only | rules `/analysis` | O `test_analysis_permissions_and_transition` |
| Corrective: only analyst (or admin) adds actions; improvement: only owner; only while `pending_action` | `handleAddAction` | O `test_who_can_add_actions_*`, `test_cannot_add_action_before_analysis` |
| Action deadline cannot be in the past (today is fine) | `handleAddAction` | O `test_action_deadline_not_in_past` |
| Only the action's responsible (or admin) reports it; comment mandatory; once | `handleActionExecution` | O `test_only_responsible_executes_and_comment_required` |
| All actions done → `pending_verification`; any rejected → `rejected`; pending users follow the actions | `handleActionExecution` | O `test_pending_users_follow_the_actions`, `test_rejected_action_*` |
| Only owner (or admin) verifies a finished action, once | rules `/correctiveActions` | O `test_only_owner_verifies`, `test_cannot_verify_twice_or_unfinished` |
| All verified OK → `completed`; any NOT OK → `cancelled` | `handleActionVerification` | O `test_all_verified_ok_completes`, `test_any_failed_verification_cancels` |
| **Changed:** cancelled actions don't need verification and don't block closing; all-cancelled finding → `cancelled` (legacy got stuck) | | O `test_cancelled_actions_do_not_block_closing`, `test_all_cancelled_cancels_finding` |
| Direct edits of workflow fields are blocked for non-admins | rules (partly) | O `test_workflow_fields_cannot_be_written_directly` |

## Special releases
| Rule | Legacy source | Test |
|---|---|---|
| Only the assigned approver (or admin) evaluates an area | `handleEvaluateApprover` | U `validateEvaluation`, A |
| Rejection requires a comment | idem | U |
| Any non-excluded rejection → `rejected`; all non-excluded evaluated **and** Posventa confirmed → `approved`; else `pending_approval` | idem | U `specialReleaseStatus` |
| Resolution email to creator, approvers and Posventa, once, on the first transition into approved/rejected | idem | A |

## Change requests
| Rule | Legacy source | Test |
|---|---|---|
| Any applicable area rejected → `rejected`; all applicable approved → `pending_approval` | review handler | U `changeRequestStatusAfterReview` |
| **Changed:** no applicable areas no longer auto-advances (legacy bug: vacuous truth) | | U |
| Review requires all checklist questions answered | review handler | A / UI |

## ISO calendar
| Rule | Legacy source | Test |
|---|---|---|
| Only admin creates/edits/deletes calendars and tasks | rules | A |
| Tasks whose name/original name contains "auditor" are visible/editable only to admin, assignee, shared emails | rules `hasAuditAccess` | U `hasAuditAccess` |
| Behaviour change: shared-email match is now case-insensitive | | U |

## Notifications
| Rule | Legacy source | Test |
|---|---|---|
| Milestones: `pre_30` (28–30 d), `pre_3`, `day_of`, `overdue_initial` (1–6 d, only if never notified), `overdue_week_N` | `server.ts` cron | O `test_reminders` (cron wiring: todo) |
| One mail per `itemId_milestone` | `notificationHistory` | U `historyId`, A (unique index) |

## Numbering
| Rule | Test |
|---|---|
| Findings get `H-0001…` (done); special releases, change requests, calendars get their own `ir.sequence` | O `test_creation_sequence_and_initial_state`; others todo |

## To inventory before phase 2 (not yet read in detail)
- `ISOCalendarDetails.tsx` task generation by frequency (3,400 lines — largest unknown).
- `Reports.tsx` filters and Excel columns; `auditReportPDF.ts` / `auditTemplatePDF.ts` contents.
- Special release → automatic creation of linked findings/actions (`linkedActions`); change request stage 3–4 (final approval, communication).
