import { describe, expect, it } from 'vitest';
import { changeRequestStatusAfterReview, specialReleaseStatus, validateEvaluation, type ApprovalStatus } from '../src';

const sr = (c: ApprovalStatus, i: ApprovalStatus, co: ApprovalStatus, o: ApprovalStatus, excl: string[] = []) => ({
  calidad: { status: c, excluded: excl.includes('calidad') },
  ingenieria: { status: i, excluded: excl.includes('ingenieria') },
  comercial: { status: co, excluded: excl.includes('comercial') },
  operaciones: { status: o, excluded: excl.includes('operaciones') },
});

describe('specialReleaseStatus', () => {
  it('stays pending while any area is pending', () => {
    expect(specialReleaseStatus(sr('approved', 'pending', 'approved', 'approved'), true)).toBe('pending_approval');
  });
  it('needs posventa confirmation even when all approved', () => {
    expect(specialReleaseStatus(sr('approved', 'approved', 'approved', 'approved'), false)).toBe('pending_approval');
    expect(specialReleaseStatus(sr('approved', 'approved', 'approved', 'approved'), true)).toBe('approved');
  });
  it('one rejection rejects immediately, even with others pending and no posventa', () => {
    expect(specialReleaseStatus(sr('rejected', 'pending', 'pending', 'pending'), false)).toBe('rejected');
  });
  it('excluded areas are ignored, including their rejection', () => {
    expect(specialReleaseStatus(sr('approved', 'pending', 'approved', 'approved', ['ingenieria']), true)).toBe('approved');
    expect(specialReleaseStatus(sr('approved', 'rejected', 'approved', 'approved', ['ingenieria']), true)).toBe('approved');
  });
});

describe('validateEvaluation', () => {
  const user = { id: 'u1', role: 'user' as const };
  it('only the assigned user or an admin may evaluate', () => {
    expect(validateEvaluation(user, 'u1', 'approved', '')).toBeNull();
    expect(validateEvaluation(user, 'u2', 'approved', '')).not.toBeNull();
    expect(validateEvaluation({ id: 'a', role: 'admin' }, 'u2', 'approved', '')).toBeNull();
  });
  it('a rejection needs a non-blank comment', () => {
    expect(validateEvaluation(user, 'u1', 'rejected', '  ')).not.toBeNull();
    expect(validateEvaluation(user, 'u1', 'rejected', 'motivo')).toBeNull();
  });
});

describe('changeRequestStatusAfterReview', () => {
  const r = (applies: boolean, status: ApprovalStatus) => ({ applies, status });
  it('any applicable rejection rejects', () => {
    expect(changeRequestStatusAfterReview('pending_review', { a: r(true, 'approved'), b: r(true, 'rejected'), c: r(true, 'pending') })).toBe('rejected');
  });
  it('all applicable approved advances to final approval', () => {
    expect(changeRequestStatusAfterReview('pending_review', { a: r(true, 'approved'), b: r(false, 'pending'), c: r(true, 'approved') })).toBe('pending_approval');
  });
  it('keeps status while reviews are pending', () => {
    expect(changeRequestStatusAfterReview('pending_review', { a: r(true, 'approved'), b: r(true, 'pending') })).toBe('pending_review');
  });
  it('non-applicable rejected reviews are ignored', () => {
    expect(changeRequestStatusAfterReview('pending_review', { a: r(true, 'approved'), b: r(false, 'rejected') })).toBe('pending_approval');
  });
  it('no applicable reviews keeps status (deliberate fix of vacuous truth)', () => {
    expect(changeRequestStatusAfterReview('pending_review', { a: r(false, 'pending') })).toBe('pending_review');
  });
});
