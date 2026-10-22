// Multi-party approval rules.
// Extracted from SpecialReleaseDetails.tsx (handleEvaluateApprover) and
// ChangeRequestDetails.tsx (review handler).

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// ---- Special release: 4 approvers + posventa confirmation ----

export const SPECIAL_RELEASE_AREAS = ['calidad', 'ingenieria', 'comercial', 'operaciones'] as const;
export type SpecialReleaseArea = (typeof SPECIAL_RELEASE_AREAS)[number];
export type SpecialReleaseStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface SpecialReleaseApprovalLite {
  status: ApprovalStatus;
  excluded?: boolean;
}

export function specialReleaseStatus(
  approvals: Record<SpecialReleaseArea, SpecialReleaseApprovalLite>,
  posventaConfirmed: boolean,
): Exclude<SpecialReleaseStatus, 'draft'> {
  const active = SPECIAL_RELEASE_AREAS.map((a) => approvals[a]).filter((a) => !a.excluded);
  if (active.some((a) => a.status === 'rejected')) return 'rejected';
  const allEvaluated = active.every((a) => a.status !== 'pending');
  if (allEvaluated && posventaConfirmed) return 'approved';
  return 'pending_approval';
}

/** Evaluating requires being the assigned user or admin; a rejection needs a comment. */
export function validateEvaluation(
  actor: { id: string; role: 'admin' | 'user' },
  assignedUserId: string | undefined,
  status: 'approved' | 'rejected',
  comments: string,
): string | null {
  if (actor.role !== 'admin' && actor.id !== assignedUserId) return 'No tiene permisos para evaluar esta área.';
  if (status === 'rejected' && !comments.trim()) return 'Los comentarios son obligatorios al rechazar.';
  return null;
}

// ---- Change request: 8 area reviews -> final approval ----

export type ChangeRequestStatus = 'draft' | 'pending_review' | 'pending_approval' | 'approved' | 'rejected';

export interface AreaReviewLite {
  applies: boolean;
  status: ApprovalStatus;
}

/**
 * Any rejected applicable review rejects the request; all applicable reviews approved
 * advances it to final approval. Deliberate deviation from the original: with NO
 * applicable reviews the original advanced (vacuous `every`); here the status is kept.
 */
export function changeRequestStatusAfterReview(
  current: ChangeRequestStatus,
  reviews: Record<string, AreaReviewLite>,
): ChangeRequestStatus {
  const active = Object.values(reviews).filter((r) => r.applies);
  if (active.length === 0) return current;
  if (active.some((r) => r.status === 'rejected')) return 'rejected';
  if (active.every((r) => r.status === 'approved')) return 'pending_approval';
  return current;
}
