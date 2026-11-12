import { countWorkingDays } from './working-days';

/**
 * Comp-off days consumed in a year, derived from the leave requests.
 *
 * `LeaveBalance.used` is a counter written when a request is approved and
 * given back when it is cancelled, rejected, deleted or overridden. It can
 * drift — a request left pending, a manual balance edit, a day that was not a
 * working day — and then the screen shows "1 used" next to an empty used-on
 * list. The rule is the requests themselves: only APPROVED, non-deleted
 * comp-off leave consumes a day, counted the way approval counted it.
 *
 * Returns one entry per comp-off balance row, zero when nothing was taken, so
 * callers can replace the stored counter wholesale rather than only when a
 * request happens to exist.
 */
export async function compOffUsedDays(
  prisma: any,
  companyId: number,
  year: number,
  balances: { employeeId: number; leaveTypeId: number }[],
): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (!balances.length) return used;

  const types = prisma.leaveType?.findMany
    ? await prisma.leaveType.findMany({
        where: { companyId, isCompOff: true },
        select: { id: true, isCompOff: true },
      })
    : [];
  const typeIds = new Set<number>(
    types.filter((t: any) => t.isCompOff === true).map((t: any) => t.id),
  );
  const rows = balances.filter((b) => typeIds.has(b.leaveTypeId));
  for (const b of rows) used.set(`${b.employeeId}:${b.leaveTypeId}`, 0);
  if (!rows.length) return used;

  const employeeIds = [...new Set(rows.map((b) => b.employeeId))];
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const requests = prisma.leaveRequest?.findMany
    ? await prisma.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          leaveTypeId: { in: [...typeIds] },
          status: 'APPROVED',
          deletedAt: null,
          startDate: { gte: start, lt: end },
        },
        select: {
          employeeId: true,
          leaveTypeId: true,
          startDate: true,
          endDate: true,
          isHalfDay: true,
        },
      })
    : [];
  if (!requests.length) return used;

  for (const r of requests) {
    const key = `${r.employeeId}:${r.leaveTypeId}`;
    if (!used.has(key)) used.set(key, 0);
  }

  const ids = [...new Set(requests.map((r: any) => r.employeeId))];
  const first = new Date(
    Math.min(...requests.map((r: any) => new Date(r.startDate).getTime())),
  );
  const last = new Date(
    Math.max(...requests.map((r: any) => new Date(r.endDate).getTime())),
  );

  const [employees, holidays, rosterRows] = await Promise.all([
    prisma.employee?.findMany
      ? prisma.employee.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            weeklyOffs: true,
            shift: { select: { workingDays: true } },
            branch: { select: { weeklyOffs: true } },
          },
        })
      : [],
    prisma.holiday?.findMany
      ? prisma.holiday.findMany({
          where: { companyId, date: { gte: first, lte: last } },
          select: { date: true },
        })
      : [],
    prisma.shiftRosterEntry?.findMany
      ? prisma.shiftRosterEntry.findMany({
          where: { employeeId: { in: ids }, date: { gte: first, lte: last } },
          select: {
            employeeId: true,
            date: true,
            isDayOff: true,
            onsiteApprovalStatus: true,
          },
        })
      : [],
  ]);

  const holidayDates = new Set<string>(
    holidays.map((h: any) => new Date(h.date).toISOString().slice(0, 10)),
  );
  const rosterBy = new Map<number, Map<string, any>>();
  for (const row of rosterRows) {
    const key = new Date(row.date).toISOString().slice(0, 10);
    const map = rosterBy.get(row.employeeId) ?? new Map<string, any>();
    map.set(key, row);
    rosterBy.set(row.employeeId, map);
  }
  const employeeById = new Map<number, any>(
    employees.map((e: any) => [e.id, e]),
  );

  for (const r of requests) {
    const employee = employeeById.get(r.employeeId);
    if (!employee) continue;
    const key = `${r.employeeId}:${r.leaveTypeId}`;
    const days = countWorkingDays(
      new Date(r.startDate),
      new Date(r.endDate),
      employee,
      !!r.isHalfDay,
      rosterBy.get(r.employeeId) ?? new Map(),
      holidayDates,
    );
    used.set(key, (used.get(key) ?? 0) + days);
  }

  return used;
}
