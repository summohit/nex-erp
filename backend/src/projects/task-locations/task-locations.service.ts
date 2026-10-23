import {
  Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger,
  OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TasksGateway } from '../../events/tasks/tasks.gateway';
import { canManageTask } from '../../tasks/task-permissions';
import { assertWithinAllowedHours, HoursExceeded } from '../../tasks/task-hours';
import { isCompanyAdmin } from '../../common/company-roles';
import {
  resolveProjectViewer, taskVisibilityFilter, hasCompanyWideProjectAccess, PROJECT_ROLE, seesEveryTask,
} from '../project-roles';
import {
  LOCATION_STATUS, LOCATION_STATUSES, LOCATION_LEVELS,
  locationHasHistory, locationProgress, parentStatusFor, isLocationOverdue,
  EMPLOYEE_LOCATION_STATUSES, isOwnLocation, LOCATION_TRACKING_ENABLED,
} from './location-rules';

const PERSON = { id: true, firstName: true, lastName: true, avatarUrl: true } as const;

const LOCATION_INCLUDE = {
  location: {
    select: {
      id: true, name: true, code: true, level: true, parentId: true,
      parent: { select: { id: true, name: true, level: true, parentId: true } },
    },
  },
  assignees: { include: { employee: { select: PERSON } } },
  _count: { select: { attachments: true, timeLogs: true } },
} as const;

const HOUR_MS = 60 * 60 * 1000;

export interface LocationDraft {
  status: string;
  startDate: string;
  dueDate: string;
  assigneeIds: number[];
  remarks?: string | null;
  blockedReason?: string | null;
}

/**
 * Location-wise execution of one parent task (docs/location-task-tracking.md).
 *
 * The parent Issue keeps everything common; each IssueLocation is one place
 * the work has to happen, with its own status, people, dates and evidence.
 * Time and attachments stay rows of the parent task, tagged with a location,
 * so nothing that already sums a task's hours or files has to change.
 */
