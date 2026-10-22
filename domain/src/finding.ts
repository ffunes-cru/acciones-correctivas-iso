// Finding / corrective-action workflow.
// Extracted from src/components/FindingDetails.tsx (handleAnalysisSubmit,
// handleActionExecution, handleActionVerification) and firestore.rules.

export type FindingStatus =
  | 'pending_analysis'
  | 'pending_action'
  | 'pending_verification'
  | 'completed'
  | 'cancelled'
  | 'rejected';

export type ActionStatus = 'pending' | 'finished' | 'cancelled' | 'rejected';

export interface ActionLite {
  id: string;
  responsibleId: string;
  status: ActionStatus;
  /** undefined/null = not yet verified by the owner. */
  isVerified?: boolean | null;
}

export interface FindingLite {
  ownerId: string;
  analysisResponsibleId?: string | null;
  status: FindingStatus;
  category?: 'corrective' | 'improvement';
  pendingActionUserIds?: string[];
}

export interface Actor {
  id: string;
  role: 'admin' | 'user';
}

export interface Transition {
  status: FindingStatus;
  pendingActionUserIds: string[];
}

const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs));

/** Analysis saved -> finding moves to pending_action; owner and analyst are the pending users. */
export function afterAnalysis(f: FindingLite): Transition {
  return {
    status: 'pending_action',
    pendingActionUserIds: [f.ownerId, f.analysisResponsibleId].filter((u): u is string => !!u),
  };
}

/**
 * Called after an action's status changed (finished/cancelled/rejected).
 * `actions` must already contain the updated action.
 * Returns null when the finding status does not change; pending users may still change,
 * so the new pending list is always returned alongside.
 */
export function afterActionExecution(
  f: FindingLite,
  actions: ActionLite[],
  executedActionId: string,
): { status: FindingStatus | null; pendingActionUserIds: string[] } {
  const executed = actions.find((a) => a.id === executedActionId);
  const respId = executed?.responsibleId;
  const current = f.pendingActionUserIds ?? [];

  const allDone = actions.every((a) => a.status !== 'pending');
  const respStillPending = respId ? actions.some((a) => a.responsibleId === respId && a.status === 'pending') : true;

  if (allDone) {
    const hasRejected = actions.some((a) => a.status === 'rejected');
    if (hasRejected) return { status: 'rejected', pendingActionUserIds: [] };
    return {
      status: 'pending_verification',
      pendingActionUserIds: uniq([...current.filter((u) => u !== respId), f.ownerId]),
    };
  }

  if (!respStillPending) {
    return { status: null, pendingActionUserIds: uniq([...current.filter((u) => u !== respId), f.ownerId]) };
  }
  return { status: null, pendingActionUserIds: current };
}

/** Called after the owner verified one action. Null = finding not closed yet. */
export function afterActionVerification(actions: ActionLite[]): Transition | null {
  const allDone = actions.every((a) => a.status !== 'pending');
  const allVerified = actions.every((a) => a.isVerified !== undefined && a.isVerified !== null);
  if (!(allDone && allVerified)) return null;
  const ok = actions.every((a) => a.isVerified === true);
  return { status: ok ? 'completed' : 'cancelled', pendingActionUserIds: [] };
}

// ---- permissions (mirror of firestore.rules + UI checks) ----

const isAdmin = (u: Actor) => u.role === 'admin';

export const isOwner = (u: Actor, f: FindingLite) => isAdmin(u) || u.id === f.ownerId;
export const isAnalysisResponsible = (u: Actor, f: FindingLite) =>
  isAdmin(u) || (!!f.analysisResponsibleId && u.id === f.analysisResponsibleId);

/** Corrective findings: only the analyst adds actions. Improvements: only the owner. */
export function canAddAction(u: Actor, f: FindingLite): boolean {
  return f.category === 'improvement' ? isOwner(u, f) : isAnalysisResponsible(u, f);
}

export function canExecuteAction(u: Actor, a: ActionLite): boolean {
  return isAdmin(u) || u.id === a.responsibleId;
}

export const canVerifyAction = (u: Actor, f: FindingLite) => isOwner(u, f);

export const canSaveAnalysis = (u: Actor, f: FindingLite) =>
  isAdmin(u) || u.id === f.ownerId || (!!f.analysisResponsibleId && u.id === f.analysisResponsibleId);

// ---- input validation ----

export const COMPANIES = ['TMC', 'Fertec', 'Metallo', 'Leaf', 'Fabril'] as const;
export const MAX_DESCRIPTION = 2000;

export function validateExecution(comment: string | undefined | null): string | null {
  return comment && comment.trim() ? null : 'El reporte de implementación es obligatorio.';
}

/** `today` injected for testability; compares calendar days only. */
export function validateActionDeadline(deadline: Date, today: Date): string | null {
  const d = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return d < t ? 'La fecha límite de la acción no puede ser una fecha pasada.' : null;
}

export function validateFinding(d: { company: string; description: string }): string | null {
  if (!(COMPANIES as readonly string[]).includes(d.company)) return 'Empresa inválida.';
  if (d.description.length > MAX_DESCRIPTION) return `La descripción supera ${MAX_DESCRIPTION} caracteres.`;
  return null;
}
