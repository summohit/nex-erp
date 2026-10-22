/** Permanent WFH rules (22 Oct 2026), shared by the roster and attendance. */
export type PermanentWfhRule = { employeeId: number; startDate: Date; endDate: Date | null; weekdays: string | null };

/** Whether the rule makes this day (midnight UTC of the IST date) WFH. */
export function permanentWfhCovers(rule: PermanentWfhRule, day: Date): boolean {
  if (day < rule.startDate) return false;
  if (rule.endDate && day >= rule.endDate) return false;
  const wd = rule.weekdays?.trim();
  return !wd || wd.split(',').map(Number).includes(day.getUTCDay());
}

/** Rules that may touch [start, end]. */
export function permanentWfhWhere(employeeIds: number[], start: Date, end: Date) {
  return { employeeId: { in: employeeIds }, startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gt: start } }] };
}
