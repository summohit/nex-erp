import {
  DEFAULT_DOCUMENT_POLICY, DocumentRule, documentProgress, loadDocumentPolicy, normaliseDocumentPolicy, requiredRulesFor,
} from './document-policy';
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isHrAdmin } from '../../common/company-roles';
import {
  DOCUMENT_HINTS, EXEMPT_EMAILS, PREVIOUS_EMPLOYMENT_DOCUMENTS, REQUIRED_DOCUMENTS, isIntern,
} from './profile-documents';

export interface MissingItem {
  key: string;
  label: string;
  kind: 'document' | 'details';
  hint?: string;
}

export interface Completeness {
  employeeId: number;
  exempt: boolean;
  complete: boolean;
  missing: MissingItem[];
  /** Asks about previous employment (not interns). */
  canBeFirstJob: boolean;
  firstJob: boolean;
  /** Files uploaded as "Other": a nudge to upload each under its own type. */
  uploadedAsOther: number;
  /** Those files, so the reminder can offer to re-file each one. */
  otherDocuments: { id: number; fileName: string; fileUrl: string }[];
  /** HR's lock is on for this person: the reminder has no close or "later". */
  locked?: boolean;
}

export interface ProfileLock { enabled: boolean; from: string | null; active: boolean }

const SELECT = {
  id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, joiningDate: true,
  phone: true, gender: true, dateOfBirth: true, address: true,
  employmentType: true, firstJob: true, profileExempt: true,
  user: { select: { email: true, status: true } },
  designation: { select: { name: true } },
  department: { select: { name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  documents: { select: { id: true, fileName: true, fileUrl: true, documentType: true } },
  emergencyContacts: { select: { id: true } },
  documentWaivers: { where: { status: 'APPROVED' }, select: { documentType: true } },
} as const;

/**
 * Whether an employee's profile has what HR asked for: the required
 * documents, personal details and an emergency contact. Drives the
 * reminder every employee sees until they are complete, and HR's report.
 */
@Injectable()
export class ProfileCompletenessService {
  constructor(private readonly prisma: PrismaService) {}

  private evaluate(emp: any, policy: DocumentRule[] = DEFAULT_DOCUMENT_POLICY): Completeness {
    const email = String(emp.user?.email ?? '').toLowerCase();
    const exempt = EXEMPT_EMAILS.has(email) || !!emp.profileExempt;
    const intern = isIntern(emp.employmentType, emp.designation?.name);
    // HR's document rules (Settings → Document Requirements, 16 Nov 2026).
    const missing: MissingItem[] = documentProgress(requiredRulesFor(policy, { intern, firstJob: !!emp.firstJob }), emp.documents ?? [],
      (emp.documentWaivers ?? []).map((w: any) => w.documentType))
      .filter((r) => !r.done)
      .map((r) => {
        const hint = [r.hint, r.count > 1 ? `${r.have} of ${r.count} uploaded` : ''].filter(Boolean).join(' · ');
        return { key: r.type, label: r.type, kind: 'document' as const, ...(hint ? { hint } : {}) };
      });

    const details: [string, boolean][] = [
      ['Phone number', !!String(emp.phone ?? '').trim()],
      ['Date of birth', !!emp.dateOfBirth],
      ['Gender', !!String(emp.gender ?? '').trim()],
      ['Address', !!String(emp.address ?? '').trim()],
    ];
    const missingDetails = details.filter(([, ok]) => !ok).map(([l]) => l);
    if (missingDetails.length) {
      missing.push({ key: 'personal-details', label: 'Personal details', kind: 'details', hint: missingDetails.join(', ') });
    }
    if (!(emp.emergencyContacts ?? []).length) {
      missing.push({ key: 'emergency-contact', label: 'Emergency contact', kind: 'details' });
    }

    return {
      employeeId: emp.id,
      exempt,
      complete: exempt || missing.length === 0,
      missing: exempt ? [] : missing,
      canBeFirstJob: !intern,
      firstJob: !!emp.firstJob,
      uploadedAsOther: (emp.documents ?? []).filter((d: any) => d.documentType === 'Other').length,
      otherDocuments: exempt ? [] : (emp.documents ?? [])
        .filter((d: any) => d.documentType === 'Other')
        .map((d: any) => ({ id: d.id, fileName: d.fileName, fileUrl: d.fileUrl })),
    };
  }

  /** The signed-in person's own status, for the reminder. */
  async mine(companyId: number, employeeId: number | null): Promise<Completeness | null> {
    if (employeeId == null) return null;
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: SELECT });
    if (!emp) return null;
    const c = this.evaluate(emp, await loadDocumentPolicy(this.prisma, companyId));
    const lock = await this.getLock(companyId);
    return { ...c, locked: lock.active && !c.exempt && !c.complete };
  }

  /** HR's lock: on/off, the date it starts, and whether it is in force now. */
  async getLock(companyId: number): Promise<ProfileLock> {
    const s = await this.prisma.systemSetting.findUnique({
      where: { companyId }, select: { profileLockEnabled: true, profileLockFrom: true },
    });
    const enabled = !!s?.profileLockEnabled;
    const from = s?.profileLockFrom ?? null;
    // Stored as midnight IST of the chosen day; read it back as that same IST day.
    const fromIst = from ? new Date(from.getTime() + 330 * 60_000).toISOString().slice(0, 10) : null;
    return { enabled, from: fromIst, active: enabled && (!from || from.getTime() <= Date.now()) };
  }

  /** HR, admins and the super admin turn the lock on or off and set its start date. */
  async setLock(companyId: number, role: string, body: { enabled?: boolean; from?: string | null }): Promise<ProfileLock> {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can change the profile lock');
    const from = body?.from && /^\d{4}-\d{2}-\d{2}$/.test(body.from)
      // The date in IST: the lock starts at midnight India time on that day.
      ? new Date(`${body.from}T00:00:00+05:30`)
      : null;
    await this.prisma.systemSetting.upsert({
      where: { companyId },
      create: { companyId, profileLockEnabled: !!body?.enabled, profileLockFrom: from },
      update: { profileLockEnabled: !!body?.enabled, profileLockFrom: from },
    });
    return this.getLock(companyId);
  }

  /**
   * Who never sees the document reminder or lock: the fixed accounts in
   * EXEMPT_EMAILS, plus anyone HR has excused from the Profile Completion page.
   */
  async listExempt(companyId: number, role: string) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can manage exemptions');
    const emps = await this.prisma.employee.findMany({
      where: { companyId, OR: [{ profileExempt: true }, { user: { email: { in: [...EXEMPT_EMAILS], mode: 'insensitive' } } }] },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, profileExempt: true,
        user: { select: { email: true } }, designation: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }],
    });
    return emps.map((e) => ({
      id: e.id, firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode, avatarUrl: e.avatarUrl,
      email: e.user?.email ?? null, designation: e.designation?.name ?? null,
      // Built-in accounts cannot be removed from the page.
      fixed: EXEMPT_EMAILS.has(String(e.user?.email ?? '').toLowerCase()),
    }));
  }

  async setExempt(companyId: number, role: string, employeeId: number, exempt: boolean) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can manage exemptions');
    const res = await this.prisma.employee.updateMany({ where: { id: employeeId, companyId }, data: { profileExempt: !!exempt } });
    if (!res.count) throw new BadRequestException('Employee not found');
    return this.listExempt(companyId, role);
  }

  /** The document rules, for upload lists and the settings page. */
  getDocumentPolicy(companyId: number) {
    return loadDocumentPolicy(this.prisma, companyId);
  }

  /** HR / Super Admin replace the document rules. */
  async saveDocumentPolicy(companyId: number, role: string, rules: unknown) {
    if (!['SUPERADMIN', 'HR'].includes(role)) throw new ForbiddenException('Only HR or the Super Admin can change document requirements');
    if (!Array.isArray(rules) || !rules.length) throw new BadRequestException('Send at least one document type');
    const policy = normaliseDocumentPolicy(rules);
    await this.prisma.systemSetting.upsert({
      where: { companyId },
      create: { companyId, documentPolicy: policy as any },
      update: { documentPolicy: policy as any },
    });
    return policy;
  }

  // ── Document waivers (16 Nov 2026) ─────────────────────────────────────
  // HR asks the Super Admin to waive a required document someone cannot
  // provide; a Super Admin waives directly. Approved = counts as uploaded.

  private static readonly WAIVER_SELECT = {
    id: true, employeeId: true, documentType: true, reason: true, status: true,
    decidedAt: true, decisionNote: true, createdAt: true,
    employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
    requestedBy: { select: { id: true, firstName: true, lastName: true } },
    decidedBy: { select: { id: true, firstName: true, lastName: true } },
  } as const;

  /** One person's waivers, newest first (shown on their Documents tab). */
  async listWaivers(companyId: number, employeeId: number) {
    return this.prisma.documentWaiver.findMany({
      where: { employeeId, employee: { companyId } },
      select: ProfileCompletenessService.WAIVER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The Super Admin's queue. */
  async pendingWaivers(companyId: number, role: string) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin reviews document waivers');
    return this.prisma.documentWaiver.findMany({
      where: { status: 'PENDING', employee: { companyId } },
      select: ProfileCompletenessService.WAIVER_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async requestWaiver(companyId: number, role: string, actorEmployeeId: number | null, employeeId: number, documentType: string, reason: string) {
    if (role !== 'SUPERADMIN' && !isHrAdmin(role)) throw new ForbiddenException('Only HR or the Super Admin can waive a document');
    const type = String(documentType ?? '').trim();
    const why = String(reason ?? '').trim();
    if (!type) throw new BadRequestException('Which document?');
    if (why.length < 5) throw new BadRequestException('Say why this document cannot be provided.');
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { id: true } });
    if (!emp) throw new BadRequestException('Employee not found');
    const open = await this.prisma.documentWaiver.findFirst({
      where: { employeeId, documentType: type, status: { in: ['PENDING', 'APPROVED'] } }, select: { status: true },
    });
    if (open) throw new BadRequestException(open.status === 'APPROVED' ? 'This document is already waived.' : 'A waiver for this document is already waiting for the Super Admin.');
    const direct = role === 'SUPERADMIN';
    return this.prisma.documentWaiver.create({
      data: {
        employeeId, documentType: type, reason: why, requestedById: actorEmployeeId,
        ...(direct ? { status: 'APPROVED', decidedById: actorEmployeeId, decidedAt: new Date() } : {}),
      },
      select: ProfileCompletenessService.WAIVER_SELECT,
    });
  }

  async decideWaiver(companyId: number, role: string, actorEmployeeId: number | null, waiverId: number, action: 'APPROVE' | 'REJECT', note?: string) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin reviews document waivers');
    const w = await this.prisma.documentWaiver.findFirst({ where: { id: waiverId, employee: { companyId } }, select: { id: true, status: true } });
    if (!w) throw new BadRequestException('Waiver not found');
    if (w.status !== 'PENDING') throw new BadRequestException(`This has already been ${w.status.toLowerCase()}.`);
    const rejecting = action === 'REJECT';
    const text = String(note ?? '').trim();
    if (rejecting && !text) throw new BadRequestException('A rejection has to say why.');
    return this.prisma.documentWaiver.update({
      where: { id: w.id },
      data: { status: rejecting ? 'REJECTED' : 'APPROVED', decidedById: actorEmployeeId, decidedAt: new Date(), decisionNote: text || null },
      select: ProfileCompletenessService.WAIVER_SELECT,
    });
  }

  /** "This is my first job": previous-employment documents are not asked for. */
  async setFirstJob(companyId: number, employeeId: number | null, firstJob: boolean): Promise<Completeness | null> {
    if (employeeId == null) throw new BadRequestException('No employee profile');
    await this.prisma.employee.updateMany({ where: { id: employeeId, companyId }, data: { firstJob: !!firstJob } });
    return this.mine(companyId, employeeId);
  }

  /** Everyone's status, for HR: who is incomplete, what is missing, their manager. */
  async report(companyId: number, role: string) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can see profile completion');
    const emps = await this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } } },
      select: SELECT,
      orderBy: [{ firstName: 'asc' }],
    });
    const policy = await loadDocumentPolicy(this.prisma, companyId);
    const rows = emps.map((e) => {
      const c = this.evaluate(e, policy);
      return {
        employee: {
          id: e.id, firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode,
          email: e.user?.email, department: e.department?.name ?? null, designation: e.designation?.name ?? null,
          avatarUrl: e.avatarUrl ?? null,
          joiningDate: (e as any).joiningDate ?? null,
        },
        manager: e.manager ? `${e.manager.firstName} ${e.manager.lastName ?? ''}`.trim() : null,
        exempt: c.exempt, complete: c.complete, firstJob: c.firstJob,
        missing: c.missing.map((m) => m.label),
        uploadedAsOther: c.uploadedAsOther,
      };
    }).filter((r) => !r.exempt);
    return {
      total: rows.length,
      complete: rows.filter((r) => r.complete).length,
      incomplete: rows.filter((r) => !r.complete).length,
      rows: rows.sort((a, b) => Number(a.complete) - Number(b.complete) || b.missing.length - a.missing.length),
    };
  }
}
