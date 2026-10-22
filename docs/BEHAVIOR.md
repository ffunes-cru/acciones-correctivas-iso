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
| Draft is edited only by the creator (or admin); approvers per area, Commercial can never be excluded; excluding an area clears its approver and signature | `handleUpdateApprover`, `handleToggleExcludeApprover` | O `test_only_creator_edits_draft`, `test_commercial_cannot_be_excluded`, `test_excluding_clears_approver_and_signature` |
| Sending needs an approver for every active area and a Posventa person; only creator/admin; locks editing | `handleSendForApproval` | O `test_send_requires_approvers_and_posventa`, `test_excluded_areas_do_not_need_approvers`, `test_only_creator_sends`, `test_cannot_edit_after_sending` |
| Each approver and Posventa get a to-do on sending (replaces the "FIRMA REQUERIDA" mails) | `onConfirmSend` | O `test_sending_creates_activities` |
| Only the assigned approver (or admin) signs, once, only while pending approval; rejection needs a comment | `handleEvaluateApprover` | O `test_only_assigned_approver_or_admin_evaluates`, `test_rejection_needs_comment_and_rejects_release`, `test_cannot_evaluate_twice_or_in_draft` |
| Any non-excluded rejection → `rejected`; all non-excluded signed **and** Posventa confirmed → `approved`; any order of signing/confirming | same | O `TestSpecialReleaseStatus`, `test_approved_needs_all_areas_and_posventa`, `test_posventa_first_then_areas` |
| Only the designated Posventa person (or admin) confirms receipt | `handleConfirmPosventaNotification` | O `test_approved_needs_all_areas_and_posventa` |
| Resolution message to creator, approvers and Posventa, once, on the transition into approved/rejected | idem | O `test_resolution_is_posted_once` (delivery needs an outgoing mail server, Q3) |
| Admin can amend any signature after sending (rejection needs a comment); state follows | `handleAdminEditApproval` | O `test_admin_can_amend_signature_and_state_follows` |
| Draft: creator/admin adds actions, each creating a background finding (corrective, origin "Muro/ Control de Calidad", type "Producto no conforme", process "Otros", owner = analyst = creator, already `pending_action`) with one action | `handleAddLinkedAction`, `NewSpecialRelease` | O `test_linked_action_*`, `test_wizard` |
| Only admin deletes; deleting removes the linked findings/actions | `onConfirmDeleteRelease` | O `test_delete_is_admin_only_and_cascades` |
| **Changed:** a non-admin cannot write workflow fields (state, Posventa confirmation) directly | rules (partly) | O `test_non_admin_cannot_force_state` |

## Security in the shared Odoo instance (new)
| Rule | Test |
|---|---|
| Companies are isolated: users see only records of their allowed companies | O `test_company_isolation_*` |
| Users without an ISO group have no access to ISO models | O `test_users_without_iso_group_have_no_access` |
| One numbering across companies | O `test_sequences_are_shared_across_companies` |
| Odoo system admins are ISO admins | O `test_odoo_system_admins_are_iso_admins` |

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