@Injectable()
export class TaskLocationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskLocationsService.name);
  private timer: NodeJS.Timeout | undefined;
  private processing = false;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private tasksGateway: TasksGateway,
  ) {}

  // ── Overdue notices ─────────────────────────────────────────────────────

  onModuleInit() {
    // setInterval rather than @nestjs/schedule, as IssueRemindersCron does.
    // Hourly is plenty: a due date is a day, not a minute.
    setTimeout(() => this.notifyOverdue(), 30_000);
    this.timer = setInterval(() => this.notifyOverdue(), HOUR_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One notice per overdue location, ever — `overdueNotifiedAt` remembers. */
  async notifyOverdue(now: Date = new Date()) {
    if (this.processing) return;
    this.processing = true;
    try {
      const due = await this.prisma.issueLocation.findMany({
        where: {
          removedAt: null,
          overdueNotifiedAt: null,
          status: { not: LOCATION_STATUS.COMPLETED },
          dueDate: { lt: now },
          issue: { isArchived: false, status: { notIn: ['DONE', 'CANCELLED'] } },
        },
        include: {
          location: { select: { name: true } },
          assignees: { select: { employeeId: true } },
          issue: { select: { id: true, key: true, title: true, projectId: true, reporterId: true, assigneeId: true } },
        },
        take: 500,
      });
      for (const row of due) {
        // Claim the row first so a slow notification never sends twice.
        const claimed = await this.prisma.issueLocation.updateMany({
          where: { id: row.id, overdueNotifiedAt: null },
          data: { overdueNotifiedAt: now },
        });
        if (!claimed.count) continue;
        const people = row.assignees.length
          ? row.assignees.map((a) => a.employeeId)
          : [row.issue.assigneeId];
        await this.notifications.notifyEmployees([...people, row.issue.reporterId], {
          companyId: row.companyId,
          title: 'Location overdue',
          message: `${row.issue.key} "${row.issue.title}" is overdue at ${row.location.name}.`,
          type: 'WARNING',
          linkUrl: `/projects/${row.issue.projectId}`,
        });
      }
    } catch (e) {
      this.logger.error('Overdue location check failed', e as any);
    } finally {
      this.processing = false;
    }
  }

  // ── Master data ─────────────────────────────────────────────────────────

  private assertAdmin(role?: string) {
    if (!isCompanyAdmin(role)) {
      throw new ForbiddenException('Only an administrator can change task locations.');
    }
  }

  async listLocations(companyId: number, activeOnly: boolean) {
    const rows = await this.prisma.taskLocation.findMany({
      // A project's own sites are not in the company-wide list (23 Oct 2026).
      where: { companyId, projectId: null, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { executions: true } } },
    });
    return rows.map(({ _count, ...r }) => ({ ...r, usageCount: _count.executions }));
  }

  private async validParent(companyId: number, parentId: any, level: string) {
    if (parentId == null || parentId === '') {
      if (level !== 'STATE') throw new BadRequestException(`A ${level.toLowerCase()} needs a parent location.`);
      return null;
    }
    const parent = await this.prisma.taskLocation.findFirst({ where: { id: Number(parentId), companyId } });
    if (!parent) throw new BadRequestException('That parent location does not exist.');
    return parent.id;
  }

  private normaliseLevel(level: any): string {
    const l = String(level || 'STATE').toUpperCase();
    if (!LOCATION_LEVELS.includes(l)) throw new BadRequestException(`Level must be one of ${LOCATION_LEVELS.join(', ')}.`);
    return l;
  }

  async createLocation(companyId: number, role: string, data: any) {
    this.assertAdmin(role);
    const name = String(data?.name ?? '').trim();
    if (!name) throw new BadRequestException('A location needs a name.');
    const level = this.normaliseLevel(data.level);
    const parentId = await this.validParent(companyId, data.parentId, level);
    const clash = await this.prisma.taskLocation.findFirst({
      where: { companyId, parentId, name: { equals: name, mode: 'insensitive' } },
    });
    if (clash) throw new BadRequestException(`"${name}" already exists there.`);
    return this.prisma.taskLocation.create({
      data: {
        companyId, name, level, parentId,
        code: String(data.code ?? '').trim() || null,
        position: Number(data.position) || 0,
      },
    });
  }

  /** One name per line. Names that already exist under the parent are skipped, not errors. */
  async bulkCreate(companyId: number, role: string, data: any) {
    this.assertAdmin(role);
    const level = this.normaliseLevel(data?.level);
    const parentId = await this.validParent(companyId, data?.parentId, level);
    const names: string[] = (Array.isArray(data?.names) ? data.names : String(data?.names ?? '').split('\n'))
      .map((n: any) => String(n).trim())
      .filter(Boolean);
    if (!names.length) throw new BadRequestException('Add at least one name.');

    const existing = await this.prisma.taskLocation.findMany({
      where: { companyId, parentId }, select: { name: true },
    });
    // Case-insensitive, against what exists and within the paste itself.
    const taken = new Set(existing.map((e) => e.name.toLowerCase()));
    const fresh = names.filter((n) => {
      const key = n.toLowerCase();
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
    if (fresh.length) {
      await this.prisma.taskLocation.createMany({
        data: fresh.map((name, i) => ({ companyId, name, level, parentId, position: existing.length + i })),
      });
    }
    return { created: fresh.length, skipped: names.length - fresh.length };
  }

  async updateLocation(companyId: number, role: string, id: number, data: any) {
    this.assertAdmin(role);
    const loc = await this.prisma.taskLocation.findFirst({ where: { id, companyId } });
    if (!loc) throw new NotFoundException('Location not found');
    const update: any = {};
    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (!name) throw new BadRequestException('A location needs a name.');
      update.name = name;
    }
    if (data.code !== undefined) update.code = String(data.code ?? '').trim() || null;
    if (data.isActive !== undefined) update.isActive = !!data.isActive;
    if (data.position !== undefined) update.position = Number(data.position) || 0;
    if (data.level !== undefined) update.level = this.normaliseLevel(data.level);
    if (data.parentId !== undefined) {
      const parentId = await this.validParent(companyId, data.parentId, update.level ?? loc.level);
      if (parentId != null && (await this.descendantIds(companyId, id)).includes(parentId)) {
        throw new BadRequestException('A location cannot sit inside itself.');
      }
      update.parentId = parentId;
    }
    return this.prisma.taskLocation.update({ where: { id }, data: update });
  }

  /** Deleted when nothing ever used it (or anything under it); otherwise disabled. */
  async deleteLocation(companyId: number, role: string, id: number) {
    this.assertAdmin(role);
    const loc = await this.prisma.taskLocation.findFirst({ where: { id, companyId } });
    if (!loc) throw new NotFoundException('Location not found');
    const subtree = await this.descendantIds(companyId, id);
    const used = await this.prisma.issueLocation.count({ where: { locationId: { in: subtree } } });
    if (used) {
      await this.prisma.taskLocation.updateMany({ where: { id: { in: subtree } }, data: { isActive: false } });
      return { deleted: false, disabled: true, message: 'Tasks use this location, so it was disabled instead.' };
    }
    // Children first: the parent link is SET NULL, which would orphan them.
    await this.prisma.taskLocation.deleteMany({ where: { id: { in: subtree.filter((x) => x !== id) } } });
    await this.prisma.taskLocation.delete({ where: { id } });
    return { deleted: true, disabled: false };
  }

  // ── A project's locations (23 Oct 2026) ─────────────────────────────────

  /**
   * Where this project's tasks may be placed: its cities and its active sites.
   * Null when the project lists no cities, so it keeps using the whole list.
   */
  async projectAllowedIds(tx: any, projectId: number): Promise<Set<number> | null> {
    const links = await tx.projectLocation.findMany({ where: { projectId }, select: { locationId: true } });
    if (!links.length) return null;
    const sites = await tx.taskLocation.findMany({ where: { projectId, isActive: true }, select: { id: true } });
    return new Set<number>([...links.map((l: any) => l.locationId), ...sites.map((s: any) => s.id)]);
  }

  /** GET /projects/:id/locations — the chosen cities, the project's sites, and picker options. */
  async getProjectLocations(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
    const SEL = { id: true, name: true, code: true, level: true, parentId: true, isActive: true, position: true } as const;
    const links = await this.prisma.projectLocation.findMany({
      where: { projectId },
      include: { location: { select: { ...SEL, parent: { select: { id: true, name: true } } } } },
    });
    const sites = await this.prisma.taskLocation.findMany({
      where: { companyId, projectId }, orderBy: [{ position: 'asc' }, { name: 'asc' }], select: SEL,
    });
    const states = new Map<number, any>();
    for (const l of links) if (l.location.parent) states.set(l.location.parent.id, l.location.parent);
    const stateRows = states.size ? await this.prisma.taskLocation.findMany({ where: { id: { in: [...states.keys()] } }, select: SEL }) : [];
    // Open work per location, so the form can say what blocks a removal.
    const open = await this.prisma.issueLocation.groupBy({
      by: ['locationId'],
      where: { issue: { projectId }, removedAt: null, status: { not: LOCATION_STATUS.COMPLETED }, locationId: { in: [...links.map((l) => l.locationId), ...sites.map((s) => s.id)] } },
      _count: { _all: true },
    });
    const openBy: Record<number, number> = Object.fromEntries(open.map((o) => [o.locationId, o._count._all]));
    const cityName = new Map(links.map((l) => [l.locationId, { city: l.location.name, state: l.location.parent?.name ?? '' }]));
    return {
      cities: links.map((l) => ({ id: l.locationId, city: l.location.name, state: l.location.parent?.name ?? '', openTasks: openBy[l.locationId] ?? 0 })),
      sites: sites.map((st) => ({
        id: st.id, name: st.name, isActive: st.isActive, cityId: st.parentId,
        city: cityName.get(st.parentId ?? -1)?.city ?? '', state: cityName.get(st.parentId ?? -1)?.state ?? '',
        openTasks: openBy[st.id] ?? 0,
      })).filter((st) => st.isActive),
      // What a task in this project may pick: states only as group headers.
      options: links.length
        ? [...stateRows.map((st) => ({ ...st, headerOnly: true })), ...links.map((l) => { const { parent, ...loc } = l.location; return loc; }), ...sites.filter((st) => st.isActive)]
        : null,
    };
  }

  /** The state or city row with this name, created in the company list when missing. */
  private async ensureLocation(tx: any, companyId: number, level: 'STATE' | 'CITY', name: string, parentId: number | null) {
    const found = await tx.taskLocation.findFirst({
      where: { companyId, level, parentId, projectId: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, isActive: true },
    });
    if (found) {
      if (!found.isActive) await tx.taskLocation.update({ where: { id: found.id }, data: { isActive: true } });
      return found.id as number;
    }
    const made = await tx.taskLocation.create({ data: { companyId, name, level, parentId }, select: { id: true } });
    return made.id as number;
  }

  /**
   * PUT /projects/:id/locations — replace the project's cities and sites.
   * Body: { cities: [{ state, city }], sites: [{ id?, name, state, city }] }.
   * States and cities are found by name in the company list, or added to it
   * (the form offers India's states and cities without any setup). A city or
   * site with open task work cannot be taken off. Admins and project managers.
   */
  async setProjectLocations(companyId: number, projectId: number, employeeId: number | null, role: string | undefined, body: any) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
    if (!(await this.manages(companyId, projectId, employeeId, role))) {
      throw new ForbiddenException('Only an administrator or the project manager can change project locations.');
    }
    const clean = (v: any) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const keyOf = (state: string, city: string) => `${state.toLowerCase()}|${city.toLowerCase()}`;
    const cities: { state: string; city: string }[] = [];
    for (const raw of Array.isArray(body?.cities) ? body.cities : []) {
      const state = clean(raw?.state), city = clean(raw?.city);
      if (!state || !city) continue;
      if (!cities.some((c) => keyOf(c.state, c.city) === keyOf(state, city))) cities.push({ state, city });
    }
    const wanted: { id: number | null; name: string; key: string }[] = [];
    for (const raw of Array.isArray(body?.sites) ? body.sites : []) {
      const name = clean(raw?.name), key = keyOf(clean(raw?.state), clean(raw?.city));
      if (!name) continue;
      if (!cities.some((c) => keyOf(c.state, c.city) === key)) throw new BadRequestException(`Site "${name}" is not under one of the chosen cities.`);
      if (wanted.some((w) => w.key === key && w.name.toLowerCase() === name.toLowerCase())) {
        throw new BadRequestException(`Site "${name}" is listed twice in the same city.`);
      }
      wanted.push({ id: Number(raw?.id) > 0 ? Number(raw.id) : null, name, key });
    }

    const [links, sites] = await Promise.all([
      this.prisma.projectLocation.findMany({
        where: { projectId }, include: { location: { select: { id: true, name: true, parent: { select: { name: true } } } } },
      }),
      this.prisma.taskLocation.findMany({ where: { companyId, projectId }, select: { id: true, name: true, parentId: true, isActive: true } }),
    ]);
    const wantedKeys = new Set(cities.map((c) => keyOf(c.state, c.city)));
    const removedCities = links.filter((l) => !wantedKeys.has(keyOf(l.location.parent?.name ?? '', l.location.name))).map((l) => l.location);
    const keptSiteIds = new Set(wanted.map((w) => w.id).filter((x): x is number => x != null));
    if ([...keptSiteIds].some((id) => !sites.some((st) => st.id === id))) throw new BadRequestException('One of those sites is not on this project.');
    const removedSites = sites.filter((st) => st.isActive && !keptSiteIds.has(st.id));

    // Blocked while tasks still have open work there (23 Oct 2026 decision).
    const blocking = [...removedCities, ...removedSites];
    if (blocking.length) {
      const open = await this.prisma.issueLocation.findMany({
        where: { issue: { projectId }, removedAt: null, status: { not: LOCATION_STATUS.COMPLETED }, locationId: { in: blocking.map((b) => b.id) } },
        select: { locationId: true, issue: { select: { key: true } } },
      });
      if (open.length) {
        const by = new Map<number, string[]>();
        for (const o of open) by.set(o.locationId, [...(by.get(o.locationId) ?? []), o.issue.key]);
        const parts = blocking.filter((b) => by.has(b.id)).map((b) => {
          const keys = by.get(b.id)!;
          return `${b.name} (${keys.length} open task${keys.length === 1 ? '' : 's'}: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''})`;
        });
        throw new BadRequestException(`Cannot remove ${parts.join('; ')}. Complete those tasks or move them to another location first.`);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const cityIdBy = new Map<string, number>();
      for (const c of cities) {
        const stateId = await this.ensureLocation(tx, companyId, 'STATE', c.state, null);
        cityIdBy.set(keyOf(c.state, c.city), await this.ensureLocation(tx, companyId, 'CITY', c.city, stateId));
      }
      if (removedCities.length) {
        await tx.projectLocation.deleteMany({ where: { projectId, locationId: { in: removedCities.map((c) => c.id) } } });
      }
      const have = new Set(links.map((l) => l.locationId));
      const fresh = [...cityIdBy.values()].filter((id) => !have.has(id));
      if (fresh.length) await tx.projectLocation.createMany({ data: fresh.map((locationId) => ({ projectId, locationId, companyId })), skipDuplicates: true });

      for (const st of removedSites) {
        const used = await tx.issueLocation.count({ where: { locationId: st.id } });
        if (used) await tx.taskLocation.update({ where: { id: st.id }, data: { isActive: false } });
        else await tx.taskLocation.delete({ where: { id: st.id } });
      }
      let position = 0;
      for (const w of wanted) {
        position++;
        const parentId = cityIdBy.get(w.key)!;
        if (w.id) await tx.taskLocation.update({ where: { id: w.id }, data: { name: w.name, parentId, isActive: true, position } });
        else await tx.taskLocation.create({ data: { companyId, projectId, name: w.name, level: 'SITE', parentId, position } });
      }
    }, { timeout: 30000 });
    return this.getProjectLocations(companyId, projectId);
  }

  /** The location and everything beneath it. */
  private async descendantIds(companyId: number, rootId: number): Promise<number[]> {
    const all = await this.prisma.taskLocation.findMany({
      where: { companyId }, select: { id: true, parentId: true },
    });
    const out = [rootId];
    for (let i = 0; i < out.length; i++) {
      for (const l of all) if (l.parentId === out[i] && !out.includes(l.id)) out.push(l.id);
    }
    return out;
  }

  // ── One task's locations ────────────────────────────────────────────────

  /** The task, if this viewer may see it — the board's own visibility rule. */
  private async loadIssue(companyId: number, projectId: number, issueId: number, employeeId: number | null, role?: string) {
    const viewer = await resolveProjectViewer(this.prisma as any, companyId, projectId, employeeId, role);
    const visible = taskVisibilityFilter(viewer);
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, projectId, companyId, ...(visible ? { AND: [visible] } : {}) },
      select: {
        id: true, key: true, title: true, status: true, columnId: true, projectId: true,
        assigneeId: true, reporterId: true, companyId: true,
        members: { select: { employeeId: true } },
        project: { select: { leadId: true, allowManualTimeLogging: true, name: true } },
      },
    });
    if (!issue) throw new NotFoundException('Task not found');
    // The PM, owner, architect, coordinator, admins and whoever raised the
    // task see every location; everyone else only their own.
    const seesAll = !LOCATION_TRACKING_ENABLED
      || seesEveryTask(viewer)
      || (employeeId != null && issue.reporterId === employeeId)
      || await this.manages(companyId, projectId, employeeId, role);
    return { ...issue, seesAll };
  }

  private async loadRow(issueId: number, rowId: number) {
    const row = await this.prisma.issueLocation.findFirst({
      where: { id: rowId, issueId },
      include: { location: { select: { name: true } }, assignees: { select: { employeeId: true } } },
    });
    if (!row) throw new NotFoundException('That location is not on this task.');
    return row;
  }

  private manages(companyId: number, projectId: number, employeeId: number | null, role?: string) {
    return canManageTask(this.prisma as any, companyId, projectId, employeeId, role);
  }

  /**
   * Managers, the location's own assignees, and — where nobody is assigned to
   * the location specifically — the people on the task itself.
   */
  private async assertMayWork(
    issue: Awaited<ReturnType<TaskLocationsService['loadIssue']>>,
    row: { assignees: { employeeId: number }[]; removedAt: Date | null },
    employeeId: number | null,
    role?: string,
  ) {
    if (row.removedAt) throw new BadRequestException('This location was removed from the task.');
    if (await this.manages(issue.companyId, issue.projectId, employeeId, role)) return;
    if (employeeId != null) {
      if (row.assignees.some((a) => a.employeeId === employeeId)) return;
      if (!row.assignees.length
        && (issue.assigneeId === employeeId || issue.members.some((m) => m.employeeId === employeeId))) return;
    }
    throw new ForbiddenException('Only the people assigned to this location can update it.');
  }

  private requireEmployee(employeeId: number | null | undefined): number {
    if (!employeeId) throw new BadRequestException('Your account is not linked to an employee record.');
    return employeeId;
  }

  async getForIssue(companyId: number, projectId: number, issueId: number, employeeId: number | null, role?: string) {
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    const all = await this.prisma.issueLocation.findMany({
      where: { issueId },
      include: LOCATION_INCLUDE,
      orderBy: [{ removedAt: { sort: 'asc', nulls: 'first' } }, { location: { name: 'asc' } }],
    });
    const rows = issue.seesAll ? all : all.filter((r) => isOwnLocation(r, issue, employeeId));
    const minutes = await this.prisma.issueTimeLog.groupBy({
      by: ['issueLocationId'],
      where: { issueId, issueLocationId: { not: null } },
      _sum: { durationMin: true },
    });
    const minutesBy = new Map(minutes.map((m) => [m.issueLocationId, m._sum.durationMin ?? 0]));
    const manage = await this.manages(companyId, projectId, employeeId, role);
    const now = new Date();
    return {
      canManage: manage,
      /** The parent task's status, so the panel can lock a closed task for employees. */
      taskStatus: issue.status,
      progress: locationProgress(rows, now),
      locations: rows.map((r) => ({
        ...r,
        loggedMinutes: minutesBy.get(r.id) ?? 0,
        overdue: !r.removedAt && isLocationOverdue(r, now),
        canUpdate: !r.removedAt && (manage || (employeeId != null && (
          r.assignees.some((a) => a.employeeId === employeeId)
          || (!r.assignees.length && (issue.assigneeId === employeeId
            || issue.members.some((m) => m.employeeId === employeeId)))
        ))),
      })),
    };
  }

  /**
   * Put locations on a task. A location that was removed earlier comes back
   * as the same row, with its history; one already on the task is left alone.
   */
  async addLocations(
    companyId: number, projectId: number, issueId: number, employeeId: number | null, role: string | undefined, data: any,
  ) {
    const actor = this.requireEmployee(employeeId);
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    if (!(await this.manages(companyId, projectId, employeeId, role))) {
      throw new ForbiddenException('Only the project manager can change where a task is carried out.');
    }
    let locationIds = data?.locationIds;
    let details: Record<number, LocationDraft> | undefined = undefined;
    if (Array.isArray(data?.locations) && data.locations.length) {
      const parsed = await this.parseDrafts(this.prisma, companyId, data.locations);
      details = parsed.details;
      locationIds = parsed.locationIds;
    } else {
      if (data?.startDate && data?.dueDate && new Date(data.dueDate) < new Date(data.startDate)) {
        throw new BadRequestException('Due date cannot be before start date.');
      }
    }
    const result = await this.attachLocations(this.prisma, {
      companyId, issueId, actorId: actor,
      locationIds,
      assigneeIds: data?.assigneeIds,
      startDate: data?.startDate,
      dueDate: data?.dueDate,
      status: data?.status,
      details,
    });
    await this.notifyAssigned(issue, result.assigned, actor);
    await this.syncParent(issueId, actor);
    return this.getForIssue(companyId, projectId, issueId, employeeId, role);
  }

  /**
   * The write half of adding locations, shared with task creation (which runs
   * it inside its own transaction). Returns who was newly assigned where, so
   * the caller can notify once the transaction has committed.
   */
  async attachLocations(
    tx: any,
    opts: {
      companyId: number; issueId: number; actorId: number;
      locationIds: any; assigneeIds?: any; startDate?: any; dueDate?: any; status?: any;
      /** Per-location values chosen while creating the task, keyed by location id. */
      details?: Record<number, LocationDraft>;
    },
  ): Promise<{ added: number; restored: number; assigned: { employeeId: number; locationName: string }[] }> {
    const ids = [...new Set<number>((Array.isArray(opts.locationIds) ? opts.locationIds : [])
      .map(Number).filter((n: number) => Number.isInteger(n) && n > 0))];
    if (!ids.length) throw new BadRequestException('Choose at least one location.');
    // While per-location tracking is off, a task is carried out at one place.
    if (!LOCATION_TRACKING_ENABLED && ids.length > 1) {
      throw new BadRequestException('A task has one location. Choose a single location.');
    }

    const locations = await tx.taskLocation.findMany({
      where: { id: { in: ids }, companyId: opts.companyId },
      select: { id: true, name: true, isActive: true, level: true, projectId: true },
    });
    if (locations.length !== ids.length) throw new BadRequestException('One of those locations does not exist.');

    const assigneeIds = await this.validEmployees(tx, opts.companyId, opts.assigneeIds);
    const existing: any[] = await tx.issueLocation.findMany({
      where: { issueId: opts.issueId, locationId: { in: ids } },
    });
    const existingBy = new Map(existing.map((e) => [e.locationId, e]));

    // Project locations (23 Oct 2026): a project that lists its cities takes
    // tasks only at those cities or its own sites; another project's site is
    // never available. Locations already on the task stay as they are.
    const projectOf = await tx.issue.findUnique({ where: { id: opts.issueId }, select: { projectId: true } });
    const allowed = projectOf?.projectId ? await this.projectAllowedIds(tx, projectOf.projectId) : null;
    const outside = locations.filter((l: any) => !existingBy.has(l.id)
      && ((l.projectId != null && l.projectId !== projectOf?.projectId) || (allowed && !allowed.has(l.id))));
    if (outside.length) {
      throw new BadRequestException(`${outside.map((l: any) => l.name).join(', ')} is not one of this project's locations.`);
    }

    const inactive = locations.filter((l: any) => !l.isActive && !existingBy.has(l.id));
    if (inactive.length) {
      throw new BadRequestException(`${inactive.map((l: any) => l.name).join(', ')} is no longer in use.`);
    }

    let added = 0;
    let restored = 0;
    const assigned: { employeeId: number; locationName: string }[] = [];
    for (const loc of locations) {
      const prior = existingBy.get(loc.id);
      if (prior && !prior.removedAt) continue;

      let rowId: number;
      if (prior) {
        await tx.issueLocation.update({
          where: { id: prior.id }, data: { removedAt: null, removedById: null },
        });
        await tx.issueLocationActivity.create({
          data: { issueLocationId: prior.id, action: 'RESTORED', actorId: opts.actorId },
        });
        rowId = prior.id;
        restored++;
      } else {
        const d = opts.details?.[loc.id];
        const status = d?.status ?? opts.status ?? LOCATION_STATUS.NOT_STARTED;
        const startDate = d?.startDate ?? opts.startDate;
        const dueDate = d?.dueDate ?? opts.dueDate;
        const row = await tx.issueLocation.create({
          data: {
            issueId: opts.issueId, locationId: loc.id, companyId: opts.companyId, createdById: opts.actorId,
            startDate: startDate ? new Date(startDate) : null,
            dueDate: dueDate ? new Date(dueDate) : null,
            status,
            startedAt: status !== LOCATION_STATUS.NOT_STARTED ? new Date() : null,
            completedAt: status === LOCATION_STATUS.COMPLETED ? new Date() : null,
            completedById: status === LOCATION_STATUS.COMPLETED ? opts.actorId : null,
            blockedReason: status === LOCATION_STATUS.BLOCKED ? (d?.blockedReason ?? null) : null,
            remarks: d?.remarks ?? null,
          },
        });
        await tx.issueLocationActivity.create({
          data: { issueLocationId: row.id, action: 'ADDED', actorId: opts.actorId },
        });
        rowId = row.id;
        added++;
      }

      const people = opts.details?.[loc.id]?.assigneeIds ?? assigneeIds;
      for (const employeeId of people) {
        const made = await tx.issueLocationAssignee.createMany({
          data: [{ issueLocationId: rowId, employeeId }], skipDuplicates: true,
        });
        if (made.count) {
          await tx.issueLocationActivity.create({
            data: { issueLocationId: rowId, action: 'ASSIGNED', newValue: String(employeeId), actorId: opts.actorId },
          });
          assigned.push({ employeeId, locationName: loc.name });
        }
      }
    }
    return { added, restored, assigned };
  }

  /**
   * The per-location values the create form sends, checked and normalised.
   * Status, start date, due date and at least one assignee are required for
   * every location; remarks are optional.
   */
  async parseDrafts(tx: any, companyId: number, raw: any): Promise<{ locationIds: number[]; details: Record<number, LocationDraft> }> {
    if (!Array.isArray(raw) || !raw.length) throw new BadRequestException('No location details were sent. Pick the locations again and retry.');
    const details: Record<number, LocationDraft> = {};
    const names = new Map<number, string>(
      (await tx.taskLocation.findMany({
        where: { companyId, id: { in: raw.map((r: any) => Number(r?.locationId)).filter(Boolean) } },
        select: { id: true, name: true },
      })).map((l: any) => [l.id, l.name]),
    );
    for (const r of raw) {
      const locationId = Number(r?.locationId);
      const name = names.get(locationId);
      if (!name) throw new BadRequestException('One of those locations does not exist.');
      const status = String(r.status ?? '');
      if (!LOCATION_STATUSES.includes(status)) throw new BadRequestException(`Choose a status for ${name}.`);
      if (!r.startDate) throw new BadRequestException(`Choose a start date for ${name}.`);
      if (!r.dueDate) throw new BadRequestException(`Choose a due date for ${name}.`);
      if (String(r.dueDate).slice(0, 10) < String(r.startDate).slice(0, 10)) {
        throw new BadRequestException(`The due date for ${name} cannot be before its start date.`);
      }
      const assigneeIds = await this.validEmployees(tx, companyId, r.assigneeIds);
      if (!assigneeIds.length) throw new BadRequestException(`Assign at least one member to ${name}.`);
      const blockedReason = String(r.blockedReason ?? '').trim();
      if (status === LOCATION_STATUS.BLOCKED && !blockedReason) throw new BadRequestException(`Say what is blocking ${name}.`);
      details[locationId] = {
        status, startDate: r.startDate, dueDate: r.dueDate, assigneeIds,
        remarks: String(r.remarks ?? '').trim() || null, blockedReason: blockedReason || null,
      };
    }
    return { locationIds: Object.keys(details).map(Number), details };
  }

  private async validEmployees(tx: any, companyId: number, raw: any): Promise<number[]> {
    const ids = [...new Set<number>((Array.isArray(raw) ? raw : []).map(Number).filter((n: number) => n > 0))];
    if (!ids.length) return [];
    const found = await tx.employee.findMany({ where: { id: { in: ids }, companyId }, select: { id: true } });
    if (found.length !== ids.length) throw new BadRequestException('One of those people is not in this company.');
    return ids;
  }

  async updateRow(
    companyId: number, projectId: number, issueId: number, rowId: number,
    employeeId: number | null, role: string | undefined, data: any,
  ) {
    const actor = this.requireEmployee(employeeId);
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    const row = await this.loadRow(issueId, rowId);
    await this.assertMayWork(issue, row, employeeId, role);

    const isManager = await this.manages(companyId, projectId, employeeId, role);
    if (!isManager && data?.status !== undefined && data.status !== row.status) {
      // Employees move their own location between Not started, In progress
      // and Completed; Review, Blocked and anything after the task is closed
      // are the project manager's.
      if (!EMPLOYEE_LOCATION_STATUSES.includes(String(data.status))) {
        throw new ForbiddenException('You can set a location to Not started, In progress or Completed.');
      }
      if (issue.status === 'DONE' || issue.status === 'CANCELLED') {
        throw new ForbiddenException('This task is closed. Ask the project manager to reopen it.');
      }
    }

    const managing = ['assigneeIds', 'startDate', 'dueDate'].filter((k) => data?.[k] !== undefined);
    if (managing.length && !isManager) {
      throw new ForbiddenException('Only the project manager can change who works a location or when it is due.');
    }

    const update: any = {};
    const log: { action: string; field?: string; oldValue?: string | null; newValue?: string | null; body?: string | null }[] = [];
    const iso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);

    let newStatus: string | undefined;
    if (data.status !== undefined && data.status !== row.status) {
      newStatus = String(data.status);
      if (!LOCATION_STATUSES.includes(newStatus)) throw new BadRequestException('Unknown location status.');
      const reason = String(data.blockedReason ?? '').trim();
      if (newStatus === LOCATION_STATUS.BLOCKED && !reason) {
        throw new BadRequestException('Say what is blocking this location.');
      }
      update.status = newStatus;
      update.blockedReason = newStatus === LOCATION_STATUS.BLOCKED ? reason : null;
      if (!row.startedAt && newStatus !== LOCATION_STATUS.NOT_STARTED) update.startedAt = new Date();
      if (newStatus === LOCATION_STATUS.COMPLETED) {
        update.completedAt = new Date();
        update.completedById = actor;
      } else if (row.status === LOCATION_STATUS.COMPLETED) {
        update.completedAt = null;
        update.completedById = null;
      }
      log.push({
        action: 'STATUS_CHANGED', field: 'status', oldValue: row.status, newValue: newStatus,
        body: newStatus === LOCATION_STATUS.BLOCKED ? reason : null,
      });
    } else if (data.blockedReason !== undefined && row.status === LOCATION_STATUS.BLOCKED) {
      const reason = String(data.blockedReason ?? '').trim();
      if (!reason) throw new BadRequestException('Say what is blocking this location.');
      if (reason !== row.blockedReason) {
        update.blockedReason = reason;
        log.push({ action: 'UPDATED', field: 'blockedReason', oldValue: row.blockedReason, newValue: reason });
      }
    }

    if (data.remarks !== undefined) {
      const remarks = String(data.remarks ?? '').trim() || null;
      if (remarks !== row.remarks) {
        update.remarks = remarks;
        log.push({ action: 'UPDATED', field: 'remarks', oldValue: row.remarks, newValue: remarks });
      }
    }
    for (const key of ['startDate', 'dueDate'] as const) {
      if (data[key] === undefined || iso(data[key]) === iso((row as any)[key])) continue;
      update[key] = data[key] ? new Date(data[key]) : null;
      log.push({ action: 'UPDATED', field: key, oldValue: iso((row as any)[key]), newValue: iso(data[key]) });
      // A new due date earns a new overdue notice.
      if (key === 'dueDate') update.overdueNotifiedAt = null;
    }

    const effectiveStart = update.startDate !== undefined ? update.startDate : row.startDate;
    const effectiveDue = update.dueDate !== undefined ? update.dueDate : row.dueDate;
    if (effectiveStart && effectiveDue && new Date(effectiveDue) < new Date(effectiveStart)) {
      throw new BadRequestException('Due date cannot be before start date.');
    }

    let added: number[] = [];
    let removed: number[] = [];
    if (data.assigneeIds !== undefined) {
      const next = await this.validEmployees(this.prisma, companyId, data.assigneeIds);
      const prev = row.assignees.map((a) => a.employeeId);
      added = next.filter((id) => !prev.includes(id));
      removed = prev.filter((id) => !next.includes(id));
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(update).length) await tx.issueLocation.update({ where: { id: rowId }, data: update });
      if (removed.length) {
        await tx.issueLocationAssignee.deleteMany({ where: { issueLocationId: rowId, employeeId: { in: removed } } });
      }
      if (added.length) {
        await tx.issueLocationAssignee.createMany({
          data: added.map((id) => ({ issueLocationId: rowId, employeeId: id })), skipDuplicates: true,
        });
      }
      const entries = [
        ...log,
        ...added.map((id) => ({ action: 'ASSIGNED', newValue: String(id) })),
        ...removed.map((id) => ({ action: 'UNASSIGNED', oldValue: String(id) })),
      ];
      for (const e of entries) {
        await tx.issueLocationActivity.create({ data: { issueLocationId: rowId, actorId: actor, ...e } });
      }
    });

    await this.notifyAssigned(issue, added.map((id) => ({ employeeId: id, locationName: row.location.name })), actor);
    if (newStatus === LOCATION_STATUS.BLOCKED || newStatus === LOCATION_STATUS.COMPLETED) {
      const assignees = [...row.assignees.map((a) => a.employeeId).filter((id) => !removed.includes(id)), ...added];
      await this.notifications.notifyEmployees([...assignees, issue.reporterId, issue.project.leadId], {
        companyId,
        title: newStatus === LOCATION_STATUS.BLOCKED ? 'Location blocked' : 'Location completed',
        message: newStatus === LOCATION_STATUS.BLOCKED
          ? `${issue.key} "${issue.title}" is blocked at ${row.location.name}: ${update.blockedReason}`
          : `${issue.key} "${issue.title}" is complete at ${row.location.name}.`,
        type: newStatus === LOCATION_STATUS.BLOCKED ? 'WARNING' : 'SUCCESS',
        linkUrl: `/projects/${projectId}`,
        excludeEmployeeId: actor,
      });
    }
    if (newStatus) await this.syncParent(issueId, actor);
    return this.getForIssue(companyId, projectId, issueId, employeeId, role);
  }

  /**
   * Take a location off a task. Untouched, it is deleted; with any recorded
   * work it is kept, marked removed, and stops counting toward progress.
   */
  async removeRow(
    companyId: number, projectId: number, issueId: number, rowId: number, employeeId: number | null, role?: string,
  ) {
    const actor = this.requireEmployee(employeeId);
    await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    if (!(await this.manages(companyId, projectId, employeeId, role))) {
      throw new ForbiddenException('Only the project manager can change where a task is carried out.');
    }
    const row = await this.prisma.issueLocation.findFirst({
      where: { id: rowId, issueId },
      include: { _count: { select: { timeLogs: true, attachments: true } } },
    });
    if (!row) throw new NotFoundException('That location is not on this task.');
    if (row.removedAt) return { removed: true, soft: true };

    const activityCount = await this.prisma.issueLocationActivity.count({
      where: { issueLocationId: rowId, action: { notIn: ['ADDED', 'ASSIGNED', 'UNASSIGNED'] } },
    });
    const keep = locationHasHistory({
      status: row.status,
      timeLogCount: row._count.timeLogs,
      attachmentCount: row._count.attachments,
      activityCount,
    });
    if (keep) {
      await this.prisma.issueLocation.update({
        where: { id: rowId }, data: { removedAt: new Date(), removedById: actor },
      });
      await this.prisma.issueLocationActivity.create({
        data: { issueLocationId: rowId, action: 'REMOVED', actorId: actor },
      });
    } else {
      await this.prisma.issueLocation.delete({ where: { id: rowId } });
    }
    await this.syncParent(issueId, actor);
    return { removed: true, soft: keep };
  }

  /**
   * Make `locationId` the task's one location (per-location tracking off).
   * Any other location comes off as removeRow would take it: deleted when
   * nothing was recorded there, kept as removed when something was. Runs in
   * the caller's transaction when given one.
   */
  async setTaskLocation(tx: any, companyId: number, issueId: number, actorId: number, locationId: number) {
    const id = Number(locationId);
    if (!Number.isInteger(id) || id <= 0) throw new BadRequestException('Choose a location.');
    const active = await tx.issueLocation.findMany({
      where: { issueId, removedAt: null },
      include: { _count: { select: { timeLogs: true, attachments: true } } },
    });
    if (active.length === 1 && active[0].locationId === id) return;
    for (const row of active.filter((r: any) => r.locationId !== id)) {
      const activityCount = await tx.issueLocationActivity.count({
        where: { issueLocationId: row.id, action: { notIn: ['ADDED', 'ASSIGNED', 'UNASSIGNED'] } },
      });
      const keep = locationHasHistory({
        status: row.status, timeLogCount: row._count.timeLogs, attachmentCount: row._count.attachments, activityCount,
      });
      if (keep) {
        await tx.issueLocation.update({ where: { id: row.id }, data: { removedAt: new Date(), removedById: actorId } });
        await tx.issueLocationActivity.create({ data: { issueLocationId: row.id, action: 'REMOVED', actorId } });
      } else {
        await tx.issueLocation.delete({ where: { id: row.id } });
      }
    }
    if (!active.some((r: any) => r.locationId === id)) {
      await this.attachLocations(tx, { companyId, issueId, actorId, locationIds: [id] });
    }
  }

  /** PUT /projects/:p/issues/:id/locations — replace the task's location. Managers only. */
  async setLocationFor(
    companyId: number, projectId: number, issueId: number, employeeId: number | null, role: string | undefined, locationId: any,
  ) {
    const actor = this.requireEmployee(employeeId);
    await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    if (!(await this.manages(companyId, projectId, employeeId, role))) {
      throw new ForbiddenException('Only the project manager can change where a task is carried out.');
    }
    await this.prisma.$transaction((tx) => this.setTaskLocation(tx, companyId, issueId, actor, locationId));
    return this.getForIssue(companyId, projectId, issueId, employeeId, role);
  }

  async addComment(
    companyId: number, projectId: number, issueId: number, rowId: number,
    employeeId: number | null, role: string | undefined, body: any,
  ) {
    const actor = this.requireEmployee(employeeId);
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    const row = await this.loadRow(issueId, rowId);
    await this.assertMayWork(issue, row, employeeId, role);
    const text = String(body ?? '').trim();
    if (!text) throw new BadRequestException('Write something first.');
    return this.prisma.issueLocationActivity.create({
      data: { issueLocationId: rowId, action: 'COMMENT', body: text, actorId: actor },
      include: { actor: { select: PERSON } },
    });
  }

  /**
   * Time at one location: an ordinary time log on the parent task, tagged.
   * The parent's hours budget and the project's manual-entry switch apply
   * exactly as they do to Log Work, because this is Log Work.
   */
  async logTime(
    companyId: number, projectId: number, issueId: number, rowId: number,
    employeeId: number | null, role: string | undefined, data: any,
  ) {
    const actor = this.requireEmployee(employeeId);
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    const row = await this.loadRow(issueId, rowId);
    await this.assertMayWork(issue, row, employeeId, role);

    const durationMin = Math.round(Number(data?.durationMin));
    if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 24 * 60) {
      throw new BadRequestException('Enter between 1 minute and 24 hours.');
    }
    if (!issue.project.allowManualTimeLogging) {
      throw new BadRequestException(
        `${issue.project.name} does not allow manual time entry. Use the timer to record work on this project.`,
      );
    }
    const [budget, agg] = await Promise.all([
      this.prisma.issue.findUnique({ where: { id: issueId }, select: { estimatedHours: true, additionalHours: true } }),
      this.prisma.issueTimeLog.aggregate({ where: { issueId }, _sum: { durationMin: true } }),
    ]);
    try {
      assertWithinAllowedHours({
        estimatedHours: budget?.estimatedHours ?? null,
        additionalHours: budget?.additionalHours ?? 0,
        loggedMinutes: agg._sum.durationMin ?? 0,
      }, durationMin);
    } catch (e) {
      if (e instanceof HoursExceeded) throw new BadRequestException(e.message);
      throw e;
    }

    const endedAt = data?.date ? new Date(`${String(data.date).slice(0, 10)}T18:00:00`) : new Date();
    if (Number.isNaN(endedAt.getTime()) || endedAt.getTime() > Date.now() + HOUR_MS) {
      throw new BadRequestException('Time cannot be logged for a future date.');
    }
    const note = String(data?.note ?? '').trim() || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.issueTimeLog.create({
        data: {
          issueId, employeeId: actor, issueLocationId: rowId, source: 'LOCATION',
          startedAt: new Date(endedAt.getTime() - durationMin * 60_000), endedAt, durationMin, note,
        },
      });
      await tx.issueLocationActivity.create({
        data: { issueLocationId: rowId, action: 'TIME_LOGGED', newValue: String(durationMin), body: note, actorId: actor },
      });
      await tx.issueActivity.create({ data: { action: 'TIME_LOGGED', issueId, actorId: actor } });
      // Logged time means work has started here.
      if (row.status === LOCATION_STATUS.NOT_STARTED) {
        await tx.issueLocation.update({
          where: { id: rowId },
          data: { status: LOCATION_STATUS.IN_PROGRESS, startedAt: row.startedAt ?? new Date() },
        });
        await tx.issueLocationActivity.create({
          data: {
            issueLocationId: rowId, action: 'STATUS_CHANGED', field: 'status',
            oldValue: LOCATION_STATUS.NOT_STARTED, newValue: LOCATION_STATUS.IN_PROGRESS, actorId: actor,
          },
        });
      }
    });
    await this.syncParent(issueId, actor);
    return this.getForIssue(companyId, projectId, issueId, employeeId, role);
  }

  /**
   * Link files already uploaded to the task (through the task's own upload
   * route) to one location, so they are evidence for it.
   */
  async linkEvidence(
    companyId: number, projectId: number, issueId: number, rowId: number,
    employeeId: number | null, role: string | undefined, data: any,
  ) {
    const actor = this.requireEmployee(employeeId);
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    const row = await this.loadRow(issueId, rowId);
    await this.assertMayWork(issue, row, employeeId, role);
    const ids = [...new Set<number>((Array.isArray(data?.attachmentIds) ? data.attachmentIds : []).map(Number))]
      .filter((n) => n > 0);
    if (!ids.length) throw new BadRequestException('Upload a file first.');
    const files = await this.prisma.issueAttachment.findMany({
      where: { id: { in: ids }, issueId }, select: { id: true, fileName: true },
    });
    if (files.length !== ids.length) throw new BadRequestException('Those files do not belong to this task.');
    await this.prisma.issueAttachment.updateMany({ where: { id: { in: ids } }, data: { issueLocationId: rowId } });
    await this.prisma.issueLocationActivity.create({
      data: {
        issueLocationId: rowId, action: 'EVIDENCE_ADDED', actorId: actor,
        body: files.map((f) => f.fileName).join(', '),
      },
    });
    return this.getForIssue(companyId, projectId, issueId, employeeId, role);
  }

  async activity(
    companyId: number, projectId: number, issueId: number, rowId: number, employeeId: number | null, role?: string,
  ) {
    const issue = await this.loadIssue(companyId, projectId, issueId, employeeId, role);
    const row = await this.loadRow(issueId, rowId);
    if (!issue.seesAll && !isOwnLocation(row, issue, employeeId)) throw new NotFoundException('That location is not on this task.');
    const [entries, files] = await Promise.all([
      this.prisma.issueLocationActivity.findMany({
        where: { issueLocationId: rowId },
        include: { actor: { select: PERSON } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
      this.prisma.issueAttachment.findMany({
        where: { issueLocationId: rowId },
        include: { uploader: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    // Assignment entries carry ids; resolve them to names once, here.
    const ids = [...new Set(entries
      .filter((e) => e.action === 'ASSIGNED' || e.action === 'UNASSIGNED')
      .map((e) => Number(e.newValue ?? e.oldValue)).filter(Boolean))];
    const people = ids.length
      ? await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName ?? ''}`.trim()]));
    return {
      activity: entries.map((e) => ({
        ...e,
        personName: nameOf.get(Number(e.newValue ?? e.oldValue)) ?? null,
      })),
      evidence: files,
    };
  }

  /** For callers outside this service that created locations in their own transaction. */
  notifyAssignedFor(issue: { key: string; title: string; projectId: number; companyId: number }, assigned: { employeeId: number; locationName: string }[], actor: number) {
    return this.notifyAssigned(issue, assigned, actor);
  }

  private async notifyAssigned(
    issue: { key: string; title: string; projectId: number; companyId: number },
    assigned: { employeeId: number; locationName: string }[],
    actor: number,
  ) {
    const byPerson = new Map<number, string[]>();
    for (const a of assigned) byPerson.set(a.employeeId, [...(byPerson.get(a.employeeId) ?? []), a.locationName]);
    for (const [employeeId, names] of byPerson) {
      await this.notifications.notifyEmployees([employeeId], {
        companyId: issue.companyId,
        title: 'Location assigned',
        message: `You are on ${issue.key} "${issue.title}" at ${names.join(', ')}.`,
        type: 'INFO',
        linkUrl: `/projects/${issue.projectId}`,
        excludeEmployeeId: actor,
      });
    }
  }

  /**
   * Move the parent across the board when its locations say so: Done when
   * every location is, back to In Progress when one reopens, out of To Do
   * when work starts anywhere. A system move, so the one-column-at-a-time rule
   * that governs dragging does not apply.
   */
  async syncParent(issueId: number, actorId: number) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, status: true, columnId: true, projectId: true },
    });
    if (!issue) return;
    const locations = await this.prisma.issueLocation.findMany({
      where: { issueId }, select: { status: true, removedAt: true },
    });
    if (!LOCATION_TRACKING_ENABLED) return;
    const target = parentStatusFor(issue.status, locations);
    if (!target) return;

    const columns = await this.prisma.boardColumn.findMany({
      where: { board: { projectId: issue.projectId }, isArchived: false },
      orderBy: { position: 'asc' },
    });
    const column = target === 'IN_REVIEW'
      ? columns.find((c) => c.type === 'IN_REVIEW') ?? columns.find((c) => /review/i.test(c.name || ''))
      : columns.find((c) => c.type === 'IN_PROGRESS')
        ?? columns.find((c) => /progress|doing/i.test(c.name || ''));

    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        status: target,
        completedAt: null,
        ...(column ? { columnId: column.id } : {}),
      },
    });
    const activity = await this.prisma.issueActivity.create({
      data: {
        action: 'STATUS_CHANGED', field: 'status', issueId, actorId,
        oldValue: issue.status, newValue: target,
      },
      include: { actor: { select: PERSON } },
    });
    this.tasksGateway.emitIssueUpdated(issueId, issue.projectId, updated);
    this.tasksGateway.emitActivityAdded(issueId, activity);
  }

  /** Open (active, not completed) and total locations — the Done guard reads this. */
  async openLocationCount(issueId: number) {
    const rows = await this.prisma.issueLocation.findMany({
      where: { issueId, removedAt: null }, select: { status: true },
    });
    return { open: rows.filter((r) => r.status !== LOCATION_STATUS.COMPLETED).length, total: rows.length };
  }

  // ── Cross-task views ────────────────────────────────────────────────────

  /**
   * Which executions this person may see across projects: everything for an
   * administrator or a company-wide project grant; otherwise the ones on tasks
   * they are on, they raised, or they run the project of.
   */
  private async visibilityWhere(companyId: number, employeeId: number | null, role?: string): Promise<any> {
    if (isCompanyAdmin(role)) return {};
    const employee = employeeId
      ? await this.prisma.employee.findUnique({
          where: { id: employeeId }, select: { department: { select: { defaultRole: true } } },
        })
      : null;
    if (await hasCompanyWideProjectAccess(this.prisma as any, companyId, role, employee?.department?.defaultRole)) {
      return {};
    }
    const me = employeeId ?? -1;
    return {
      OR: [
        // Their own: assigned to it, or nobody is and they are on the task.
        { assignees: { some: { employeeId: me } } },
        { assignees: { none: {} }, issue: { assigneeId: me } },
        { assignees: { none: {} }, issue: { members: { some: { employeeId: me } } } },
        { issue: { reporterId: me } },
        { issue: { project: { leadId: me } } },
        {
          issue: {
            project: {
              members: {
                some: {
                  employeeId: me,
                  role: { in: [PROJECT_ROLE.MANAGER, PROJECT_ROLE.COORDINATOR, PROJECT_ROLE.ARCHITECT] },
                },
              },
            },
          },
        },
      ],
    };
  }

  private async filteredExecutions(companyId: number, employeeId: number | null, role: string | undefined, q: any) {
    const where: any = {
      companyId,
      removedAt: null,
      issue: { isArchived: false, status: { not: 'CANCELLED' } },
      AND: [await this.visibilityWhere(companyId, employeeId, role)],
    };
    const place = Number(q.locationId || q.cityId || q.stateId);
    if (place) where.locationId = { in: await this.descendantIds(companyId, place) };
    if (q.status === 'OVERDUE') {
      where.status = { not: LOCATION_STATUS.COMPLETED };
      where.dueDate = { lt: new Date() };
    } else if (q.status && LOCATION_STATUSES.includes(q.status)) {
      where.status = q.status;
    } else if (q.status === 'PENDING') {
      where.status = { not: LOCATION_STATUS.COMPLETED };
    }
    if (q.assigneeId) where.assignees = { some: { employeeId: Number(q.assigneeId) } };
    if (q.projectId) where.AND.push({ issue: { projectId: Number(q.projectId) } });
    if (q.issueId) where.issueId = Number(q.issueId);
    const search = String(q.search ?? '').trim();
    if (search) {
      where.AND.push({
        OR: [
          { issue: { title: { contains: search, mode: 'insensitive' } } },
          { issue: { key: { contains: search, mode: 'insensitive' } } },
          { location: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }
    return this.prisma.issueLocation.findMany({
      where,
      include: {
        ...LOCATION_INCLUDE,
        issue: {
          select: {
            id: true, key: true, title: true, status: true, priority: true, dueDate: true, projectId: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: 2000,
    });
  }

  async executions(companyId: number, employeeId: number | null, role: string | undefined, q: any) {
    const rows = await this.filteredExecutions(companyId, employeeId, role, q);
    const now = new Date();
    return rows.map((r) => ({ ...r, overdue: isLocationOverdue(r, now) }));
  }

  /** Per parent task: how many locations are completed, pending, overdue and blocked. */
  async report(companyId: number, employeeId: number | null, role: string | undefined, q: any) {
    const rows = await this.filteredExecutions(companyId, employeeId, role, { ...q, status: undefined });
    const now = new Date();
    const byIssue = new Map<number, { issue: any; rows: typeof rows }>();
    for (const r of rows) {
      const entry = byIssue.get(r.issueId) ?? { issue: r.issue, rows: [] as typeof rows };
      entry.rows.push(r);
      byIssue.set(r.issueId, entry);
    }
    return [...byIssue.values()].map(({ issue, rows: rs }) => {
      const p = locationProgress(rs, now);
      return {
        issue,
        ...p,
        pending: p.total - p.completed,
        pendingLocations: rs.filter((r) => r.status !== LOCATION_STATUS.COMPLETED).map((r) => r.location.name),
      };
    }).sort((a, b) => b.overdue - a.overdue || b.pending - a.pending);
  }
}
