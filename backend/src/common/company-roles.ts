/**
 * The roles a User row can carry, and what each may do.
 *
 * These are the values the database actually holds, verified against it rather
 * than inferred from the code — the code disagreed with itself for a long time.
 *
 * `SUPER_ADMIN`, with the underscore, is that disagreement. No User row has
 * ever held it; the value is `SUPERADMIN`. Six separate services each carried
 * their own role array listing both spellings defensively, which worked but
 * meant the rule lived in six places and drifted: notices admitted HR, payroll
 * admitted HR and FINANCE, project roles admitted neither, and nothing said
 * why. It is still accepted, in one place, so a token issued against older
 * code cannot lock anybody out.
 */
export type CompanyRole =
  | 'SUPERADMIN'
  | 'ADMIN'
  | 'HR'
  | 'FINANCE'
  | 'SALES'
  | 'OFFICE_STAFF'
  | 'EMPLOYEE';

/** The spelling that never existed in the database, still possible in a token. */
const LEGACY_SUPERADMIN = 'SUPER_ADMIN';

/** A role string from a token or a row, reduced to the canonical spelling. */
export function normaliseRole(role?: string | null): CompanyRole | null {
  if (!role) return null;
  return (role === LEGACY_SUPERADMIN ? 'SUPERADMIN' : role) as CompanyRole;
}

/** The company owner. Sees everything, decides everything. */
export function isSuperAdmin(role?: string | null): boolean {
  return normaliseRole(role) === 'SUPERADMIN';
}

/** May administer the company. */
export function isCompanyAdmin(role?: string | null): boolean {
  const r = normaliseRole(role);
  return r === 'SUPERADMIN' || r === 'ADMIN';
}

/** Administration plus the people function. */
export function isHrAdmin(role?: string | null): boolean {
  return isCompanyAdmin(role) || normaliseRole(role) === 'HR';
}

/** Administration plus the people and money functions. */
export function isPayrollRole(role?: string | null): boolean {
  const r = normaliseRole(role);
  return isCompanyAdmin(role) || r === 'HR' || r === 'FINANCE';
}

/** True when the role is any of the given ones, whatever spelling it arrived in. */
export function hasRole(role: string | null | undefined, ...allowed: CompanyRole[]): boolean {
  const r = normaliseRole(role);
  return !!r && allowed.includes(r);
}
