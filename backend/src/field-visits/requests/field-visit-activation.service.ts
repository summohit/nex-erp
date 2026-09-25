import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FIELD_VISIT_DAY, OPEN_VISIT_DAYS } from '../field-visit-status';

/**
 * A Prisma client inside a transaction.
 *
 * Typed loosely on purpose: every method here is handed the `tx` from the
 * approval's own transaction, and naming the generated client type would tie
 * this file to a Prisma version for no gain — the fan-out must commit with the
 * decision or not at all, which is the only property that matters.
 */
type Tx = any;

export interface ActivationRequest {
  id: number;
  requestNumber: string;
  companyId: number;
  projectId: number;
  raisedById: number;
  location: string;
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  members: { employeeId: number }[];
  tasks: { id: number; name: string; description: string | null; position: number }[];
}

export interface ActivationResult {
  issues: number;
  attendanceDays: number;
  rosterEntries: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What approval actually does (§4).
 *
 * The request names people, days and tasks; approving it turns all three into
 * things those people will be held to — a task on their board, a day on their
 * attendance schedule, and a roster entry saying they are working at a client
 * site rather than the office. §14 is the reason this is automatic: the PM's
 * selection is the source of truth, and asking them to assign the same tasks
 * again afterwards is where the two lists drift apart.
 *
 * Everything here runs inside the approval's transaction. A trip that is
 * approved but whose tasks failed to appear is worse than one that was never
 * approved: the manager has been told it is going ahead.
 *
 * Every step is idempotent, because §10's modification flow re-approves a
 * request that has already been activated once. Re-running must fill in what
 * changed, not duplicate what is already there.
 */
@Injectable()
export class FieldVisitActivationService {
  private readonly logger = new Logger(FieldVisitActivationService.name);

  /** Marks the roster entries this feature owns, so cancelling can find them. */
  private rosterNote(requestNumber: string): string {
    return `Field visit ${requestNumber}`;
  }

  /** Every calendar day of the trip, first to last inclusive, at UTC midnight. */
  private daysOf(request: ActivationRequest): Date[] {
    const days: Date[] = [];
    const last = request.endDate.getTime();
    for (let t = request.startDate.getTime(); t <= last; t += DAY_MS) {
      days.push(new Date(t));
    }
    return days;
  }

