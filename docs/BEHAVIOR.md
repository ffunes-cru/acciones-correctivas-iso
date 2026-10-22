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

## Change requests (SC-)
| Rule | Legacy source | Test |
|---|---|---|
| Created in draft with title, company, mission, proposal, objective, current/proposed comparison, impact analysis (all required); 8 area reviews with their questionnaires (74 questions) **copied** into the request | `NewChangeRequest` | O `test_creation_copies_the_questionnaires` |
| Definition editable only by the creator (or admin), only in draft | `handleSaveDefinition` | O `test_definition_editable_only_by_creator_in_draft`, `test_workflow_fields_are_protected` |
| Sending to review: ≥1 applicable area, a reviewer for each, one review deadline; creator/admin only; non-applicable areas are auto-approved; reviewers get a to-do; applicability locked afterwards | `handleSendToReview` | O `test_send_needs_*`, `test_sending_sets_up_the_reviews`, `test_applicability_is_locked_after_sending` |
| Only the assigned reviewer answers the questionnaire and decides (**not even an admin**, as in the legacy app) | `handleReviewAction`, `handleUpdateChecklistQuestion` | O `test_only_the_assigned_reviewer_*` |
| Answering anything but "Applies: yes" clears "Requires action" | `handleUpdateChecklistQuestion` | O `test_answering_no_clears_requires_action` |
| Approving needs every question answered, "requires action" answered where applicable, and an action created for each that requires one; rejecting needs nothing | `handleReviewAction` | O `test_approval_needs_a_complete_questionnaire`, `test_na_and_no_answers_are_enough`, `test_rejection_needs_*` |
| Any applicable rejection → request rejected (creator told); all applicable approved → final approval (creator told, to-do to assign the approver) | `handleReviewAction` | O `TestChangeRequestStatus`, `test_all_approved_moves_to_final_approval` |
| The action a question requires is a background corrective finding (origin "Gestión de Cambios", type "Procedimiento / Documentación", process "Otros", `pending_action`, owner = analyst = the reviewer, company = the request's) linked to the question and the request; only the reviewer creates it, once; the answer can't change while it exists | `handleCreateLinkedAction` | O `test_action_creates_a_background_finding`, `test_action_rules`, `test_wizard_and_approval_with_actions` |
| Creator or admin can remove a linked action (deletes the background finding) | `handleConfirmDeleteAction` | O `test_removing_an_action_is_for_creator_or_admin` |
| Final approver assigned by the creator (or admin) with a deadline; only that person decides; decision final | `handleSendToFinalApproval`, `handleFinalApprovalDecision` | O `test_final_approver_assignment`, `test_final_decision_*`, `test_final_rejection` |
| The final decision is communicated to creator, final approver and the applicable reviewers, and recorded (sent, date, notes) | stage 4 | O `test_final_decision_is_communicated_to_everybody_involved` |
| **Added:** an admin can reassign the reviewer of an open review (absent person), moving their to-do | — | O `test_admin_can_reassign_an_absent_reviewer` |
| **Changed:** the creator **or an admin** assigns the final approver (legacy: creator only); deleting a request (admin only) removes its linked actions | — | O `test_delete_is_admin_only_and_removes_linked_actions` |

## ISO calendar (details and decisions in `docs/CALENDAR.md`)
| Rule | Legacy source | Test |
|---|---|---|
| Wizard: 12 processes × 4 quarters (15 Mar/Jun/Sep/Dec) + 10 routine activities; year change moves dates; every audit/activity needs a responsible; a quarter can be dropped | `NewISOCalendar` | O `test_wizard_*` |
| Frequency → instances (annual 30 Nov; semester 30 Jun & 15 Dec; quarterly 31 Mar/30 Jun/30 Sep/15 Dec; monthly the 28th) | `generateInstancesForFrequency` | O `TestCalendarRules` |
| Generated names `Auditoría Interna: <process> - T1`, `<activity> - <label>`; ad-hoc tasks labelled "Ad-hoc", audit if the name contains "auditor" | `NewISOCalendar`, `handleAddCustomTask` | O `test_adhoc_defaults`, `TestCalendarRules` |
| Only admins create/edit/delete calendars and tasks; deleting a calendar deletes its tasks | rules, `handleDeleteCalendar` | O `test_only_admin_creates_tasks_and_calendars`, `test_stats_and_cascade_delete` |
| Audit tasks visible only to admin, responsible and shared users (UI rule, now a record rule) | `checkAuditAccess` | O `test_audit_tasks_are_hidden_from_uninvolved_users` |
| Only the responsible (or admin) edits a task; only admin re-plans (responsible/deadline); status only through buttons | UI | O `test_only_responsible_edits_and_only_admin_replans`, `test_status_only_through_buttons` |
| Finishing needs a comment; audits also need audited personnel; execution date defaults to today and is cleared on reopen | `handleSaveTaskStatus` | O `test_finish_*`, `test_audit_needs_audited_personnel_and_adapted_template` |
| A finished **audit** is locked for non-admins (comments, reopen); finished plain tasks stay editable (**decision 1**) | `isBlockedAudit` | O `test_finished_audit_is_locked_for_non_admins`, `test_finished_plain_task_can_be_reopened_by_its_responsible` |
| Admin cannot reassign/reschedule a finished task; reassigning an open task moves the to-do and notifies the new responsible | `handleOpenAdminEdit/SaveAdminEdit` | O `test_finished_task_cannot_be_reassigned`, `test_admin_reassigns_open_task_and_activity_follows` |
| The ISO administrators group (not one hard-coded address) is told when the responsible finishes a task (**decision 2**) | `handleSaveTaskStatus` | O `test_admins_are_told_when_the_responsible_finishes` |
| Opportunity → improvement finding (pending action, one action, `M-` series); minor/major NC → corrective finding (pending analysis, analyst = responsible); item then linked and frozen; needs text, responsible, deadline (+ process for NCs); not from a locked audit | `handleConfirmFinding` | O `test_opportunity_*`, `test_minor_and_major_*`, `test_confirm_validations`, `test_confirmed_line_is_frozen`, `test_cannot_raise_findings_from_a_locked_audit` |
| Sharing an audit grants access to the chosen users and notifies them; typed external emails get the message but no access (**decision 3**); only the responsible shares | `handleSendEmailReport` | O `test_sharing_*`, `test_only_responsible_shares_and_emails_are_validated` |
| **Changed:** the standard conclusion is inserted on request (never overwrites) and an audit cannot be finished while its `[placeholders]` remain (legacy let the unedited template count as a conclusion) | `getAuditConclusionDefault` | O `test_template_does_not_overwrite_a_conclusion`, `test_audit_needs_audited_personnel_and_adapted_template` |
| **Changed:** dates are generated by frequency and edited afterwards on each task (the legacy wizard edited every date before saving) | `NewISOCalendar` | — |
| Not ported: `handleMigrateRiesgos` (one-off data fix) and the dead `auditReportLink` field | | — |
| PDF report/template, email with attachment, dashboard summaries | `auditReportPDF`, `auditTemplatePDF` | M5 |

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
