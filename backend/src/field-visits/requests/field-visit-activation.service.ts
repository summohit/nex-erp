import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { FIELD_VISIT_DAY, OPEN_VISIT_DAYS } from '../field-visit-status';
import { ShiftRosterService } from '../../attendance/shift-roster.service';

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
  /**
   * The trip's scope. `issueId` is set when the line points at a task that
   * already exists on the project, which approval adopts; it is null for a line
   * describing new work, which approval turns into a card per person.
   */
  tasks: {
    id: number; name: string; description: string | null; position: number;
    issueId?: number | null;
  }[];
}

export interface ActivationResult {
  issues: number;
  attendanceDays: number;
  rosterEntries: number;
  /** Comp-Off days newly credited for non-working days on the trip. */
  compOffDays?: number;
}

type CompOffReason = 'HOLIDAY' | 'WEEK_OFF' | 'DAY_OFF';

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
    /**
     * overrideDayOff: the approver has been shown which rostered days off the
     * trip lands on and chosen to roster the person on site anyway. Never set
     * implicitly — see writeRoster.
     */
    opts: { overrideDayOff?: boolean } = {},
  ): Promise<ActivationResult> {
    const days = this.daysOf(request);
    const employeeIds = request.members.map((m) => m.employeeId);

    // Read BEFORE the roster is written: writing it is what turns a day off
    // into an on-site day, after which there is no telling it was ever off.
    const nonWorking = await this.nonWorkingDays(tx, request, days, employeeIds);

    const rosterEntries = await this.writeRoster(tx, request, days, employeeIds, opts);
    const attendanceDays = await this.writeAttendance(tx, request, days, employeeIds);
    const issues = await this.writeTasks(tx, request, employeeIds);
    const compOffDays = await this.syncCompOff(tx, request, days, employeeIds, nonWorking);

    return { issues, attendanceDays, rosterEntries, compOffDays };
  }

  // ─── Comp-Off ──────────────────────────────────────────────────────────────

  /**
   * Which trip days are not working days for whom, and why.
   *
   * A company holiday first; then an explicit rostered day off (the case the
   * approver has just chosen to override); then a day the person's shift does
   * not work — a weekend, usually. Resolved through the same rule clock-in uses,
   * so "week off" means what it means everywhere else.
   */
  private async nonWorkingDays(
    tx: Tx, request: ActivationRequest, days: Date[], employeeIds: number[],
  ): Promise<Map<string, CompOffReason>> {
    const out = new Map<string, CompOffReason>();
    if (!employeeIds.length || !days.length) return out;
    const note = this.rosterNote(request.requestNumber);

    const [holidays, entries, employees] = await Promise.all([
      tx.holiday.findMany({
        where: { companyId: request.companyId, date: { gte: request.startDate, lte: request.endDate } },
        select: { date: true },
      }),
      tx.shiftRosterEntry.findMany({
        where: {
          companyId: request.companyId,
          employeeId: { in: employeeIds },
          date: { gte: request.startDate, lte: request.endDate },
        },
        include: { shift: true },
      }),
      tx.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, shift: true },
      }),
    ]);

    const holiday = new Set<string>(holidays.map((h: any) => this.key(new Date(h.date))));
    const standing = new Map<number, any>(employees.map((e: any) => [e.id, e.shift ?? null]));
    const entryAt = new Map<string, any>(
      entries.map((e: any) => [`${e.employeeId}|${this.key(new Date(e.date))}`, e]),
    );

    for (const employeeId of employeeIds) {
      for (const date of days) {
        const k = `${employeeId}|${this.key(date)}`;
        if (holiday.has(this.key(date))) { out.set(k, 'HOLIDAY'); continue; }

        let entry = entryAt.get(k) ?? null;
        // This trip's own row from an earlier approval says nothing about
        // whether the day was off — it is the trip. Judge by the shift instead.
        if (entry?.note === note) entry = null;
        if (entry?.isDayOff) { out.set(k, 'DAY_OFF'); continue; }

        const effective = ShiftRosterService.resolveEffectiveShift(
          entry, standing.get(employeeId) ?? null, date,
        );
        if (effective.isDayOff) out.set(k, 'WEEK_OFF');
      }
    }
    return out;
  }

  /**
   * Make the trip's Comp-Off credits match the trip.
   *
   * Adds a day for each non-working day not yet credited, and takes back the
   * credits for days or people the trip no longer covers. Never removes a credit
   * for a day still inside the trip: on re-approval the roster already shows the
   * trip on that day, so whether it was originally off can no longer be read —
   * the ledger is the record of that.
   */
  private async syncCompOff(
    tx: Tx, request: ActivationRequest, days: Date[], employeeIds: number[],
    nonWorking: Map<string, CompOffReason>,
  ): Promise<number> {
    const existing = await tx.compOffCredit.findMany({
      where: { fieldVisitRequestId: request.id },
    });
    const have = new Set<string>(existing.map((c: any) => `${c.employeeId}|${this.key(new Date(c.date))}`));
    const covered = new Set<string>();
    for (const e of employeeIds) for (const d of days) covered.add(`${e}|${this.key(d)}`);

    const stale = existing.filter((c: any) => !covered.has(`${c.employeeId}|${this.key(new Date(c.date))}`));
    await this.reverseCredits(tx, stale);

    const toAdd = [...nonWorking.entries()].filter(([k]) => !have.has(k));
    if (!toAdd.length) return 0;

    const leaveTypeId = await this.compOffLeaveType(tx, request.companyId);
    for (const [k, reason] of toAdd) {
      const [employeeIdText, day] = k.split('|');
      const employeeId = Number(employeeIdText);
      const date = new Date(`${day}T00:00:00.000Z`);
      const year = date.getUTCFullYear();

      await tx.compOffCredit.create({
        data: {
          companyId: request.companyId, employeeId, leaveTypeId,
          fieldVisitRequestId: request.id, date, reason, days: 1, year,
        },
      });
      await tx.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } },
        update: { allocated: { increment: 1 } },
        create: { employeeId, leaveTypeId, year, allocated: 1, used: 0 },
      });
    }
    return toAdd.length;
  }

  /**
   * Take back credits, and the balance they added.
   *
   * The balance can end up below what has been used if the day was already
   * taken — that is left visible rather than hidden, because the trip it was
   * earned on no longer happened.
   */
  private async reverseCredits(tx: Tx, credits: any[]): Promise<number> {
    for (const c of credits) {
      await tx.compOffCredit.delete({ where: { id: c.id } });
      await tx.leaveBalance.updateMany({
        where: { employeeId: c.employeeId, leaveTypeId: c.leaveTypeId, year: c.year },
        data: { allocated: { decrement: c.days ?? 1 } },
      });
    }
    return credits.length;
  }

  /** The company's Comp-Off leave type — flagged, or created on first use. */
  private async compOffLeaveType(tx: Tx, companyId: number): Promise<number> {
    const found = await tx.leaveType.findFirst({
      where: { companyId, isCompOff: true },
      select: { id: true },
    });
    if (found) return found.id;
    const created = await tx.leaveType.create({
      data: {
        name: 'Comp-Off',
        description: 'Compensatory day off, earned by working a holiday, week off or rostered day off.',
        defaultDays: 0,
        accrualFrequency: 'NONE',
        accrualAmount: 0,
        isPaid: true,
        isCompOff: true,
        companyId,
      },
      select: { id: true },
    });
    return created.id;
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
    opts: { overrideDayOff?: boolean } = {},
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
          // Overridable, but only when the approver has explicitly said so
          // after being shown the days. Working someone on their day off is a
          // decision; it must not be a side effect of clicking Approve.
          if (!opts.overrideDayOff) clashes.push({ employeeId, date, why: 'is rostered off' });
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
    // Only days off can be overridden from the approval. Being on site for
    // another project cannot: that would pull the person off someone else's
    // work, and needs that roster changed first.
    const onlyDaysOff = clashes.every((c) => c.why === 'is rostered off');
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      code: onlyDaysOff ? 'ROSTER_DAY_OFF_CLASH' : 'ROSTER_CLASH',
      message:
        `The roster disagrees with this trip: ${shown.join('; ')}`
        + `${rest > 0 ? ` (and ${rest} more)` : ''}.`
        + (onlyDaysOff
          ? ' You can approve anyway and roster them on site for those days, or send the request back for the dates to be changed.'
          : ' Sort the roster out, or send the request back for the dates to be changed.'),
    });
  }

  // ─── The tasks ─────────────────────────────────────────────────────────────

  /**
   * One task per person per job of work (§2).
   *
   * Every selected task goes to every selected person: three people and four
   * tasks is twelve tasks, not four shared ones. It is more rows, but "who is
   * doing the site inspection" then has an answer per person, and each of them
   * has something of their own to clock against on the day.
   *
   * The exception is a task the trip *adopted* rather than described. That one
   * already exists on the project board, with its own key, its own history and
   * probably hours logged against it. Making a second card with the same title
   * would leave the board and the trip asserting two separate pieces of work
   * that are the same piece of work, and would strand the real task with
   * nothing to show it is happening. So the card is left alone and each person
   * going is added to it instead, which is what puts it in front of them on the
   * day without rewriting what the task is.
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

    const ordered = [...request.tasks].sort((a, b) => a.position - b.position);

    // Adopted first: they need no board, no key and no column, and doing them
    // first keeps the counting below about cards that were actually minted.
    const linked = await this.attachLinkedTasks(tx, request, ordered, employeeIds);

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

    const described = ordered.filter((t) => t.issueId == null);
    if (!described.length) return linked;

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

    /**
     * Task keys come from the project's counter, the same one every other
     * writer draws from.
     *
     * This numbered from `tx.issue.count()` instead, which reads the rows but
     * never advances `Project.issueSeq`. Activating a visit therefore minted
     * keys the counter knew nothing about, and the next task raised by hand
     * incremented the counter straight onto a number one of these already
     * held. @@unique([key, companyId]) rejected it, the surrounding
     * transaction rolled the increment back with it, and every later attempt
     * collided on that same number -- task creation stayed wedged for good
     * rather than failing once.
     */
    const nextKey = async (): Promise<string> => {
      const { issueSeq } = await tx.project.update({
        where: { id: request.projectId },
        data: { issueSeq: { increment: 1 } },
        select: { issueSeq: true },
      });
      return `${project.key}-${issueSeq}`;
    };

    let created = 0;
    for (const task of described) {
      for (const employeeId of employeeIds) {
        if (done.has(`${employeeId}|${task.name}`)) continue;

        // No retry around this any more. Incrementing the counter row-locks
        // the project, so concurrent callers cannot be handed the same key
        // and there is nothing left to walk up. The loop it replaces could
        // not have worked here regardless: Postgres aborts the whole
        // transaction on a failed statement, so catching P2002 inside one and
        // carrying on only turns the error into "current transaction is
        // aborted" on the following write.
        await tx.issue.create({
          data: {
            key: await nextKey(),
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

        position--;
        created++;
      }
    }
    return created + linked;
  }

  /**
   * The tasks picked off the board, as the trip's work — without touching who
   * they belong to.
   *
   * This used to make everyone going a member of every adopted task, so that
   * any of them could clock in against any of it. That put each person on the
   * others' tasks: three people and eight tasks became twenty-four
   * memberships, and everyone's My Tasks filled with their colleagues' work.
   * Each task now stays with the people the board already gives it, and the
   * field visit clock offers a person only the visit's tasks that are theirs.
   *
   * Returns how many of the adopted tasks belong to someone going, which is
   * what the approval reports as assigned work.
   */
  private async attachLinkedTasks(
    tx: Tx, request: ActivationRequest,
    tasks: ActivationRequest['tasks'], employeeIds: number[],
  ): Promise<number> {
    const issueIds = tasks
      .map((t) => t.issueId)
      .filter((id): id is number => Number.isInteger(id));
    if (!issueIds.length || !employeeIds.length) return 0;

    return tx.issue.count({
      where: {
        id: { in: issueIds },
        OR: [
          { assigneeId: { in: employeeIds } },
          { members: { some: { employeeId: { in: employeeIds } } } },
        ],
      },
    });
  }

  /**
   * Take back the memberships an earlier version of approval added.
   *
   * Nothing adds them any more (see attachLinkedTasks), but trips approved
   * before that still have them; cancelling one clears them as before.
   *
   * Scoped by the marker rather than by "who is on this task", because the two
   * are not the same set: somebody assigned on the board before the trip was
   * raised stays assigned when it is cancelled. Scoped by the request id for
   * the same reason a cancelled trip's roster entries are found by note alone —
   * filtering on the current shape would strand the rows of people already
   * taken off the trip, which are the ones most in need of clearing.
   */
  private async releaseLinkedTasks(tx: Tx, request: ActivationRequest): Promise<number> {
    const { count } = await tx.issueMember.deleteMany({
      where: { fieldVisitRequestId: request.id },
    });
    return count;
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

    // Adopted tasks are not archived — they are the project's own and outlive
    // the trip. What the trip owes them is undone instead: everybody it put on
    // them comes off again.
    const released = await this.releaseLinkedTasks(tx, request);

    // A trip that is called off earned nothing.
    const credits = await tx.compOffCredit.findMany({ where: { fieldVisitRequestId: request.id } });
    await this.reverseCredits(tx, credits);

    return {
      attendanceDays: attendance.count,
      rosterEntries: rosterRows.length,
      issues: issues.count + released,
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

  /**
   * Put somebody back on their own shift after leave over those days goes away
   * (§Att10).
   *
   * Cancelling leave does NOT put them back on the trip. By the time the leave
   * was approved the days were released, their tasks may have been archived and
   * somebody else was very likely asked to cover; silently restoring all of it
   * would resurrect a plan that has moved on. The trip keeps its ON_LEAVE days
   * and the person goes back to ordinary work, which is what "returns to the
   * general shift" means.
   *
   * So this only clears on-site residue: a roster cell still naming a project,
   * an address or a bespoke clock window for a day nobody is going to site.
   * Left behind, it would claim they are at a client site — and because on-site
   * days skip the office geofence, it is a hole in the attendance rules as well
   * as a wrong roster.
   *
   * Deliberately does not touch `isDayOff`, or a cell whose shift somebody set
   * on purpose. A manager rostering them to nights that week made a decision
   * that has nothing to do with the leave, and undoing it would be this
   * function exceeding what it knows.
   *
   * Idempotent: with nothing to clear it does nothing, which is the normal case
   * for leave that never touched a trip.
   */
  async restoreStandingShiftAfterLeave(
    tx: Tx,
    leave: { employeeId: number; companyId: number; from: Date; to: Date },
  ): Promise<number> {
    const rows = await tx.shiftRosterEntry.findMany({
      where: {
        companyId: leave.companyId,
        employeeId: leave.employeeId,
        date: { gte: this.dayKey(leave.from), lte: this.dayKey(leave.to) },
        OR: [
          { projectId: { not: null } },
          { address: { not: null } },
        ],
      },
      select: { id: true, shiftId: true },
    });
    if (!rows.length) return 0;

    // A cell with no shift of its own existed only to carry the on-site
    // details. Emptied, it says nothing, and an empty row is not the same as
    // no row: the resolver reads a row as an override. Remove it so the
    // standing shift applies.
    const empty = rows.filter((r: any) => r.shiftId == null).map((r: any) => r.id);
    const kept = rows.filter((r: any) => r.shiftId != null).map((r: any) => r.id);

    if (empty.length) {
      await tx.shiftRosterEntry.deleteMany({ where: { id: { in: empty } } });
    }
    if (kept.length) {
      await tx.shiftRosterEntry.updateMany({
        where: { id: { in: kept } },
        data: { projectId: null, address: null, startTime: null, endTime: null, note: null },
      });
    }
    return rows.length;
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
   *
   * The query is on `fieldVisitRequestId`, which is what the trip created
   * rather than adopted — an adopted task has no such id and so cannot be swept
   * up here, which is exactly right. What does need undoing for those is the
   * membership, and only for people who are off the trip or a task that is no
   * longer on the list; a re-approval that merely reordered the scope must not
   * take somebody off a task they are still going to be on.
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

    // Not an early return on the created cards: a trip whose only scope is
    // adopted tasks has no cards to archive at all, and would otherwise never
    // reach the membership cleanup below.
    const archived = stale.length
      ? await tx.issue.updateMany({ where: { id: { in: stale } }, data: { isArchived: true } })
      : { count: 0 };

    const wantedIssues = new Set(
      request.tasks.map((t) => t.issueId).filter((id): id is number => id != null),
    );
    const { count: released } = await tx.issueMember.deleteMany({
      where: {
        fieldVisitRequestId: request.id,
        OR: [
          { employeeId: { notIn: employeeIds } },
          { issueId: { notIn: [...wantedIssues] } },
        ],
      },
    });

    return archived.count + released;
  }
}
