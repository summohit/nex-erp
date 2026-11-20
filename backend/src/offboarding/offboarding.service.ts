import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { forgetAccountStatus } from '../auth/auth.guard';
import { isRestDay } from '../common/rest-day';
import { personalDaysOff } from '../common/weekly-offs';
import { LettersService } from '../letters/letters.service';
import { MailService } from '../mail/mail.service';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import FormData from 'form-data';

@Injectable()
export class OffboardingService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private lettersService: LettersService,
    private mailService: MailService,
  ) {}

  // Resignation Methods
  async getResignations(companyId: number, role: string, employeeId: number) {
    // If HR/Admin, return all. If Manager, return subordinates + own. If Employee, return own.
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN' || role === 'HR';
    
    let whereClause: any = { companyId };
    
    if (!isAdmin) {
      if (role === 'MANAGER') {
        const subordinates = await this.prisma.employee.findMany({
          where: { managerId: employeeId },
          select: { id: true }
        });
        const subIds = subordinates.map(s => s.id);
        subIds.push(employeeId);
        whereClause.employeeId = { in: subIds };
      } else {
        whereClause.employeeId = employeeId;
      }
    }

    const rows = await this.prisma.resignation.findMany({
      where: whereClause,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, managerId: true, user: { select: { email: true } }, salutation: true } },
        approver: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    // Exit progress for the list (20 Nov 2026): clearance tasks and FNF state.
    const empIds = [...new Set(rows.filter((r) => r.status === 'APPROVED').map((r) => r.employeeId))];
    const [tasks, fnfs] = empIds.length ? await Promise.all([
      this.prisma.offboardingTask.findMany({ where: { companyId, employeeId: { in: empIds } }, select: { employeeId: true, status: true } }),
      this.prisma.fnfSettlement.findMany({ where: { companyId, resignationId: { in: rows.map((r) => r.id) } }, select: { resignationId: true, status: true, dueDate: true } }),
    ]) : [[], []] as any;
    return Promise.all(rows.map(async (r) => {
      if (r.status !== 'APPROVED') return r;
      const mine = (tasks as any[]).filter((t) => t.employeeId === r.employeeId);
      const f = (fnfs as any[]).find((x) => x.resignationId === r.id);
      const due = f?.dueDate ?? r.fnfDueDate ?? await this.fnfDueDate(companyId, this.dayStart(new Date(r.approvedLastWorkingDay || r.intendedLastWorkingDay)));
      const cl: any = r.clearance || {};
      return { ...r, progress: {
        clearanceDone: OffboardingService.CLEARANCE_SECTIONS.filter((k) => cl[k]?.verified).length, clearanceTotal: OffboardingService.CLEARANCE_SECTIONS.length,
        clearance: cl,
        fnfStatus: f?.status ?? null, fnfDueDate: due,
      } };
    }));
  }

  async submitResignation(
    companyId: number, 
    employeeId: number, 
    data: { reason: string, intendedLastWorkingDay: Date }
  ) {
    // Check if already submitted
    const existing = await this.prisma.resignation.findFirst({
      where: { employeeId, status: { in: ['PENDING', 'APPROVED'] } }
    });

    if (existing) {
      throw new BadRequestException('A resignation request is already pending or approved for this employee.');
    }

    const notice = await this.noticeFor(companyId, employeeId);
    const lwd = new Date(data.intendedLastWorkingDay);
    const short = Math.max(0, Math.round((notice.earliest.getTime() - this.dayStart(lwd).getTime()) / 86400000));
    const mgr = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { manager: { select: { id: true, user: { select: { status: true } } } } } });
    const hasManager = !!mgr?.manager && mgr.manager.user?.status !== 'SUSPENDED';
    const resignation = await this.prisma.resignation.create({
      data: {
        companyId,
        employeeId,
        reason: data.reason,
        intendedLastWorkingDay: lwd,
        // Offboarding part 1 (20 Nov 2026): Manager → HR → Super Admin.
        stage: hasManager ? 'MANAGER' : 'HR',
        noticeDays: notice.days,
        earliestLastWorkingDay: notice.earliest,
        shortNoticeDays: short || null,
        approvals: [{ stage: 'SUBMITTED', decision: 'SUBMITTED', at: new Date().toISOString(), by: 'Employee' }] as any,
      }
    });

    // Notify Manager and HR/Admin users
    const emp = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { manager: true }
    });

    const empName = emp ? `${emp.firstName} ${emp.lastName}` : 'An employee';
    const notifyUserIds = new Set<number>();

    if (emp?.manager?.userId) {
      notifyUserIds.add(emp.manager.userId);
    }

    // Always notify HR/Admin users in the company (exclude the submitting employee's own user)
    const hrAdmins = await this.prisma.user.findMany({
      where: {
        companyId,
        role: { in: ['HR', 'ADMIN', 'SUPERADMIN'] },
        ...(emp?.userId ? { id: { not: emp.userId } } : {}),
      },
      select: { id: true },
    });
    for (const u of hrAdmins) notifyUserIds.add(u.id);

    for (const uid of notifyUserIds) {
      await this.notificationsService.createNotification(
        uid,
        'Resignation Submitted',
        `${empName} has submitted their resignation.`,
        'ACTION_REQUIRED',
        '/offboarding'
      );
    }

    return resignation;
  }

  async updateResignationStatus(
    companyId: number,
    resignationId: number,
    userId: number,
    status: string,
    approvedLastWorkingDay?: Date,
    remarks?: string,
    actor?: { role: string; employeeId?: number | null },
  ) {
    const resignation = await this.prisma.resignation.findFirst({
      where: { id: resignationId, companyId },
      include: { employee: true }
    });

    if (!resignation) throw new NotFoundException('Resignation not found');
    // A manager decides only for people who report to them (the list they
    // see is already limited the same way), and never for their own.
    if (actor?.role === 'MANAGER') {
      if (!actor.employeeId || resignation.employee.managerId !== actor.employeeId) {
        throw new ForbiddenException('You can only decide resignations of people who report to you');
      }
    }

    const updated = await this.prisma.resignation.update({
      where: { id: resignationId },
      data: {
        status,
        approvedLastWorkingDay: approvedLastWorkingDay ? new Date(approvedLastWorkingDay) : null,
        approverId: userId,
        remarks
      }
    });

    // Approval may be changed inline in the register. Only the first transition
    // into APPROVED creates clearance tasks; later edits must not duplicate them.
    if (status === 'APPROVED' && resignation.status !== 'APPROVED') {
      // Update Employee Status
      await this.prisma.employee.update({
        where: { id: resignation.employeeId },
        data: { offboardingStatus: 'IN_PROGRESS' }
      });

      // 20 Nov 2026: no department tasks any more — clearance is HR / Super Admin
      // verifying each section of the handover form (see verifyClearance).

      // Notify employee
      await this.notificationsService.createNotification(
        resignation.employee.userId,
        'Resignation Approved',
        `Your resignation has been approved. Your last working day is set to ${approvedLastWorkingDay ? new Date(approvedLastWorkingDay).toLocaleDateString() : 'TBD'}.`,
        'INFO',
        '/offboarding'
      );
    } else if (status === 'WITHDRAWN' || status === 'REJECTED') {
         await this.prisma.employee.update({
            where: { id: resignation.employeeId },
            data: { offboardingStatus: 'NONE' }
          });
    }

    return updated;
  }

  findResignation(companyId: number, id: number) {
    return this.prisma.resignation.findFirst({ where: { id, companyId }, select: { id: true, status: true } });
  }

  // ── Offboarding part 1 (20 Nov 2026): notice, HR-started exits, approval chain ──
  static readonly DEFAULT_NOTICE = { PROBATION: 15, CONFIRMED: 30, TRAINEE: 7, CONTRACT: 15 };

  private dayStart(d: Date) { const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x; }

  async getNoticePolicy(companyId: number) {
    const s = await this.prisma.systemSetting.findUnique({ where: { companyId }, select: { noticePolicy: true } });
    return { ...OffboardingService.DEFAULT_NOTICE, ...((s?.noticePolicy as any) || {}) };
  }

  async saveNoticePolicy(companyId: number, role: string, body: any) {
    if (!['SUPERADMIN', 'ADMIN', 'HR'].includes(role)) throw new ForbiddenException('Only HR can change notice periods.');
    const clean: any = {};
    for (const k of Object.keys(OffboardingService.DEFAULT_NOTICE)) {
      const n = Number(body?.[k]);
      if (!Number.isFinite(n) || n < 0 || n > 180) throw new BadRequestException(`${k}: notice days must be 0–180.`);
      clean[k] = Math.round(n);
    }
    await this.prisma.systemSetting.upsert({ where: { companyId }, update: { noticePolicy: clean }, create: { companyId, noticePolicy: clean } as any });
    return clean;
  }

  /** Notice days for this person by type: trainee, contract, on probation, or confirmed. */
  async noticeFor(companyId: number, employeeId: number, from = new Date()) {
    const policy = await this.getNoticePolicy(companyId);
    const e = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { employmentCategory: true, payType: true, probationEndDate: true, probationConfirmedAt: true } });
    let type: keyof typeof OffboardingService.DEFAULT_NOTICE = 'CONFIRMED';
    if (e?.employmentCategory === 'TRAINEE') type = 'TRAINEE';
    else if (e?.employmentCategory === 'CONTRACT' || e?.payType === 'CONSULTANT') type = 'CONTRACT';
    else if (e?.probationEndDate && !e?.probationConfirmedAt) type = 'PROBATION';
    const days = Number((policy as any)[type]) || 0;
    const earliest = this.dayStart(new Date(from.getTime() + days * 86400000));
    return { type, days, earliest };
  }

  private async actorName(userId: number) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, employee: { select: { firstName: true, lastName: true } } } });
    return u?.employee ? `${u.employee.firstName} ${u.employee.lastName ?? ''}`.trim() : u?.email ?? 'Someone';
  }

  private async notifyStage(companyId: number, resignationId: number, stage: string, empName: string, managerUserId?: number | null) {
    const ids = new Set<number>();
    if (stage === 'MANAGER' && managerUserId) ids.add(managerUserId);
    if (stage === 'HR' || stage === 'SUPERADMIN') {
      const roles = stage === 'HR' ? ['HR', 'ADMIN'] : ['SUPERADMIN'];
      (await this.prisma.user.findMany({ where: { companyId, role: { in: roles }, status: { not: 'SUSPENDED' } }, select: { id: true } })).forEach((u) => ids.add(u.id));
    }
    const who = stage === 'MANAGER' ? 'manager' : stage === 'HR' ? 'HR' : 'Super Admin';
    for (const uid of ids) {
      await this.notificationsService.createNotification(uid, 'Exit waiting for your approval', `${empName}'s exit is waiting for ${who} approval.`, 'ACTION_REQUIRED', '/offboarding', companyId).catch(() => undefined);
    }
  }

  /** HR starts an exit: resignation on behalf, termination, absconding or contract end. */
  async initiateExit(companyId: number, actor: { userId: number; role: string }, body: {
    employeeId: number; exitType: string; reason: string; lastWorkingDay: string; documentUrl?: string; shortNoticeAction?: string;
  }) {
    if (!['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role)) throw new ForbiddenException('Only HR can start an exit.');
    const types = ['RESIGNATION', 'TERMINATION', 'ABSCONDING', 'CONTRACT_END'];
    const exitType = String(body?.exitType || '').toUpperCase();
    if (!types.includes(exitType)) throw new BadRequestException('Pick an exit type.');
    if (!String(body?.reason || '').trim()) throw new BadRequestException('Add a reason.');
    if (!body?.lastWorkingDay || isNaN(Date.parse(body.lastWorkingDay))) throw new BadRequestException('Pick the last working day.');
    const emp = await this.prisma.employee.findFirst({ where: { id: Number(body.employeeId), companyId }, select: { id: true, firstName: true, lastName: true, userId: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    const open = await this.prisma.resignation.findFirst({ where: { employeeId: emp.id, status: { in: ['PENDING', 'APPROVED'] } } });
    if (open) throw new BadRequestException('This person already has an open or approved exit.');
    const lwd = this.dayStart(new Date(body.lastWorkingDay));
    // Notice applies to resignations; termination / absconding / contract end have none.
    const notice = exitType === 'RESIGNATION' ? await this.noticeFor(companyId, emp.id) : { days: 0, earliest: lwd };
    const short = Math.max(0, Math.round((notice.earliest.getTime() - lwd.getTime()) / 86400000));
    if (short > 0 && !['WAIVE', 'RECOVER'].includes(String(body.shortNoticeAction || ''))) {
      throw new BadRequestException(`Notice is ${short} day(s) short — choose waive or recover in FNF.`);
    }
    const byName = await this.actorName(actor.userId);
    const finalNow = actor.role === 'SUPERADMIN';
    const r = await this.prisma.resignation.create({
      data: {
        companyId, employeeId: emp.id, reason: body.reason.trim(), intendedLastWorkingDay: lwd,
        exitType, initiatedById: actor.userId, documentUrl: body.documentUrl || null,
        noticeDays: notice.days, earliestLastWorkingDay: notice.earliest,
        shortNoticeDays: short || null, shortNoticeAction: short ? body.shortNoticeAction : null,
        stage: 'SUPERADMIN',
        approvals: [{ stage: 'HR', decision: 'INITIATED', byUserId: actor.userId, byName, at: new Date().toISOString(), note: body.reason.trim() }] as any,
      },
    });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'EXIT_INITIATED', entityType: 'Resignation', entityId: String(r.id), newValue: { employeeId: emp.id, exitType, lastWorkingDay: lwd, shortNoticeAction: r.shortNoticeAction } as any } }).catch(() => undefined);
    if (finalNow) return this.decideExit(companyId, r.id, actor, { decision: 'APPROVE', note: 'Started by Super Admin', lastWorkingDay: body.lastWorkingDay });
    await this.notifyStage(companyId, r.id, 'SUPERADMIN', `${emp.firstName} ${emp.lastName ?? ''}`.trim());
    return r;
  }

  /** One step of Manager → HR → Super Admin. */
  async decideExit(companyId: number, id: number, actor: { userId: number; role: string; employeeId?: number | null }, body: {
    decision: string; note?: string; lastWorkingDay?: string; shortNoticeAction?: string;
  }) {
    const r = await this.prisma.resignation.findFirst({ where: { id, companyId }, include: { employee: { select: { id: true, firstName: true, lastName: true, managerId: true, userId: true, manager: { select: { userId: true } } } } } });
    if (!r) throw new NotFoundException('Exit not found');
    if (r.status !== 'PENDING') throw new BadRequestException('This exit is already decided.');
    const decision = String(body?.decision || '').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) throw new BadRequestException('Approve or reject.');
    const isSA = actor.role === 'SUPERADMIN';
    const isHr = ['HR', 'ADMIN'].includes(actor.role) || isSA;
    if (r.stage === 'MANAGER' && !(isSA || (actor.employeeId && r.employee.managerId === actor.employeeId))) throw new ForbiddenException('Waiting for the reporting manager.');
    if (r.stage === 'HR' && !isHr) throw new ForbiddenException('Waiting for HR.');
    if (r.stage === 'SUPERADMIN' && !isSA) throw new ForbiddenException('Waiting for the Super Admin.');
    if (decision === 'REJECT' && !String(body.note || '').trim()) throw new BadRequestException('Say why it is rejected.');

    const byName = await this.actorName(actor.userId);
    const log = [...(((r.approvals as any) || []) as any[]), { stage: r.stage, decision, byUserId: actor.userId, byName, at: new Date().toISOString(), note: body.note?.trim() || null }];
    const empName = `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim();

    if (decision === 'REJECT') {
      await this.prisma.resignation.update({ where: { id }, data: { approvals: log as any, stage: 'DONE', remarks: body.note?.trim() } });
      await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'EXIT_REJECTED', entityType: 'Resignation', entityId: String(id), newValue: { stage: r.stage, note: body.note } as any } }).catch(() => undefined);
      return this.updateResignationStatus(companyId, id, actor.userId, 'REJECTED', undefined, body.note?.trim());
    }

    const data: any = { approvals: log };
    // 20 Nov 2026: a Super Admin's approval is final at any step — they also
    // fix the last working day and short notice, as HR would.
    if (isSA && r.stage !== 'SUPERADMIN') log[log.length - 1].note = [log[log.length - 1].note, 'Final approval by Super Admin (remaining steps skipped)'].filter(Boolean).join(' · ');
    if (r.stage === 'HR' || (isSA && r.stage === 'MANAGER')) {
      // HR fixes the final last working day and the short-notice choice.
      const lwdStr = body.lastWorkingDay || r.intendedLastWorkingDay.toISOString();
      const lwd = this.dayStart(new Date(lwdStr));
      const earliest = r.earliestLastWorkingDay ? this.dayStart(r.earliestLastWorkingDay) : lwd;
      const short = Math.max(0, Math.round((earliest.getTime() - lwd.getTime()) / 86400000));
      if (short > 0 && !['WAIVE', 'RECOVER'].includes(String(body.shortNoticeAction || ''))) {
        throw new BadRequestException(`Notice is ${short} day(s) short — choose waive or recover in FNF.`);
      }
      Object.assign(data, { approvedLastWorkingDay: lwd, shortNoticeDays: short || null, shortNoticeAction: short ? body.shortNoticeAction : null });
    }
    const next = isSA ? 'DONE' : r.stage === 'MANAGER' ? 'HR' : r.stage === 'HR' ? 'SUPERADMIN' : 'DONE';
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'EXIT_APPROVED_STEP', entityType: 'Resignation', entityId: String(id), newValue: { stage: r.stage, next, note: body.note || null } as any } }).catch(() => undefined);
    if (next !== 'DONE') {
      const u = await this.prisma.resignation.update({ where: { id }, data: { ...data, stage: next } });
      await this.notifyStage(companyId, id, next, empName, r.employee.manager?.userId);
      return u;
    }
    await this.prisma.resignation.update({ where: { id }, data: { ...data, stage: 'DONE' } });
    const finalLwd = (data.approvedLastWorkingDay as Date | undefined) || r.approvedLastWorkingDay || r.intendedLastWorkingDay;
    return this.updateResignationStatus(companyId, id, actor.userId, 'APPROVED', finalLwd, body.note?.trim());
  }

  // ── Offboarding part 2 (20 Nov 2026): exit handover form ──
  private async loadExitFor(companyId: number, id: number) {
    const r = await this.prisma.resignation.findFirst({
      where: { id, companyId },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true, userId: true,
        department: { select: { name: true } }, designation: { select: { name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, userId: true } } } } },
    });
    if (!r) throw new NotFoundException('Exit not found');
    return r;
  }

  private canSeeHandover(r: any, actor: { role: string; employeeId?: number | null }) {
    return ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role) || actor.employeeId === r.employeeId || actor.employeeId === r.employee.managerId;
  }

  /** The form: saved answers, or a first draft built from MIRA (tasks, projects, assets). */
  async getHandover(companyId: number, id: number, actor: { role: string; employeeId?: number | null }) {
    const r = await this.loadExitFor(companyId, id);
    if (!this.canSeeHandover(r, actor)) throw new ForbiddenException('Not your exit.');
    const header = {
      employeeName: `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim(), employeeCode: r.employee.employeeCode,
      department: r.employee.department?.name ?? null, designation: r.employee.designation?.name ?? null,
      lastWorkingDay: r.approvedLastWorkingDay || r.intendedLastWorkingDay,
      fnfDueDate: r.fnfDueDate ?? await this.fnfDueDate(companyId, this.dayStart(new Date(r.approvedLastWorkingDay || r.intendedLastWorkingDay))),
      fnfDueDateSet: !!r.fnfDueDate,
      manager: r.employee.manager ? `${r.employee.manager.firstName} ${r.employee.manager.lastName ?? ''}`.trim() : null,
    };
    const meta = {
      submittedAt: r.handoverSubmittedAt, receivedAt: r.handoverReceivedAt, receivedNote: r.handoverReceivedNote,
      clearance: (r.clearance as any) || {}, canVerify: ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role) && r.status === 'APPROVED' && (!!r.handoverReceivedAt || (r.exitType || 'RESIGNATION') !== 'RESIGNATION'),
      canEdit: !r.handoverSubmittedAt && (actor.employeeId === r.employeeId || ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role)),
      canReceive: !!r.handoverSubmittedAt && !r.handoverReceivedAt && (actor.employeeId === r.employee.managerId || ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role)),
    };
    // Every project the person is part of — member or lead, any status (20 Nov 2026).
    const allProjects = (await this.prisma.project.findMany({
      where: { companyId, OR: [{ leadId: r.employeeId }, { members: { some: { employeeId: r.employeeId } } }] },
      select: { id: true, name: true, workStatus: true, client: { select: { name: true } } }, orderBy: { name: 'asc' },
    }).catch(() => [] as any[])).map((p: any) => ({ projectId: p.id, name: p.name, client: p.client?.name ?? '', currentStatus: p.workStatus ?? '', handoverToId: null, status: 'PENDING' }));
    if (r.handover) {
      const saved: any = { ...(r.handover as any) };
      delete saved.work; // Work handover removed 20 Nov 2026
      if (!r.handoverSubmittedAt) {
        const have = new Set((saved.projects || []).map((p: any) => p.projectId));
        saved.projects = [...(saved.projects || []), ...allProjects.filter((p) => !have.has(p.projectId))];
      }
      return { header, form: saved, ...meta };
    }

    const empId = r.employeeId;
    const [projects, assets] = await Promise.all([
      Promise.resolve(allProjects),
      this.prisma.assetAssignment.findMany({
        where: { employeeId: empId, status: 'ACTIVE' },
        select: { id: true, asset: { select: { name: true, assetTag: true, serialNumber: true } } },
      }),
    ]);
    const form = {
      projects,
      assets: [
        ...assets.map((a: any) => ({ assignmentId: a.id, name: a.asset.name, assetId: a.asset.assetTag, serialNo: a.asset.serialNumber ?? '', returned: null, condition: '' })),
        ...['ID card', 'Access card', 'Mobile / SIM'].map((n) => ({ name: n, assetId: '', serialNo: '', returned: null, condition: '' })),
      ],
      documents: { clientDocuments: false, projectFiles: false, passwordTransfer: false, knowledgeTransfer: false },
      remarks: '',
    };
    return { header, form, ...meta };
  }

  private cleanHandover(f: any) {
    const arr = (x: any) => (Array.isArray(x) ? x.slice(0, 100) : []);
    return {
      work: [] as any[], // Work handover removed 20 Nov 2026
      projects: arr(f?.projects).map((p: any) => ({ projectId: p.projectId ?? null, name: String(p.name || '').slice(0, 200), client: String(p.client || '').slice(0, 200), currentStatus: String(p.currentStatus || '').slice(0, 200), handoverToId: p.handoverToId ? Number(p.handoverToId) : null, handoverToName: String(p.handoverToName || '').trim().slice(0, 120) || null, status: ['PENDING', 'DONE'].includes(p.status) ? p.status : 'PENDING' })),
      assets: arr(f?.assets).map((a: any) => ({ assignmentId: a.assignmentId ?? null, name: String(a.name || '').slice(0, 200), assetId: String(a.assetId || '').slice(0, 100), serialNo: String(a.serialNo || '').slice(0, 100), returned: a.returned === true ? true : a.returned === false ? false : null, condition: String(a.condition || '').slice(0, 200) })),
      documents: { clientDocuments: !!f?.documents?.clientDocuments, projectFiles: !!f?.documents?.projectFiles, passwordTransfer: !!f?.documents?.passwordTransfer, knowledgeTransfer: !!f?.documents?.knowledgeTransfer },
      remarks: String(f?.remarks || '').slice(0, 2000),
    };
  }

  async saveHandover(companyId: number, id: number, actor: { userId: number; role: string; employeeId?: number | null }, form: any, submit = false) {
    const r = await this.loadExitFor(companyId, id);
    const isHr = ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role);
    if (!(isHr || actor.employeeId === r.employeeId)) throw new ForbiddenException('Only the employee or HR can fill the handover.');
    if (r.status !== 'APPROVED') throw new BadRequestException('The handover opens once the exit is approved.');
    if (r.handoverSubmittedAt) throw new BadRequestException('The handover was already submitted.');
    const clean = this.cleanHandover(form);
    if (submit) {
      const handoverMissing = [...clean.work, ...clean.projects].some((x: any) => !x.handoverToId && !x.handoverToName);
      if (handoverMissing) throw new BadRequestException('Fill in who takes over every project before submitting.');
      if (clean.assets.some((a: any) => a.returned === null && (a.assignmentId || a.assetId))) throw new BadRequestException('Mark every assigned asset as returned or not.');
    }
    const u = await this.prisma.resignation.update({
      where: { id }, data: { handover: clean as any, ...(submit ? { handoverSubmittedAt: new Date(), handoverSubmittedById: actor.userId } : {}) },
    });
    if (submit) {
      await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'EXIT_HANDOVER_SUBMITTED', entityType: 'Resignation', entityId: String(id), newValue: { items: clean.work.length + clean.projects.length, assets: clean.assets.length } as any } }).catch(() => undefined);
      const to = r.employee.manager?.userId;
      if (to) await this.notificationsService.createNotification(to, 'Handover submitted', `${r.employee.firstName} ${r.employee.lastName ?? ''} submitted their exit handover. Please check and mark it received.`, 'ACTION_REQUIRED', '/offboarding', companyId).catch(() => undefined);
    }
    return u;
  }

  async receiveHandover(companyId: number, id: number, actor: { userId: number; role: string; employeeId?: number | null }, note?: string) {
    const r = await this.loadExitFor(companyId, id);
    const isHr = ['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role);
    if (!(isHr || actor.employeeId === r.employee.managerId)) throw new ForbiddenException('Only the manager or HR can receive the handover.');
    if (!r.handoverSubmittedAt) throw new BadRequestException('The handover is not submitted yet.');
    if (r.handoverReceivedAt) throw new BadRequestException('Already marked received.');
    const u = await this.prisma.resignation.update({ where: { id }, data: { handoverReceivedAt: new Date(), handoverReceivedById: actor.userId, handoverReceivedNote: note?.trim() || null } });
    // Part 3: the manager's clearance line clears itself.
    await this.prisma.offboardingTask.updateMany({ where: { companyId, employeeId: r.employeeId, department: 'MANAGER', status: 'PENDING' }, data: { status: 'CLEARED', clearedById: actor.userId, remarks: 'Handover received' } });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'EXIT_HANDOVER_RECEIVED', entityType: 'Resignation', entityId: String(id), newValue: { note: note || null } as any } }).catch(() => undefined);
    return u;
  }

  // ── Offboarding part 3 (20 Nov 2026): reportees + separation on the last day ──
  async setReporteesTo(companyId: number, id: number, role: string, managerId: number | null, extra: { lastWorkingDay?: string; fnfDueDate?: string; actorUserId?: number } = {}) {
    if (!['SUPERADMIN', 'ADMIN', 'HR'].includes(role)) throw new ForbiddenException('Only HR can choose this.');
    const r = await this.prisma.resignation.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Exit not found');
    if (managerId) {
      const m = await this.prisma.employee.findFirst({ where: { id: managerId, companyId, user: { status: { not: 'SUSPENDED' } } }, select: { id: true } });
      if (!m || m.id === r.employeeId) throw new BadRequestException('Pick an active colleague.');
    }
    const data: any = { reporteesToId: managerId || null };
    // Last working day + FNF date (20 Nov 2026), HR can change both until separation.
    if (extra.lastWorkingDay) {
      if (r.separatedAt) throw new BadRequestException('Already separated — the last working day can no longer change.');
      const lwd = this.dayStart(new Date(extra.lastWorkingDay));
      if (isNaN(lwd.getTime())) throw new BadRequestException('Invalid last working day.');
      data.approvedLastWorkingDay = lwd;
      if (r.earliestLastWorkingDay) {
        const short = Math.max(0, Math.round((this.dayStart(r.earliestLastWorkingDay).getTime() - lwd.getTime()) / 86400000));
        data.shortNoticeDays = short || null;
        if (!short) data.shortNoticeAction = null;
      }
    }
    if (extra.fnfDueDate !== undefined) {
      const due = extra.fnfDueDate ? this.dayStart(new Date(extra.fnfDueDate)) : null;
      const lwd = data.approvedLastWorkingDay || r.approvedLastWorkingDay || r.intendedLastWorkingDay;
      if (due && due.getTime() < this.dayStart(lwd).getTime()) throw new BadRequestException('The FNF date cannot be before the last working day.');
      data.fnfDueDate = due;
    }
    const upd = await this.prisma.resignation.update({ where: { id }, data });
    const draft = await this.prisma.fnfSettlement.findUnique({ where: { resignationId: id } });
    if (draft && draft.status !== 'PAID') {
      const lwd = upd.approvedLastWorkingDay || upd.intendedLastWorkingDay;
      await this.prisma.fnfSettlement.update({ where: { id: draft.id }, data: { lastWorkingDay: lwd, dueDate: upd.fnfDueDate ?? await this.fnfDueDate(companyId, lwd) } });
    }
    if (extra.lastWorkingDay || extra.fnfDueDate !== undefined) {
      await this.prisma.auditLog.create({ data: { companyId, actorId: extra.actorUserId ?? null, action: 'EXIT_DATES_CHANGED', entityType: 'Resignation', entityId: String(id),
        oldValue: { lastWorkingDay: r.approvedLastWorkingDay, fnfDueDate: r.fnfDueDate } as any, newValue: { lastWorkingDay: upd.approvedLastWorkingDay, fnfDueDate: upd.fnfDueDate } as any } }).catch(() => undefined);
    }
    return upd;
  }

  /**
   * Separate one person: login off, status SEPARATED, reportees moved.
   * Runs from the nightly job after the last working day, or by HR on demand.
   */
  async separate(companyId: number, id: number, actorUserId: number | null) {
    const r = await this.prisma.resignation.findFirst({
      where: { id, companyId },
      include: { employee: { select: { id: true, userId: true, managerId: true, firstName: true, lastName: true } } },
    });
    if (!r) throw new NotFoundException('Exit not found');
    if (r.status !== 'APPROVED') throw new BadRequestException('Only an approved exit can be separated.');
    if (r.separatedAt) return r;
    const newManager = r.reporteesToId ?? r.employee.managerId ?? null;
    const moved = await this.prisma.employee.updateMany({ where: { companyId, managerId: r.employeeId, id: { not: r.employeeId } }, data: { managerId: newManager } });
    await this.prisma.user.update({ where: { id: r.employee.userId }, data: { status: 'SUSPENDED' } });
    forgetAccountStatus(r.employee.userId);
    await this.prisma.employee.update({ where: { id: r.employeeId }, data: { offboardingStatus: 'SEPARATED' } });
    const u = await this.prisma.resignation.update({ where: { id }, data: { separatedAt: new Date() } });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actorUserId, action: 'EMPLOYEE_SEPARATED', entityType: 'Resignation', entityId: String(id),
      newValue: { employeeId: r.employeeId, reporteesMoved: moved.count, reporteesTo: newManager, loginDisabled: true } as any } }).catch(() => undefined);
    const name = `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim();
    const hr = await this.prisma.user.findMany({ where: { companyId, role: { in: ['HR', 'SUPERADMIN'] }, status: { not: 'SUSPENDED' } }, select: { id: true } });
    for (const h of hr) {
      await this.notificationsService.createNotification(h.id, 'Employee separated', `${name}'s last working day is over: login switched off${moved.count ? `, ${moved.count} reportee(s) moved` : ''}. Next: FNF.`, 'INFO', '/offboarding', companyId).catch(() => undefined);
    }
    return u;
  }

  /** Nightly: everyone whose approved last working day has ended. */
  async separateDue(now = new Date()) {
    const todayIst = new Date(new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10) + 'T00:00:00Z');
    const due = await this.prisma.resignation.findMany({
      where: { status: 'APPROVED', separatedAt: null, OR: [{ approvedLastWorkingDay: { lte: todayIst } }, { approvedLastWorkingDay: null, intendedLastWorkingDay: { lte: todayIst } }] },
      select: { id: true, companyId: true, approvals: true },
    });
    let n = 0;
    // Only exits approved through the new chain (20 Nov 2026). Older approved
    // exits are separated by HR with "Separate now", never by surprise.
    for (const d of due.filter((x) => Array.isArray(x.approvals) && (x.approvals as any[]).length > 0)) { try { await this.separate(d.companyId, d.id, null); n++; } catch { /* next */ } }
    return n;
  }

  // Clearance Tasks Methods
  async getTasks(companyId: number) {
    return this.prisma.offboardingTask.findMany({
      where: { companyId },
      include: {
        // Name and photo travel with the task: leavers are often already
        // deactivated, so the app cannot look them up in the directory.
        employee: { select: { id: true, userId: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true } },
        clearedBy: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async clearTask(taskId: number, companyId: number, userId: number, remarks?: string, recoveryAmount?: number | null) {
    const task = await this.prisma.offboardingTask.findFirst({
      where: { id: taskId, companyId },
      include: { employee: true }
    });

    if (!task) throw new NotFoundException('Task not found');

    const updatedTask = await this.prisma.offboardingTask.update({
      where: { id: taskId },
      data: {
        status: 'CLEARED',
        clearedById: userId,
        remarks,
        // Offboarding part 3: what to recover in FNF (asset not returned, advance…).
        recoveryAmount: recoveryAmount != null && Number(recoveryAmount) > 0 ? Math.round(Number(recoveryAmount) * 100) / 100 : null,
      }
    });

    // Check if all tasks are cleared
    const pendingTasks = await this.prisma.offboardingTask.count({
      where: { employeeId: task.employeeId, status: 'PENDING' }
    });

    if (pendingTasks === 0) {
      await this.notificationsService.createNotification(
        task.employee.userId,
        'Offboarding Completed',
        `All clearance tasks have been completed.`,
        'INFO',
        '/offboarding'
      );
    }

    return updatedTask;
  }

  // Exit Interview Methods
  async submitExitInterview(companyId: number, employeeId: number, data: { feedback: string, rating: number }, interviewerId: number) {
    return this.prisma.exitInterview.create({
      data: {
        companyId,
        employeeId,
        feedback: data.feedback,
        rating: data.rating,
        interviewerId,
        completedAt: new Date()
      }
    });
  }

  async getExitInterviews(companyId: number) {
    return this.prisma.exitInterview.findMany({
      where: { companyId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true } },
        interviewer: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // ─── Part 4: Full & Final settlement (20 Nov 2026) ───────────────────────
  // Rules: last salary (from the month after the last payslip up to LWD) with
  // LOP for every unworked working day (holidays, week offs and approved paid
  // leave are paid); no leave encashment; asset recovery from clearance;
  // notice recovery when HR chose RECOVER; manual lines for PF/PT/TDS/advances.
  // Due 45 days after LWD, company holidays not counted.
  // Flow: HR prepares (DRAFT) → submit → Super Admin approves → HR marks paid.

  private isHrRole(role: string) { return ['SUPERADMIN', 'ADMIN', 'HR'].includes(role); }
  private r2(n: number) { return Math.round((Number(n) || 0) * 100) / 100; }
  private dKey(d: Date) { return d.toISOString().slice(0, 10); }

  private async fnfDueDate(companyId: number, lwd: Date) {
    const end = new Date(lwd.getTime() + 120 * 86400000);
    const hol = new Set((await this.prisma.holiday.findMany({ where: { companyId, isOptional: false, date: { gt: lwd, lte: end } }, select: { date: true } })).map((h) => this.dKey(h.date)));
    let d = new Date(Date.UTC(lwd.getUTCFullYear(), lwd.getUTCMonth(), lwd.getUTCDate()));
    let n = 0;
    while (n < 45) { d = new Date(d.getTime() + 86400000); if (!hol.has(this.dKey(d))) n++; }
    return d;
  }

  /** Works out the automatic lines. Manual lines are kept by the caller. */
  private async computeFnf(companyId: number, r: any) {
    const empId = r.employeeId;
    const lwdRaw = new Date(r.approvedLastWorkingDay ?? r.intendedLastWorkingDay);
    let lwd = new Date(Date.UTC(lwdRaw.getUTCFullYear(), lwdRaw.getUTCMonth(), lwdRaw.getUTCDate()));
    // Separated before the planned last day ("Separate now"): pay only up to the
    // day they were separated (IST date).
    if (r.separatedAt) {
      const ist = new Date(new Date(r.separatedAt).getTime() + 330 * 60000);
      const sepDay = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
      if (sepDay.getTime() < lwd.getTime()) lwd = sepDay;
    }
    const emp = await this.prisma.employee.findUnique({
      where: { id: empId },
      select: { id: true, joiningDate: true, weeklyOffs: true, shift: { select: { workingDays: true } }, branch: { select: { weeklyOffs: true } } },
    });
    const structure = await this.prisma.salaryStructure.findMany({ where: { employeeId: empId }, include: { component: { select: { name: true, type: true } } } });
    const earnings = structure.filter((s) => s.component.type !== 'DEDUCTION' && s.amount > 0);
    const deductions = structure.filter((s) => s.component.type === 'DEDUCTION' && s.amount > 0);
    const gross = earnings.reduce((t, s) => t + s.amount, 0);

    // Start: the month after the last PAID payslip (draft slips don't count), else the LWD month; never before joining.
    const last = await this.prisma.payslip.findFirst({ where: { employeeId: empId, status: 'PAID' }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { month: true, year: true } });
    let start = new Date(Date.UTC(lwd.getUTCFullYear(), lwd.getUTCMonth(), 1));
    if (last) {
      const after = new Date(Date.UTC(last.year, last.month, 1)); // 1st of the month after the slip
      if (after.getTime() < start.getTime()) start = after;
      if (after.getTime() > lwd.getTime()) start = after; // already paid through LWD
    }
    if (emp?.joiningDate) {
      const j = new Date(emp.joiningDate);
      const jd = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
      if (jd.getTime() > start.getTime()) start = jd;
    }

    const lines: any[] = [];
    const months: any[] = [];
    let lopTotalDays = 0;
    if (start.getTime() <= lwd.getTime()) {
      const pad = 86400000;
      const [att, leaves, holidays, roster] = await Promise.all([
        this.prisma.attendance.findMany({ where: { employeeId: empId, date: { gte: start, lte: lwd } }, select: { date: true, status: true } }),
        this.prisma.leaveRequest.findMany({
          where: { employeeId: empId, status: 'APPROVED', deletedAt: null, startDate: { lte: new Date(lwd.getTime() + pad) }, endDate: { gte: new Date(start.getTime() - pad) } },
          select: { startDate: true, endDate: true, isHalfDay: true, leaveType: { select: { isPaid: true } } },
        }),
        this.prisma.holiday.findMany({ where: { companyId, isOptional: false, date: { gte: new Date(start.getTime() - pad), lte: new Date(lwd.getTime() + pad) } }, select: { date: true } }),
        this.prisma.shiftRosterEntry.findMany({ where: { employeeId: empId, date: { gte: start, lte: lwd } }, select: { date: true, isDayOff: true } }),
      ]);
      const attBy = new Map(att.map((a) => [this.dKey(a.date), a.status]));
      const holSet = new Set(holidays.map((h) => this.dKey(h.date)));
      const rosterBy = new Map(roster.map((x) => [this.dKey(x.date), x]));
      const rule = personalDaysOff(emp as any);
      const today = this.dKey(new Date());

      for (let m = new Date(start); m.getTime() <= lwd.getTime(); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
        const y = m.getUTCFullYear(), mo = m.getUTCMonth();
        const dim = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const from = m.getTime() > start.getTime() ? m : start;
        const monthEnd = new Date(Date.UTC(y, mo, dim));
        const to = monthEnd.getTime() < lwd.getTime() ? monthEnd : lwd;
        let days = 0, lop = 0, projected = 0;
        const lopDates: string[] = [];
        for (let d = new Date(from); d.getTime() <= to.getTime(); d = new Date(d.getTime() + 86400000)) {
          days++;
          const k = this.dKey(d);
          if (holSet.has(k)) continue;
          if (isRestDay(d, rosterBy.get(k) as any, rule.shiftWorkingDays, rule.weeklyOffs)) continue;
          const lv = leaves.find((l) => this.dKey(l.startDate) <= k && this.dKey(l.endDate) >= k);
          const st = attBy.get(k);
          let miss = 0;
          if (lv) {
            if (lv.leaveType?.isPaid === false) miss = lv.isHalfDay ? (st === 'PRESENT' || st === 'HALF_DAY' ? 0.5 : 1) : 1;
            else miss = lv.isHalfDay && !st ? 0.5 : 0;
          } else if (st === 'PRESENT') miss = 0;
          else if (st === 'HALF_DAY') miss = 0.5;
          else if (k > today) { projected++; miss = 0; }
          else miss = 1;
          if (miss) { lop += miss; lopDates.push(miss === 1 ? k : `${k} (½)`); }
        }
        const perDay = dim ? gross / dim : 0;
        const label = new Date(Date.UTC(y, mo, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
        months.push({ month: label, daysInMonth: dim, days, lopDays: lop, projectedDays: projected, perDay: this.r2(perDay), lopDates });
        lopTotalDays += lop;
        lines.push({ key: `salary-${y}-${mo + 1}`, label: `Salary ${label} (${days} of ${dim} days)`, type: 'EARNING', amount: this.r2(perDay * days), auto: true });
        if (lop) lines.push({ key: `lop-${y}-${mo + 1}`, label: `Loss of pay ${label} (${lop} day${lop === 1 ? '' : 's'})`, type: 'DEDUCTION', amount: this.r2(perDay * lop), auto: true });
        for (const dd of deductions) {
          lines.push({ key: `ded-${dd.componentId}-${y}-${mo + 1}`, label: `${dd.component.name} ${label}`, type: 'DEDUCTION', amount: this.r2((dd.amount / dim) * Math.max(0, days - lop)), auto: true });
        }
      }
    }

    // Notice recovery (HR chose RECOVER): short days × daily gross of the LWD month.
    const lwdDim = new Date(Date.UTC(lwd.getUTCFullYear(), lwd.getUTCMonth() + 1, 0)).getUTCDate();
    if (r.shortNoticeAction === 'RECOVER' && (r.shortNoticeDays || 0) > 0) {
      lines.push({ key: 'notice', label: `Notice recovery (${r.shortNoticeDays} days short)`, type: 'DEDUCTION', amount: this.r2((gross / lwdDim) * r.shortNoticeDays), auto: true });
    }
    // Asset / clearance recovery.
    const tasks = await this.prisma.offboardingTask.findMany({ where: { employeeId: empId, companyId, recoveryAmount: { gt: 0 } }, select: { id: true, department: true, taskName: true, recoveryAmount: true } });
    for (const t of tasks) lines.push({ key: `task-${t.id}`, label: `Recovery: ${t.taskName} (${t.department})`, type: 'DEDUCTION', amount: this.r2(t.recoveryAmount!), auto: true });
    const assetRec = Number((r.clearance as any)?.assets?.recoveryAmount) || 0;
    if (assetRec > 0) lines.push({ key: 'clearance-assets', label: `Recovery: assets not returned / damaged${(r.clearance as any)?.assets?.note ? ' — ' + (r.clearance as any).assets.note : ''}`, type: 'DEDUCTION', amount: this.r2(assetRec), auto: true });

    return {
      lwd, lines,
      basis: { grossMonthly: this.r2(gross), periodStart: this.dKey(start), lastPayslip: last ? `${last.month}/${last.year}` : null, months, lopDays: lopTotalDays, noStructure: !structure.length },
    };
  }

  private fnfTotals(lines: any[]) {
    const e = lines.filter((l) => l.type === 'EARNING').reduce((t, l) => t + (Number(l.amount) || 0), 0);
    const d = lines.filter((l) => l.type === 'DEDUCTION').reduce((t, l) => t + (Number(l.amount) || 0), 0);
    return { totalEarnings: this.r2(e), totalDeductions: this.r2(d), netPayable: this.r2(e - d) };
  }

  async listFnf(companyId: number, role: string) {
    if (!this.isHrRole(role)) throw new ForbiddenException('Only HR can see settlements.');
    const [rows, ready] = await Promise.all([
      this.prisma.fnfSettlement.findMany({ where: { companyId }, orderBy: { dueDate: 'asc' } }),
      this.prisma.resignation.findMany({ where: { companyId, status: 'APPROVED' }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, department: { select: { name: true } } } } } }),
    ]);
    const byRes = new Map(rows.map((f) => [f.resignationId, f]));
    return ready.map((r) => ({
      resignationId: r.id, exitType: r.exitType, employee: r.employee,
      lastWorkingDay: r.approvedLastWorkingDay ?? r.intendedLastWorkingDay, separatedAt: r.separatedAt, fnfDueDate: r.fnfDueDate, exitLetterSentAt: r.exitLetterSentAt,
      fnf: byRes.get(r.id) ?? null,
    }));
  }

  async getFnf(companyId: number, role: string, resignationId: number) {
    if (!this.isHrRole(role)) throw new ForbiddenException('Only HR can see settlements.');
    const r = await this.prisma.resignation.findFirst({ where: { id: resignationId, companyId }, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, personalEmail: true, department: { select: { name: true } }, designation: { select: { name: true } } } } } });
    if (!r) throw new NotFoundException('Exit not found');
    const fnf = await this.prisma.fnfSettlement.findUnique({ where: { resignationId } });
    if (fnf) return { resignation: r, fnf, preview: false };
    if (r.status !== 'APPROVED') return { resignation: r, fnf: null, preview: false };
    const c = await this.computeFnf(companyId, r);
    return { resignation: r, fnf: { status: 'NEW', lines: c.lines, basis: c.basis, lastWorkingDay: c.lwd, dueDate: r.fnfDueDate ?? await this.fnfDueDate(companyId, c.lwd), ...this.fnfTotals(c.lines) }, preview: true };
  }

  /** Create, or re-work the automatic lines (manual lines are kept). DRAFT only. */
  async prepareFnf(companyId: number, actor: { userId: number; role: string }, resignationId: number) {
    if (!this.isHrRole(actor.role)) throw new ForbiddenException('Only HR can prepare a settlement.');
    const r = await this.prisma.resignation.findFirst({ where: { id: resignationId, companyId } });
    if (!r) throw new NotFoundException('Exit not found');
    if (r.status !== 'APPROVED') throw new BadRequestException('The exit must be approved first.');
    const existing = await this.prisma.fnfSettlement.findUnique({ where: { resignationId } });
    if (existing && existing.status !== 'DRAFT') throw new BadRequestException('Only a draft can be recalculated.');
    const c = await this.computeFnf(companyId, r);
    const manual = ((existing?.lines as any[]) ?? []).filter((l) => !l.auto);
    const lines = [...c.lines, ...manual];
    const data = { lines, basis: c.basis, lastWorkingDay: c.lwd, dueDate: r.fnfDueDate ?? await this.fnfDueDate(companyId, c.lwd), ...this.fnfTotals(lines) } as any;
    const f = existing
      ? await this.prisma.fnfSettlement.update({ where: { id: existing.id }, data })
      : await this.prisma.fnfSettlement.create({ data: { ...data, companyId, resignationId, employeeId: r.employeeId, preparedById: actor.userId } });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: existing ? 'FNF_RECALCULATED' : 'FNF_PREPARED', entityType: 'FnfSettlement', entityId: String(f.id), newValue: { resignationId, netPayable: f.netPayable } as any } }).catch(() => undefined);
    return f;
  }

  async saveFnf(companyId: number, actor: { userId: number; role: string }, id: number, body: { lines?: any[]; notes?: string }) {
    if (!this.isHrRole(actor.role)) throw new ForbiddenException('Only HR can edit a settlement.');
    const f = await this.prisma.fnfSettlement.findFirst({ where: { id, companyId } });
    if (!f) throw new NotFoundException('Settlement not found');
    if (f.status !== 'DRAFT') throw new BadRequestException('Only a draft can be edited.');
    const lines = (body.lines ?? (f.lines as any[])).map((l: any, i: number) => ({
      key: l.key || `manual-${Date.now()}-${i}`, label: String(l.label || '').trim() || 'Item',
      type: l.type === 'EARNING' ? 'EARNING' : 'DEDUCTION', amount: this.r2(Math.max(0, Number(l.amount) || 0)), auto: !!l.auto, note: l.note ?? null,
    }));
    const upd = await this.prisma.fnfSettlement.update({ where: { id }, data: { lines, notes: body.notes ?? f.notes, ...this.fnfTotals(lines) } as any });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'FNF_EDITED', entityType: 'FnfSettlement', entityId: String(id), oldValue: { netPayable: f.netPayable } as any, newValue: { netPayable: upd.netPayable } as any } }).catch(() => undefined);
    return upd;
  }

  async fnfAction(companyId: number, actor: { userId: number; role: string }, id: number, action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'PAID', body: { note?: string; paidAt?: string; paidRef?: string; paidProofUrl?: string } = {}) {
    const f = await this.prisma.fnfSettlement.findFirst({ where: { id, companyId } });
    if (!f) throw new NotFoundException('Settlement not found');
    let data: any;
    if (action === 'SUBMIT') {
      if (!this.isHrRole(actor.role)) throw new ForbiddenException('Only HR can submit.');
      if (f.status !== 'DRAFT') throw new BadRequestException('Already submitted.');
      data = { status: 'PENDING_APPROVAL', submittedAt: new Date() };
    } else if (action === 'APPROVE' || action === 'REJECT') {
      if (actor.role !== 'SUPERADMIN') throw new ForbiddenException('Only a Super Admin can approve a settlement.');
      if (f.status !== 'PENDING_APPROVAL') throw new BadRequestException('Not waiting for approval.');
      data = action === 'APPROVE'
        ? { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() }
        : { status: 'DRAFT', submittedAt: null, notes: body.note ? `${f.notes ? f.notes + '\n' : ''}Sent back: ${body.note}` : f.notes };
    } else {
      if (!this.isHrRole(actor.role)) throw new ForbiddenException('Only HR can mark it paid.');
      if (f.status !== 'APPROVED') throw new BadRequestException('Approve the settlement first.');
      if (!body.paidProofUrl?.trim()) throw new BadRequestException('Upload the payment proof.');
      data = { paidProofUrl: body.paidProofUrl.trim(), status: 'PAID', paidAt: body.paidAt ? new Date(body.paidAt) : new Date(), paidRef: body.paidRef?.trim() || null, paidById: actor.userId };
    }
    const upd = await this.prisma.fnfSettlement.update({ where: { id }, data });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: `FNF_${action === 'PAID' ? 'PAID' : action + (action.endsWith('E') ? 'D' : 'ED')}`, entityType: 'FnfSettlement', entityId: String(id), oldValue: { status: f.status } as any, newValue: { status: upd.status, note: body.note, paidRef: upd.paidRef, paidProofUrl: upd.paidProofUrl } as any } }).catch(() => undefined);
    // Tell the next person.
    const roles = action === 'SUBMIT' ? ['SUPERADMIN'] : ['HR', 'ADMIN'];
    const users = await this.prisma.user.findMany({ where: { companyId, role: { in: roles }, status: { not: 'SUSPENDED' } }, select: { id: true } });
    const emp = await this.prisma.employee.findUnique({ where: { id: f.employeeId }, select: { firstName: true, lastName: true } });
    const who = `${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`.trim();
    const msg = { SUBMIT: `FNF for ${who} is waiting for your approval.`, APPROVE: `FNF for ${who} was approved — ready to pay.`, REJECT: `FNF for ${who} was sent back${body.note ? ': ' + body.note : ''}.`, PAID: `FNF for ${who} was marked paid.` }[action];
    for (const u of users) await this.notificationsService.createNotification(u.id, 'Full & Final settlement', msg, 'ACTION_REQUIRED', '/offboarding').catch(() => undefined);
    return upd;
  }

  /** The employee takes back their own resignation while it is still pending (20 Nov 2026). */
  async withdrawOwn(companyId: number, id: number, actor: { userId: number; employeeId?: number | null }, note?: string) {
    const r = await this.prisma.resignation.findFirst({ where: { id, companyId }, include: { employee: { select: { firstName: true, lastName: true, manager: { select: { userId: true } } } } } });
    if (!r) throw new NotFoundException('Resignation not found');
    if (!actor.employeeId || r.employeeId !== actor.employeeId) throw new ForbiddenException('You can only withdraw your own resignation.');
    if (r.initiatedById) throw new BadRequestException('This exit was started by HR — please talk to HR.');
    if (r.status !== 'PENDING') throw new BadRequestException(r.status === 'APPROVED' ? 'Already approved — please ask HR to withdraw it.' : 'This resignation is no longer pending.');
    const approvals = Array.isArray(r.approvals) ? (r.approvals as any[]) : [];
    approvals.push({ stage: r.stage, decision: 'WITHDRAWN', byUserId: actor.userId, byName: `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim(), at: new Date().toISOString(), note: note?.trim() || null });
    const upd = await this.prisma.resignation.update({ where: { id }, data: { status: 'WITHDRAWN', stage: 'DONE', approvals: approvals as any, remarks: note?.trim() || r.remarks } });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'RESIGNATION_WITHDRAWN', entityType: 'Resignation', entityId: String(id), oldValue: { status: r.status, stage: r.stage } as any, newValue: { status: 'WITHDRAWN', note: note?.trim() || null } as any } }).catch(() => undefined);
    const ids = new Set<number>();
    if (r.employee.manager?.userId) ids.add(r.employee.manager.userId);
    (await this.prisma.user.findMany({ where: { companyId, role: { in: ['HR', 'ADMIN'] }, status: { not: 'SUSPENDED' } }, select: { id: true } })).forEach((u) => ids.add(u.id));
    ids.delete(actor.userId);
    const who = `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim();
    for (const uid of ids) await this.notificationsService.createNotification(uid, 'Resignation withdrawn', `${who} has withdrawn their resignation.`, 'INFO', '/offboarding').catch(() => undefined);
    return upd;
  }

  // ── Clearance by section (20 Nov 2026): HR / Super Admin verify Projects,
  // Assets & Equipment and Documents & KT of the handover form. ──
  static CLEARANCE_SECTIONS = ['projects', 'assets', 'documents'] as const;

  async verifyClearance(companyId: number, id: number, actor: { userId: number; role: string }, body: { section: string; verified: boolean; note?: string; recoveryAmount?: number }) {
    if (!['SUPERADMIN', 'ADMIN', 'HR'].includes(actor.role)) throw new ForbiddenException('Only HR or a Super Admin can verify clearance.');
    const section = String(body?.section || '');
    if (!(OffboardingService.CLEARANCE_SECTIONS as readonly string[]).includes(section)) throw new BadRequestException('Unknown section.');
    const r = await this.prisma.resignation.findFirst({ where: { id, companyId } });
    if (!r) throw new NotFoundException('Exit not found');
    if (r.status !== 'APPROVED') throw new BadRequestException('The exit must be approved first.');
    const isResignation = (r.exitType || 'RESIGNATION') === 'RESIGNATION';
    if (isResignation && !r.handoverReceivedAt) throw new BadRequestException('The manager has to mark the handover received first.');
    const fnf = await this.prisma.fnfSettlement.findUnique({ where: { resignationId: id } });
    if (fnf && fnf.status !== 'DRAFT') throw new BadRequestException('FNF is already sent for approval — clearance is locked.');
    const clearance: any = { ...((r.clearance as any) || {}) };
    const before = clearance[section] ?? null;
    if (body.verified) {
      const rec = section === 'assets' ? Math.max(0, Math.round((Number(body.recoveryAmount) || 0) * 100) / 100) : undefined;
      clearance[section] = { verified: true, byUserId: actor.userId, byName: await this.actorName(actor.userId), at: new Date().toISOString(), note: body.note?.trim() || null, ...(rec !== undefined ? { recoveryAmount: rec } : {}) };
    } else {
      delete clearance[section];
    }
    const upd = await this.prisma.resignation.update({ where: { id }, data: { clearance } });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: body.verified ? 'EXIT_CLEARANCE_VERIFIED' : 'EXIT_CLEARANCE_REOPENED', entityType: 'Resignation', entityId: String(id), oldValue: { section, before } as any, newValue: { section, after: clearance[section] ?? null } as any } }).catch(() => undefined);
    return upd.clearance;
  }

  // ─── Part 5: relieving & experience letter (20 Nov 2026) ───
  // After FNF is PAID. Template by exit type; CEO signs; logo on top, CEO stamp
  // at the foot; HR previews/edits, then it is emailed as a PDF to the personal
  // email and kept in the employee's letters.

  private async exitLetterTemplate(companyId: number, r: any) {
    const emp = await this.prisma.employee.findUnique({ where: { id: r.employeeId }, select: { employmentCategory: true, employeeCode: true } });
    const isTrainee = String(emp?.employmentCategory || '').toUpperCase() === 'TRAINEE' || /^T/i.test(emp?.employeeCode || '');
    const want = r.exitType === 'TERMINATION' ? 'TERMINATION' : isTrainee ? 'Trainee Relieving' : 'Relieving and Experience';
    const all = await this.prisma.letterTemplate.findMany({ where: { companyId, isActive: true, scope: 'EMPLOYEE' }, select: { id: true, title: true } });
    return all.find((t) => t.title.toLowerCase().includes(want.toLowerCase())) ?? null;
  }

  private async ceoFor(companyId: number) {
    return this.prisma.employee.findFirst({
      where: { companyId, designation: { name: { equals: 'CEO', mode: 'insensitive' } }, user: { status: { not: 'SUSPENDED' } } },
      select: { id: true, firstName: true, lastName: true }, orderBy: { id: 'asc' },
    });
  }

  async getExitLetter(companyId: number, role: string, id: number) {
    if (!this.isHrRole(role)) throw new ForbiddenException('Only HR can send exit letters.');
    const r = await this.prisma.resignation.findFirst({ where: { id, companyId }, include: { employee: { select: { firstName: true, lastName: true, personalEmail: true, user: { select: { email: true } } } } } });
    if (!r) throw new NotFoundException('Exit not found');
    const fnf = await this.prisma.fnfSettlement.findUnique({ where: { resignationId: id }, select: { status: true } });
    const settings = await this.prisma.systemSetting.findUnique({ where: { companyId }, select: { ceoStampUrl: true } });
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { logoUrl: true, name: true } });
    const base = { exitType: r.exitType, fnfPaid: fnf?.status === 'PAID', sentAt: r.exitLetterSentAt, sentTo: r.exitLetterTo, letterId: r.exitLetterId,
      to: r.employee.personalEmail || '', workEmail: r.employee.user?.email || null, logoUrl: company?.logoUrl ?? null, stampUrl: settings?.ceoStampUrl ?? null };
    if (r.exitType === 'ABSCONDING') return { ...base, blocked: 'No relieving letter for absconding.' };
    const tpl = await this.exitLetterTemplate(companyId, r);
    if (!tpl) return { ...base, blocked: 'No matching letter template is active.' };
    const ceo = await this.ceoFor(companyId);
    const p = await this.lettersService.preview(companyId, { templateId: tpl.id, employeeId: r.employeeId, signatoryEmployeeId: ceo?.id });
    return { ...base, templateId: tpl.id, title: p.title, body: p.body, signatory: ceo ? `${ceo.firstName} ${ceo.lastName ?? ''}`.trim() : null };
  }

  private async imageDataUri(url?: string | null) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      return `data:${res.headers['content-type'] || 'image/png'};base64,${Buffer.from(res.data).toString('base64')}`;
    } catch { return null; }
  }

  private async exitLetterPdf(html: string): Promise<{ buffer: Buffer; isPdf: boolean }> {
    try {
      const puppeteer = require('puppeteer');
      const systemChrome = [process.env.PUPPETEER_EXECUTABLE_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((x) => x && fs.existsSync(x));
      const launch = (executablePath?: string) => puppeteer.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const browser = await launch().catch((err: any) => (systemChrome ? launch(systemChrome) : Promise.reject(err)));
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', right: '16mm', bottom: '16mm', left: '16mm' } });
      await browser.close();
      return { buffer: Buffer.from(pdf), isPdf: true };
    } catch {
      return { buffer: Buffer.from(html, 'utf-8'), isPdf: false };
    }
  }

  private async storeExitLetter(buffer: Buffer, isPdf: boolean, name: string): Promise<string | null> {
    const filename = `${name}-${Date.now()}.${isPdf ? 'pdf' : 'html'}`;
    const key = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!key) {
      const dir = path.join(process.cwd(), 'uploads', 'exit_letters');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), buffer);
      return `${(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/uploads/exit_letters/${filename}`;
    }
    try {
      const form = new FormData();
      form.append('file', buffer.toString('base64')); form.append('fileName', filename); form.append('folder', '/exit_letters');
      const res = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, { headers: { ...form.getHeaders(), Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') } });
      return res.data.url;
    } catch { return null; }
  }

  async sendExitLetter(companyId: number, actor: { userId: number; role: string }, id: number, body: { body?: string; to?: string }) {
    const info: any = await this.getExitLetter(companyId, actor.role, id);
    if (info.blocked) throw new BadRequestException(info.blocked);
    if (!info.fnfPaid) throw new BadRequestException('Mark the FNF paid first — letters go out after payment.');
    const to = String(body?.to || info.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BadRequestException('Add a valid personal email.');
    const content = String(body?.body || info.body || '');
    const r = await this.prisma.resignation.findFirst({ where: { id, companyId }, include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } } });
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const [logo, stamp] = await Promise.all([this.imageDataUri(info.logoUrl), this.imageDataUri(info.stampUrl)]);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#111}
      .lh{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #1f3a8a;padding-bottom:8px;margin-bottom:18px}
      .lh img{max-height:56px;max-width:220px}.lh .n{font-weight:700;font-size:16px;color:#1f3a8a}
      .ql-align-center{text-align:center}.ql-align-right{text-align:right}p{margin:0 0 6px}
      .stamp{margin-top:18px}.stamp img{max-height:110px;max-width:220px}
    </style></head><body>
      <div class="lh">${logo ? `<img src="${logo}">` : `<span class="n">${company?.name ?? ''}</span>`}</div>
      ${content}
      ${stamp ? `<div class="stamp"><img src="${stamp}"></div>` : ''}
    </body></html>`;
    const { buffer, isPdf } = await this.exitLetterPdf(html);
    const empName = `${r!.employee.firstName} ${r!.employee.lastName ?? ''}`.trim();
    const pdfUrl = await this.storeExitLetter(buffer, isPdf, `exit-letter-${r!.employee.employeeCode || r!.employeeId}`);
    const letter = await this.prisma.generatedLetter.create({ data: { companyId, employeeId: r!.employeeId, templateId: info.templateId, title: info.title, body: content, pdfUrl, issuedById: actor.userId } });
    await this.mailService.sendExitLetterEmail({ to, employeeName: empName, companyName: company?.name || 'CES Tech', title: info.title, pdf: buffer, fileName: `${info.title.replace(/[^\w]+/g, '-')}-${empName.replace(/\s+/g, '-')}.${isPdf ? 'pdf' : 'html'}`, isPdf });
    const upd = await this.prisma.resignation.update({ where: { id }, data: { exitLetterId: letter.id, exitLetterSentAt: new Date(), exitLetterTo: to } });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actor.userId, action: 'EXIT_LETTER_SENT', entityType: 'Resignation', entityId: String(id), newValue: { letterId: letter.id, title: info.title, to, pdfUrl } as any } }).catch(() => undefined);
    return { sentAt: upd.exitLetterSentAt, to, pdfUrl, letterId: letter.id };
  }

  /**
   * Exit handover reminders for the signed-in person (20 Nov 2026), shown every
   * 5 minutes: the leaver while their handover is not submitted, and the
   * manager while a submitted handover waits to be marked received.
   */
  async myHandoverReminders(companyId: number, employeeId?: number | null) {
    if (!employeeId) return [];
    const rows = await this.prisma.resignation.findMany({
      where: {
        companyId, status: 'APPROVED', separatedAt: null, exitType: 'RESIGNATION',
        OR: [
          { employeeId, handoverSubmittedAt: null },
          { employee: { managerId: employeeId }, handoverSubmittedAt: { not: null }, handoverReceivedAt: null },
        ],
      },
      select: { id: true, employeeId: true, approvedLastWorkingDay: true, intendedLastWorkingDay: true, handoverSubmittedAt: true,
        employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      resignationId: r.id,
      kind: r.employeeId === employeeId ? 'FILL' : 'RECEIVE',
      employeeName: `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim(),
      lastWorkingDay: r.approvedLastWorkingDay ?? r.intendedLastWorkingDay,
    }));
  }
}
