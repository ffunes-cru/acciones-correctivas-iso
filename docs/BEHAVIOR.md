# Behaviour inventory (source of truth for tests)

Each row is a rule the current app enforces, where it comes from, and where it is/will be tested.
`U` = unit test in `domain/` (exists). `A` = API integration test (phase 2, not yet written).

## Findings
| Rule | Legacy source | Test |
|---|---|---|
| Company ∈ {TMC, Fertec, Metallo, Leaf, Fabril}; description ≤ 2000 chars | rules `isValidFinding` | U `validateFinding`, A |
| Saving analysis moves finding to `pending_action`; owner + analyst become pending | `handleAnalysisSubmit` | U `afterAnalysis` |
| Analysis can be written by admin, owner or analyst only | rules `/analysis` | U `canSaveAnalysis`, A |
| Corrective: only analyst adds actions; improvement: only owner | `handleAddAction` | U `canAddAction`, A |
| Action deadline cannot be in the past | `handleAddAction` | U `validateActionDeadline` |
| Only the action's responsible (or admin) executes it; comment mandatory | `handleActionExecution` | U `canExecuteAction`, `validateExecution` |
| All actions done → `pending_verification`; any rejected → finding `rejected`, pending users cleared | `handleActionExecution` | U `afterActionExecution` |
| Only owner (or admin) verifies an action | rules `/correctiveActions` | U `canVerifyAction`, A |
| All verified OK → `completed`; any verified NOT OK → `cancelled` | `handleActionVerification` | U `afterActionVerification` |

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
| Milestones: `pre_30` (28–30 d), `pre_3`, `day_of`, `overdue_initial` (1–6 d, only if never notified), `overdue_week_N` | `server.ts` cron | U `reminderMilestone` |
| One mail per `itemId_milestone` | `notificationHistory` | U `historyId`, A (unique index) |

## Numbering
| Rule | Test |
|---|---|
| Findings, special releases, change requests, calendars get unique sequential numbers (Firestore counter transaction → SQL `SEQUENCE`) | A (concurrent inserts) |

## To inventory before phase 2 (not yet read in detail)
- `ISOCalendarDetails.tsx` task generation by frequency (3,400 lines — largest unknown).
- `Reports.tsx` filters and Excel columns; `auditReportPDF.ts` / `auditTemplatePDF.ts` contents.
- Special release → automatic creation of linked findings/actions (`linkedActions`); change request stage 3–4 (final approval, communication).
