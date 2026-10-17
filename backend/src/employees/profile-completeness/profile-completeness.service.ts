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
  id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true,
  phone: true, gender: true, dateOfBirth: true, address: true,
  employmentType: true, firstJob: true, profileExempt: true,
  user: { select: { email: true, status: true } },
  designation: { select: { name: true } },
  department: { select: { name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  documents: { select: { id: true, fileName: true, fileUrl: true, documentType: true } },
  emergencyContacts: { select: { id: true } },
} as const;

/**
 * Whether an employee's profile has what HR asked for: the required
 * documents, personal details and an emergency contact. Drives the
 * reminder every employee sees until they are complete, and HR's report.
 */
@Injectable()
export class ProfileCompletenessService {
  constructor(private readonly prisma: PrismaService) {}

  private evaluate(emp: any): Completeness {
    const email = String(emp.user?.email ?? '').toLowerCase();
    const exempt = EXEMPT_EMAILS.has(email) || !!emp.profileExempt;
    const intern = isIntern(emp.employmentType, emp.designation?.name);
    const have = new Set<string>((emp.documents ?? []).map((d: any) => d.documentType));

    const needed: string[] = [...REQUIRED_DOCUMENTS];
    if (!intern && !emp.firstJob) needed.push(...PREVIOUS_EMPLOYMENT_DOCUMENTS);

    const missing: MissingItem[] = needed
      .filter((t) => !have.has(t))
      .map((t) => ({ key: t, label: t, kind: 'document' as const, ...(DOCUMENT_HINTS[t] ? { hint: DOCUMENT_HINTS[t] } : {}) }));

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
    const c = this.evaluate(emp);
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
    if (!isHrAdmin(role)) throw new ForbiddenException('Only HR and admins can change the profile lock');
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
    if (!isHrAdmin(role)) throw new ForbiddenException('Only HR and admins can manage exemptions');
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
    if (!isHrAdmin(role)) throw new ForbiddenException('Only HR and admins can manage exemptions');
    const res = await this.prisma.employee.updateMany({ where: { id: employeeId, companyId }, data: { profileExempt: !!exempt } });
    if (!res.count) throw new BadRequestException('Employee not found');
    return this.listExempt(companyId, role);
  }

  /** "This is my first job": previous-employment documents are not asked for. */
  async setFirstJob(companyId: number, employeeId: number | null, firstJob: boolean): Promise<Completeness | null> {
    if (employeeId == null) throw new BadRequestException('No employee profile');
    await this.prisma.employee.updateMany({ where: { id: employeeId, companyId }, data: { firstJob: !!firstJob } });
    return this.mine(companyId, employeeId);
  }

  /** Everyone's status, for HR: who is incomplete, what is missing, their manager. */
  async report(companyId: number, role: string) {
    if (!isHrAdmin(role)) throw new ForbiddenException('Only HR and admins can see profile completion');
    const emps = await this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } } },
      select: SELECT,
      orderBy: [{ firstName: 'asc' }],
    });
    const rows = emps.map((e) => {
      const c = this.evaluate(e);
      return {
        employee: {
          id: e.id, firstName: e.firstName, lastName: e.lastName, employeeCode: e.employeeCode,
          email: e.user?.email, department: e.department?.name ?? null, designation: e.designation?.name ?? null,
          avatarUrl: e.avatarUrl ?? null,
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
