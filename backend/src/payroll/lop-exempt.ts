/**
 * Logins paid in full whatever their attendance — no loss of pay (decided by
 * Finance, 3 Nov 2026). Used by the monthly run, its preview and the dry run.
 */
export const LOP_EXEMPT_ROLES = ['SUPERADMIN', 'FINANCE'];

export const isLopExempt = (role: string | null | undefined) => LOP_EXEMPT_ROLES.includes(role ?? '');