  private key(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async activate(
    tx: Tx, request: ActivationRequest, actorId: number | null,
  ): Promise<ActivationResult> {
    const days = this.daysOf(request);
    const employeeIds = request.members.map((m) => m.employeeId);

    const rosterEntries = await this.writeRoster(tx, request, days, employeeIds);
    const attendanceDays = await this.writeAttendance(tx, request, days, employeeIds);
    const issues = await this.writeTasks(tx, request, employeeIds);

    return { issues, attendanceDays, rosterEntries };
  }

  // ─── The attendance schedule ───────────────────────────────────────────────

  /**
   * One row per person per day, which is what the clock-in later fills in.
   *
   * A company holiday inside the trip gets a row like any other day, flagged
   * (§8): the visit stays active, nobody files leave for it, and the same
   * geofence applies if the day is worked. Skipping the row would make the
   * holiday indistinguishable from a day nobody was scheduled.
   */
  private async writeAttendance(
    tx: Tx, request: ActivationRequest, days: Date[], employeeIds: number[],
  ): Promise<number> {
    const holidays = await tx.holiday.findMany({
      where: {
        companyId: request.companyId,
        date: { gte: request.startDate, lte: request.endDate },
      },
      select: { date: true },
    });
    const onHoliday = new Set<string>(
      holidays.map((h: any) => this.key(new Date(h.date))),
    );

    const rows = days.flatMap((visitDate) =>
      employeeIds.map((employeeId) => ({
        requestId: request.id,
        employeeId,
        companyId: request.companyId,
        visitDate,
        isHoliday: onHoliday.has(this.key(visitDate)),
        status: 'SCHEDULED',
      })),
    );

    // skipDuplicates leans on the unique index (requestId, employeeId,
    // visitDate): a re-approval after someone was added to the trip writes
    // only that person's days, and never disturbs a day already clocked.
    const written = await tx.fieldVisitAttendance.createMany({
      data: rows, skipDuplicates: true,
    });
    return written.count;
  }

  // ─── The roster ────────────────────────────────────────────────────────────

  /**
   * Tell the attendance system where these people are working.
   *
   * This is what makes a field visit day count as a working day at all: the
   * roster entry carries the project and the site, so the ordinary attendance
   * record comes out marked on-site against the right project, and the day's
   * clock window is the one the PM asked for rather than office hours.
   *
   * Conflicts are refused rather than overwritten. A trip that silently
   * stamped over somebody's rostered day off, or moved them off another
   * project's site, would be assigning them without the authorisation §10
   * exists to require — so the approver is told who and when, and the clash is
   * resolved deliberately.
   */
  private async writeRoster(
    tx: Tx, request: ActivationRequest, days: Date[], employeeIds: number[],
  ): Promise<number> {
    const existing = await tx.shiftRosterEntry.findMany({
      where: {
        companyId: request.companyId,
        employeeId: { in: employeeIds },
        date: { gte: request.startDate, lte: request.endDate },
      },
      select: {
        id: true, employeeId: true, date: true, isDayOff: true,
        projectId: true, shiftId: true,
      },
    });

    const byCell = new Map<string, any>(
      existing.map((e: any) => [`${e.employeeId}|${this.key(new Date(e.date))}`, e]),
    );

    const clashes: { employeeId: number; date: Date; why: string }[] = [];
    for (const employeeId of employeeIds) {
      for (const date of days) {
        const entry = byCell.get(`${employeeId}|${this.key(date)}`);
        if (!entry) continue;
        if (entry.isDayOff) {
          clashes.push({ employeeId, date, why: 'is rostered off' });
        } else if (entry.projectId && entry.projectId !== request.projectId) {
          clashes.push({ employeeId, date, why: 'is already on site for another project' });
        }
      }
    }
    if (clashes.length) await this.refuseClashes(tx, request, clashes);

    const note = this.rosterNote(request.requestNumber);
    const onsite = {
      projectId: request.projectId,
      address: request.location,
      startTime: request.startTime,
      endTime: request.endTime,
      onsiteApprovalStatus: 'NONE',
      isDayOff: false,
      note,
    };

    let written = 0;
    for (const employeeId of employeeIds) {
      for (const date of days) {
        const entry = byCell.get(`${employeeId}|${this.key(date)}`);
        if (entry) {
          // An empty cell, or this same trip being re-approved. The shift it
          // already had is kept: the visit changes where the day happens and
          // when it runs, not which shift the person is on.
          await tx.shiftRosterEntry.update({ where: { id: entry.id }, data: onsite });
        } else {
          // A day the standing shift calls non-working is still rostered here.
          // The PM asked for these days at the site, which is the whole point
          // of the request; leaving them unrostered would take the visit off
          // the schedule it was approved onto.
          await tx.shiftRosterEntry.create({
            data: {
              ...onsite,
              employeeId,
              companyId: request.companyId,
              date,
              // Null, so the effective shift falls back to the employee's
              // standing one — see ShiftRosterService.resolveEffectiveShift.
              shiftId: null,
            },
          });
        }
        written++;
      }
    }
    return written;
  }

  /** Name the people and the days, because "there is a clash" is unactionable. */
  private async refuseClashes(
    tx: Tx, request: ActivationRequest,
    clashes: { employeeId: number; date: Date; why: string }[],
  ): Promise<never> {
    const people = await tx.employee.findMany({
      where: {
        companyId: request.companyId,
        id: { in: [...new Set(clashes.map((c) => c.employeeId))] },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const name = new Map<number, string>(
      people.map((p: any) => [p.id, `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || `Employee ${p.id}`]),
    );

    const shown = clashes.slice(0, 5).map(
      (c) => `${name.get(c.employeeId)} ${c.why} on ${this.key(c.date)}`,
    );
    const rest = clashes.length - shown.length;
    throw new BadRequestException(
      `The roster disagrees with this trip: ${shown.join('; ')}`
      + `${rest > 0 ? ` (and ${rest} more)` : ''}.`
      + ' Sort the roster out, or send the request back for the dates to be changed.',
    );
  }

  // ─── The tasks ─────────────────────────────────────────────────────────────

  /**
   * One task per person per job of work (§2).
   *
   * Every selected task goes to every selected person: three people and four
   * tasks is twelve tasks, not four shared ones. It is more rows, but "who is
   * doing the site inspection" then has an answer per person, and each of them
   * has something of their own to clock against on the day.
   */
  private async writeTasks(
    tx: Tx, request: ActivationRequest, employeeIds: number[],
  ): Promise<number> {
    if (!request.tasks.length) return 0;

    const project = await tx.project.findFirst({
      where: { id: request.projectId, companyId: request.companyId },
      select: { id: true, key: true },
    });
    if (!project) return 0;

    // What this trip already put on the board, so a re-approval adds only what
    // is missing. Matched on person and title because that pair is what the
    // fan-out is defined by.
    const already = await tx.issue.findMany({
      where: { fieldVisitRequestId: request.id },
      select: { assigneeId: true, title: true },
    });
    const done = new Set<string>(
      already.map((i: any) => `${i.assigneeId}|${i.title}`),
    );

    const board = await tx.board.findFirst({
      where: { projectId: request.projectId },
      select: { columns: { orderBy: { position: 'asc' }, take: 1, select: { id: true } } },
    });
    const columnId = board?.columns?.[0]?.id ?? null;

    // New cards go above what is already in the column, the same way the board
    // places one raised by hand.
    const top = await tx.issue.findFirst({
      // Scoped to this project: a project with no board leaves columnId null,
      // and an unscoped `columnId: null` would read another company's board.
      where: { projectId: request.projectId, companyId: request.companyId, columnId },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    let position = top ? top.position - 1 : 0;

    let numbered = await tx.issue.count({
      where: { projectId: request.projectId, companyId: request.companyId },
    });

    let created = 0;
    for (const task of [...request.tasks].sort((a, b) => a.position - b.position)) {
      for (const employeeId of employeeIds) {
        if (done.has(`${employeeId}|${task.name}`)) continue;

        // The key is derived from a count, so two tasks created at once can
        // compute the same one. The unique index on (key, companyId) is what
        // decides; this walks the number up until it is free.
        for (let attempt = 0; ; attempt++) {
          try {
            await tx.issue.create({
              data: {
                key: `${project.key}-${numbered + 1}`,
                title: task.name,
                description: task.description,
                type: 'TASK',
                status: 'TODO',
                priority: 'MEDIUM',
                projectId: request.projectId,
                companyId: request.companyId,
                columnId,
                reporterId: request.raisedById,
                assigneeId: employeeId,
                position,
                // The task is the visit: it opens when the trip does and is due
                // when it ends, so it reads as work with a date on somebody's
                // board rather than an undated backlog item.
                startDate: request.startDate,
                dueDate: request.endDate,
                // Left unset deliberately. A task raised by hand must name its
                // phase, but approval is not a moment anyone can be asked to
                // pick one, and refusing the trip over it would be a blockade.
                phaseId: null,
                fieldVisitRequestId: request.id,
              },
            });
            numbered++;
            break;
          } catch (error: any) {
            if (error?.code === 'P2002' && attempt < 10) {
              numbered++;
              continue;
            }
            throw error;
          }
        }
        position--;
        created++;
      }
    }
    return created;
  }

  // ─── Undoing it ────────────────────────────────────────────────────────────

  /**
   * A trip that is called off has to let go of the days it claimed.
   *
   * The roster matters most: an entry left behind says somebody is working at
   * a client site, which the attendance system reads as a reason to exempt
   * them from the office geofence. A cancelled trip must not leave that behind.
   *
   * Days already clocked are kept. They happened, whatever the trip's status
   * became afterwards, and deleting them would erase attendance somebody was
   * present for. Tasks are archived rather than deleted for the same reason —
   * work may have been logged against them.
   */
  async deactivate(
    tx: Tx, request: ActivationRequest, actorId: number | null,
  ): Promise<{ attendanceDays: number; rosterEntries: number; issues: number }> {
    const note = this.rosterNote(request.requestNumber);

    // Found by the note alone, which carries the request number and so is
    // unique within the company. Filtering by the current members and dates
    // would strand the entries of somebody since removed from the trip —
    // exactly the rows that most need clearing.
    const rosterRows = await tx.shiftRosterEntry.findMany({
      where: { companyId: request.companyId, note },
      select: { id: true, shiftId: true },
    });

    // A row this feature created carries no shift of its own; one it adopted
    // kept the shift that was already on it. So the first kind goes, and the
    // second is handed back the way it was found.
    const created = rosterRows.filter((r: any) => r.shiftId == null).map((r: any) => r.id);
    const adopted = rosterRows.filter((r: any) => r.shiftId != null).map((r: any) => r.id);

    if (created.length) {
      await tx.shiftRosterEntry.deleteMany({ where: { id: { in: created } } });
    }
    if (adopted.length) {
      await tx.shiftRosterEntry.updateMany({
        where: { id: { in: adopted } },
        data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
      });
    }

    const attendance = await tx.fieldVisitAttendance.deleteMany({
      where: { requestId: request.id, clockInTime: null },
    });

    const issues = await tx.issue.updateMany({
      where: { fieldVisitRequestId: request.id, isArchived: false },
      data: { isArchived: true },
    });

    return {
      attendanceDays: attendance.count,
      rosterEntries: rosterRows.length,
      issues: issues.count,
    };
  }

  // ─── When somebody goes on leave ───────────────────────────────────────────

  /** The same calendar day the visit rows are keyed on, from any instant. */
  private dayKey(value: Date): Date {
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
  }

  /**
   * Approved trips this person is expected on between two dates (§9).
   *
   * Read before a leave request is filed, so the employee is told they are on
   * a trip rather than finding out when the day is quietly taken off them, and
   * so the approver is ruling on a request they can see the cost of.
   */
  async conflictsFor(
    tx: Tx, employeeId: number, companyId: number, from: Date, to: Date,
  ): Promise<{ requestNumber: string; location: string; days: number; dates: string[] }[]> {
    const days = await tx.fieldVisitAttendance.findMany({
      where: {
        employeeId,
        companyId,
        visitDate: { gte: this.dayKey(from), lte: this.dayKey(to) },
        // A day already covered by leave is not a fresh clash.
        status: { in: OPEN_VISIT_DAYS },
        request: { status: 'APPROVED' },
      },
      select: {
        visitDate: true,
        request: { select: { requestNumber: true, location: true } },
      },
      orderBy: { visitDate: 'asc' },
    });

    const byRequest = new Map<string, { requestNumber: string; location: string; days: number; dates: string[] }>();
    for (const day of days) {
      const found = byRequest.get(day.request.requestNumber) ?? {
        requestNumber: day.request.requestNumber,
        location: day.request.location,
        days: 0,
        dates: [] as string[],
      };
      found.days++;
      found.dates.push(this.key(new Date(day.visitDate)));
      byRequest.set(day.request.requestNumber, found);
    }
    return [...byRequest.values()];
  }

  /**
   * Leave was approved, so the trip gives those days back (§9).
   *
   * Only the days actually covered, and only this one person's: a colleague's
   * approved leave is no reason to take the trip off everybody else. Days
   * already clocked are left alone — somebody was at the site that day, and
   * leave approved afterwards does not unmake the attendance.
   *
   * A half day is not a release. The person is still expected on site for the
   * other half, and dropping the whole day would take them off a visit they
   * are attending — so it is recorded on the trip and nothing is removed.
   */
  async releaseDaysForLeave(
    tx: Tx,
    leave: {
      employeeId: number; companyId: number;
      from: Date; to: Date; isHalfDay?: boolean; actorId: number | null;
    },
  ): Promise<{ requestId: number; requestNumber: string; raisedById: number; days: number; archivedTasks: number }[]> {
    const affected = await tx.fieldVisitAttendance.findMany({
      where: {
        employeeId: leave.employeeId,
        companyId: leave.companyId,
        visitDate: { gte: this.dayKey(leave.from), lte: this.dayKey(leave.to) },
        clockInTime: null,
        status: { in: OPEN_VISIT_DAYS },
        request: { status: 'APPROVED' },
      },
      select: {
        id: true, visitDate: true,
        request: { select: { id: true, requestNumber: true, raisedById: true } },
      },
      orderBy: { visitDate: 'asc' },
    });
    if (!affected.length) return [];

    type Group = { requestNumber: string; raisedById: number; ids: number[]; dates: Date[] };
    const byRequest = new Map<number, Group>();
    for (const day of affected) {
      const found: Group = byRequest.get(day.request.id) ?? {
        requestNumber: day.request.requestNumber,
        raisedById: day.request.raisedById,
        ids: [], dates: [],
      };
      found.ids.push(day.id);
      found.dates.push(new Date(day.visitDate));
      byRequest.set(day.request.id, found);
    }

    const released: { requestId: number; requestNumber: string; raisedById: number; days: number; archivedTasks: number }[] = [];

    for (const [requestId, group] of byRequest) {
      const span = `${this.key(group.dates[0])}${group.dates.length > 1 ? ` to ${this.key(group.dates[group.dates.length - 1])}` : ''}`;

      if (leave.isHalfDay) {
        await tx.fieldVisitRequestActivity.create({
          data: {
            requestId, action: 'MEMBER_HALF_DAY',
            detail: `Employee ${leave.employeeId} has approved half-day leave on ${span} — still expected on site`,
            actorId: leave.actorId as number,
          },
        });
        released.push({
          requestId, requestNumber: group.requestNumber,
          raisedById: group.raisedById, days: 0, archivedTasks: 0,
        });
        continue;
      }

      // Marked, not deleted. A deleted day is a hole the Delivery view cannot
      // explain — §11 asks it to show leave status, and a row that says
      // ON_LEAVE is the only way it can. The clock refuses these days, and the
      // roster entry still goes, so the on-site geofence exemption goes with it.
      await tx.fieldVisitAttendance.updateMany({
        where: { id: { in: group.ids } },
        data: { status: FIELD_VISIT_DAY.ON_LEAVE },
      });
      await this.releaseRoster(tx, leave.employeeId, leave.companyId, group.requestNumber, group.dates);

      // Only if the leave swallowed their whole trip. Somebody away for one
      // day of three still has the work; archiving it would leave them back on
      // site with nothing assigned. Days they are on leave for do not count as
      // still being expected.
      const remaining = await tx.fieldVisitAttendance.count({
        where: {
          requestId,
          employeeId: leave.employeeId,
          status: { in: OPEN_VISIT_DAYS },
        },
      });
      let archivedTasks = 0;
      if (remaining === 0) {
        const archived = await tx.issue.updateMany({
          where: {
            fieldVisitRequestId: requestId,
            assigneeId: leave.employeeId,
            isArchived: false,
          },
          data: { isArchived: true },
        });
        archivedTasks = archived.count;
      }

      await tx.fieldVisitRequestActivity.create({
        data: {
          requestId, action: 'MEMBER_ON_LEAVE',
          detail: `Employee ${leave.employeeId} on approved leave ${span} — ${group.ids.length} day(s) released`
            + `${archivedTasks ? `, ${archivedTasks} task(s) archived` : ''}`,
          actorId: leave.actorId as number,
        },
      });

      released.push({
        requestId, requestNumber: group.requestNumber,
        raisedById: group.raisedById, days: group.ids.length, archivedTasks,
      });
    }

    return released;
  }

  /**
   * Hand back the roster cells for the days being released.
   *
   * Left behind, they would say this person is at a client site on a day they
   * are on leave — which is both wrong on the roster and, because on-site days
   * skip the office geofence, a hole in the attendance rules.
   */
  private async releaseRoster(
    tx: Tx, employeeId: number, companyId: number, requestNumber: string, dates: Date[],
  ): Promise<void> {
    const rows = await tx.shiftRosterEntry.findMany({
      where: {
        companyId, employeeId,
        note: this.rosterNote(requestNumber),
        date: { in: dates },
      },
      select: { id: true, shiftId: true },
    });
    if (!rows.length) return;

    const created = rows.filter((r: any) => r.shiftId == null).map((r: any) => r.id);
    const adopted = rows.filter((r: any) => r.shiftId != null).map((r: any) => r.id);

    if (created.length) {
      await tx.shiftRosterEntry.deleteMany({ where: { id: { in: created } } });
    }
    if (adopted.length) {
      await tx.shiftRosterEntry.updateMany({
        where: { id: { in: adopted } },
        data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
      });
    }
  }

  // ─── When an approved trip changes ─────────────────────────────────────────

  /**
   * Make the work match the trip again, after §10's re-approval changed it.
   *
   * `activate` only ever adds, which is right for a first approval and useless
   * for a second: somebody taken off the trip keeps their tasks, and a day
   * moved out of the range keeps its attendance row. So this takes away what
   * the new shape no longer asks for, then lets `activate` fill in the rest.
   *
   * What it will not take away is a day somebody already clocked. The trip can
   * be rescheduled around them, but their attendance happened, and a record of
   * where somebody was is not the change's to erase.
   */
  async reconcile(
    tx: Tx, request: ActivationRequest, actorId: number | null,
  ): Promise<ActivationResult & { releasedDays: number; archivedTasks: number }> {
    const days = this.daysOf(request);
    const employeeIds = request.members.map((m) => m.employeeId);
    const wantedDays = new Set(days.map((d) => this.key(d)));
    const wantedTasks = new Set(request.tasks.map((t) => t.name));

    const releasedDays = await this.dropStaleDays(tx, request, employeeIds, wantedDays);
    await this.dropStaleRoster(tx, request, employeeIds, wantedDays);
    const archivedTasks = await this.dropStaleTasks(tx, request, employeeIds, wantedTasks);

    const added = await this.activate(tx, request, actorId);
    return { ...added, releasedDays, archivedTasks };
  }

  /** Attendance rows the new shape has no room for — never a clocked one. */
  private async dropStaleDays(
    tx: Tx, request: ActivationRequest, employeeIds: number[], wantedDays: Set<string>,
  ): Promise<number> {
    const existing = await tx.fieldVisitAttendance.findMany({
      where: { requestId: request.id, clockInTime: null },
      select: { id: true, employeeId: true, visitDate: true },
    });

    const stale = existing
      .filter((d: any) =>
        !employeeIds.includes(d.employeeId) || !wantedDays.has(this.key(new Date(d.visitDate))))
      .map((d: any) => d.id);
    if (!stale.length) return 0;

    const dropped = await tx.fieldVisitAttendance.deleteMany({ where: { id: { in: stale } } });
    return dropped.count;
  }

  /**
   * The roster cells for days this trip no longer claims.
   *
   * These matter more than they look: a cell left behind says somebody is at a
   * client site on a day the trip no longer covers, and an on-site day is
   * exempt from the office geofence.
   */
  private async dropStaleRoster(
    tx: Tx, request: ActivationRequest, employeeIds: number[], wantedDays: Set<string>,
  ): Promise<void> {
    const rows = await tx.shiftRosterEntry.findMany({
      where: { companyId: request.companyId, note: this.rosterNote(request.requestNumber) },
      select: { id: true, employeeId: true, date: true, shiftId: true },
    });

    const stale = rows.filter((r: any) =>
      !employeeIds.includes(r.employeeId) || !wantedDays.has(this.key(new Date(r.date))));
    if (!stale.length) return;

    const created = stale.filter((r: any) => r.shiftId == null).map((r: any) => r.id);
    const adopted = stale.filter((r: any) => r.shiftId != null).map((r: any) => r.id);

    if (created.length) {
      await tx.shiftRosterEntry.deleteMany({ where: { id: { in: created } } });
    }
    if (adopted.length) {
      await tx.shiftRosterEntry.updateMany({
        where: { id: { in: adopted } },
        data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
      });
    }
  }

  /**
   * Tasks for people no longer going, or for work no longer on the list.
   *
   * Archived, not deleted: time may have been logged against them, and a task
   * somebody worked on is not a row to make disappear because the plan moved.
   */
  private async dropStaleTasks(
    tx: Tx, request: ActivationRequest, employeeIds: number[], wantedTasks: Set<string>,
  ): Promise<number> {
    const issues = await tx.issue.findMany({
      where: { fieldVisitRequestId: request.id, isArchived: false },
      select: { id: true, assigneeId: true, title: true },
    });

    const stale = issues
      .filter((i: any) => !employeeIds.includes(i.assigneeId) || !wantedTasks.has(i.title))
      .map((i: any) => i.id);
    if (!stale.length) return 0;

    const archived = await tx.issue.updateMany({
      where: { id: { in: stale } },
      data: { isArchived: true },
    });
    return archived.count;
  }
}
