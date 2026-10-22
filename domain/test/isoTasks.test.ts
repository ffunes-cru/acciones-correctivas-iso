import { describe, expect, it } from 'vitest';
import { hasAuditAccess } from '../src';

const user = { email: 'Ana@Crucianelli.com', role: 'user' as const };

describe('hasAuditAccess', () => {
  it('non-audit tasks are open to everyone', () => {
    expect(hasAuditAccess(user, { name: 'Revisión por la dirección' })).toBe(true);
  });
  it('audit tasks (name or original name) are restricted', () => {
    expect(hasAuditAccess(user, { name: 'Informe del Auditor' })).toBe(false);
    expect(hasAuditAccess(user, { name: 'x', originalTaskName: 'AUDITOR interno' })).toBe(false);
  });
  it('admin, assignee and shared emails get access, case-insensitively', () => {
    const t = { name: 'Auditor', responsibleEmail: 'ana@crucianelli.com' };
    expect(hasAuditAccess({ email: 'x@y.com', role: 'admin' }, t)).toBe(true);
    expect(hasAuditAccess(user, t)).toBe(true);
    expect(hasAuditAccess(user, { name: 'Auditor', sharedEmails: ['ANA@crucianelli.com'] })).toBe(true);
    expect(hasAuditAccess(user, { name: 'Auditor', sharedEmails: ['otro@crucianelli.com'] })).toBe(false);
  });
});
