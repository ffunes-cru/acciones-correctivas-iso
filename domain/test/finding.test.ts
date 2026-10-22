import { describe, expect, it } from 'vitest';
import {
  afterActionExecution,
  afterActionVerification,
  afterAnalysis,
  canAddAction,
  canExecuteAction,
  canSaveAnalysis,
  validateActionDeadline,
  validateExecution,
  validateFinding,
  type ActionLite,
  type FindingLite,
} from '../src';

const finding = (o: Partial<FindingLite> = {}): FindingLite => ({
  ownerId: 'owner',
  analysisResponsibleId: 'analyst',
  status: 'pending_action',
  pendingActionUserIds: ['owner', 'analyst'],
  ...o,
});
const act = (id: string, responsibleId: string, status: ActionLite['status'], isVerified?: boolean): ActionLite => ({
  id, responsibleId, status, isVerified,
});

describe('afterAnalysis', () => {
  it('moves to pending_action with owner and analyst pending', () => {
    expect(afterAnalysis(finding())).toEqual({ status: 'pending_action', pendingActionUserIds: ['owner', 'analyst'] });
  });
  it('drops a missing analyst', () => {
    expect(afterAnalysis(finding({ analysisResponsibleId: null })).pendingActionUserIds).toEqual(['owner']);
  });
});

describe('afterActionExecution', () => {
  it('keeps status while other actions are pending', () => {
    const r = afterActionExecution(finding({ pendingActionUserIds: ['u1', 'u2'] }), [act('a', 'u1', 'finished'), act('b', 'u2', 'pending')], 'a');
    expect(r.status).toBeNull();
    // u1 has nothing left -> replaced by owner
    expect(r.pendingActionUserIds).toEqual(['u2', 'owner']);
  });
  it('keeps the user pending if they still own another pending action', () => {
    const r = afterActionExecution(finding({ pendingActionUserIds: ['u1'] }), [act('a', 'u1', 'finished'), act('b', 'u1', 'pending')], 'a');
    expect(r).toEqual({ status: null, pendingActionUserIds: ['u1'] });
  });
  it('goes to pending_verification when all done', () => {
    const r = afterActionExecution(finding({ pendingActionUserIds: ['u1'] }), [act('a', 'u1', 'finished'), act('b', 'u1', 'cancelled')], 'b');
    expect(r).toEqual({ status: 'pending_verification', pendingActionUserIds: ['owner'] });
  });
  it('any rejected action rejects the finding and clears pending users', () => {
    const r = afterActionExecution(finding(), [act('a', 'u1', 'finished'), act('b', 'u2', 'rejected')], 'b');
    expect(r).toEqual({ status: 'rejected', pendingActionUserIds: [] });
  });
  it('does not duplicate the owner', () => {
    const r = afterActionExecution(finding({ pendingActionUserIds: ['owner', 'u1'] }), [act('a', 'u1', 'finished')], 'a');
    expect(r.pendingActionUserIds).toEqual(['owner']);
  });
});

describe('afterActionVerification', () => {
  it('stays open until every action is verified', () => {
    expect(afterActionVerification([act('a', 'u', 'finished', true), act('b', 'u', 'finished')])).toBeNull();
  });
  it('stays open while an action is pending', () => {
    expect(afterActionVerification([act('a', 'u', 'finished', true), act('b', 'u', 'pending')])).toBeNull();
  });
  it('completes when all verified OK', () => {
    expect(afterActionVerification([act('a', 'u', 'finished', true), act('b', 'u', 'finished', true)]))
      .toEqual({ status: 'completed', pendingActionUserIds: [] });
  });
  it('cancels when any verification failed', () => {
    expect(afterActionVerification([act('a', 'u', 'finished', true), act('b', 'u', 'finished', false)]))
      .toEqual({ status: 'cancelled', pendingActionUserIds: [] });
  });
});

describe('permissions', () => {
  const owner = { id: 'owner', role: 'user' as const };
  const analyst = { id: 'analyst', role: 'user' as const };
  const other = { id: 'other', role: 'user' as const };
  const admin = { id: 'adm', role: 'admin' as const };

  it('corrective: only analyst (or admin) adds actions', () => {
    const f = finding({ category: 'corrective' });
    expect(canAddAction(analyst, f)).toBe(true);
    expect(canAddAction(admin, f)).toBe(true);
    expect(canAddAction(owner, f)).toBe(false);
    expect(canAddAction(other, f)).toBe(false);
  });
  it('improvement: only owner (or admin) adds actions', () => {
    const f = finding({ category: 'improvement' });
    expect(canAddAction(owner, f)).toBe(true);
    expect(canAddAction(analyst, f)).toBe(false);
  });
  it('only the responsible (or admin) executes an action', () => {
    const a = act('a', 'other', 'pending');
    expect(canExecuteAction(other, a)).toBe(true);
    expect(canExecuteAction(owner, a)).toBe(false);
    expect(canExecuteAction(admin, a)).toBe(true);
  });
  it('analysis can be saved by admin, owner or analyst only', () => {
    const f = finding();
    expect(canSaveAnalysis(owner, f)).toBe(true);
    expect(canSaveAnalysis(analyst, f)).toBe(true);
    expect(canSaveAnalysis(other, f)).toBe(false);
  });
  it('an unassigned analysis does not match an undefined user id', () => {
    expect(canSaveAnalysis({ id: '', role: 'user' }, finding({ analysisResponsibleId: '' }))).toBe(false);
  });
});

describe('validation', () => {
  it('requires an implementation comment', () => {
    expect(validateExecution('')).not.toBeNull();
    expect(validateExecution('   ')).not.toBeNull();
    expect(validateExecution(undefined)).not.toBeNull();
    expect(validateExecution('hecho')).toBeNull();
  });
  it('rejects past deadlines but allows today', () => {
    const today = new Date(2026, 9, 22, 15, 0);
    expect(validateActionDeadline(new Date(2026, 9, 21), today)).not.toBeNull();
    expect(validateActionDeadline(new Date(2026, 9, 22, 0, 0), today)).toBeNull();
    expect(validateActionDeadline(new Date(2026, 9, 23), today)).toBeNull();
  });
  it('validates company and description length', () => {
    expect(validateFinding({ company: 'TMC', description: 'x' })).toBeNull();
    expect(validateFinding({ company: 'Nope', description: 'x' })).not.toBeNull();
    expect(validateFinding({ company: 'TMC', description: 'x'.repeat(2001) })).not.toBeNull();
    expect(validateFinding({ company: 'TMC', description: 'x'.repeat(2000) })).toBeNull();
  });
});
