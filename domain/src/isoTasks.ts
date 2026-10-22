// ISO calendar task visibility (firestore.rules: hasAuditAccess).
// Audit tasks (name contains "auditor") are restricted to admin, the assignee and shared emails.

export interface IsoTaskAccessLite {
  name?: string | null;
  originalTaskName?: string | null;
  responsibleEmail?: string | null;
  sharedEmails?: string[] | null;
}

const isAuditTask = (t: IsoTaskAccessLite) =>
  /auditor/i.test(t.name ?? '') || /auditor/i.test(t.originalTaskName ?? '');

export function hasAuditAccess(
  user: { email: string; role: 'admin' | 'user' },
  task: IsoTaskAccessLite,
): boolean {
  if (!isAuditTask(task) || user.role === 'admin') return true;
  const email = user.email.toLowerCase();
  if (task.responsibleEmail && task.responsibleEmail.toLowerCase() === email) return true;
  // firestore.rules compared against the stored list as-is; we compare case-insensitively.
  return (task.sharedEmails ?? []).some((e) => e.toLowerCase() === email);
}
