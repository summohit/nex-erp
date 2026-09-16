/**
 * The ProjectMember rows a brand-new project starts with.
 *
 * ProjectMember is unique on (projectId, employeeId), so the same person
 * appearing as both the owner and a chosen manager — or as both a manager and
 * an assigned user, which is completely normal — must collapse to one row
 * rather than failing the insert.
 *
 * Highest role wins: ADMIN (the owner) over PROJECT_MANAGER over MEMBER.
 * Extracted so the precedence is stated once and can be tested without a
 * database.
 */
export type ProjectMemberRole = 'ADMIN' | 'PROJECT_MANAGER' | 'MEMBER';

export function buildInitialMembers(
  leadId: number,
  pmIds: unknown,
  memberIds: unknown,
): { employeeId: number; role: ProjectMemberRole }[] {
  // `> 0` matters: Number(null) is 0, which passes an integer check and would
  // insert a member with employeeId 0 — a row pointing at nobody.
  const ids = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.map(Number).filter(n => Number.isInteger(n) && n > 0)
      : [];

  const byEmployee = new Map<number, ProjectMemberRole>();

  // Lowest precedence first, so a later assignment overwrites it.
  for (const id of ids(memberIds)) byEmployee.set(id, 'MEMBER');
  for (const id of ids(pmIds)) byEmployee.set(id, 'PROJECT_MANAGER');
  byEmployee.set(leadId, 'ADMIN');

  return Array.from(byEmployee, ([employeeId, role]) => ({ employeeId, role }));
}
