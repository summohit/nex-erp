import { NotificationsService } from '../notifications/notifications.service';
import { normalisePolicy, probationEndFrom, probationMonthsFor } from '../lifecycle/probation-policy';
import { lockJobCapacity, closeFilledJobs } from '../recruitment/job-capacity';
import { ALL_DOCUMENT_TYPES } from './profile-completeness/profile-documents';
import { Injectable, ConflictException, NotFoundException, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

import { PermissionsService } from '../permissions/permissions.service';
import { MailService } from '../mail/mail.service';
import { PayrollService } from '../payroll/payroll.service';
import * as crypto from 'crypto';
import { forgetAccountStatus } from '../auth/auth.guard';

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private permissions: PermissionsService,
    private mailService: MailService,
    private payrollService: PayrollService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Roles allowed to see and set an employee's internal charge-out rate (§23).
   *
   * Deliberately narrower than directory access: HR can see the whole
   * directory and must not see what the company charges a project for
   * somebody's hour. A project manager sees cost rolled up on their own
   * project's dashboard, never per person here.
   */
  // Hourly cost is Super Admin only (19 Nov 2026; was also Admin and Finance).
  private static readonly COST_RATE_ROLES = ['SUPERADMIN'];

  private canSeeCostRate(role: string): boolean {
    return EmployeesService.COST_RATE_ROLES.includes(role);
  }

  /**
   * Remove hourlyCostRate unless the viewer may see it.
   *
   * Applied on the way out of every endpoint that returns whole Employee
   * rows. The alternative — a `select` on each query — means the next field
   * somebody adds is exposed by default, which is the wrong way round for a
   * commercial figure.
   */
  private stripCostRate<T extends Record<string, any>>(row: T, role: string): T {
    if (this.canSeeCostRate(role)) return row;
    const { hourlyCostRate, ...rest } = row as any;
    return rest as T;
  }

  private async assertDirectoryAccess(companyId: number, role: string) {
    if (role === 'SUPERADMIN') return;
    const hasAccess = await this.permissions.hasPermission(companyId, role, 'employees/directory', 'VIEW');
    if (!hasAccess) {
      throw new ForbiddenException('You do not have permission to view the employee directory.');
    }
  }

  async findAll(companyId: number, role: string) {
    await this.assertDirectoryAccess(companyId, role);
    const employees = await this.prisma.employee.findMany({
      where: { companyId, isCompanyAccount: false },
      include: {
        user: { select: { email: true, role: true, status: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true, colorCode: true } },
        documents: true,
        // The directory only needs the latest exit request to show the
        // offboarding milestone and link into its full history.
        resignations: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            intendedLastWorkingDay: true,
            approvedLastWorkingDay: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' }
    });
    // Directory access is not cost access — see canSeeCostRate.
    return employees.map((e) => this.stripCostRate(e, role));
  }

  // Minimal name/avatar list for populating dropdowns and resolving display names
  // in modules (Assets, Projects, etc.) that need employee identity but not full
  // directory access (which is gated by assertDirectoryAccess).
  async findBasicList(companyId: number) {
    return this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        managerId: true,
        employeeCode: true,
        // A flag, not a secret, and the assignee pickers badge PMs with it.
        // Without it those dropdowns fell back to pattern-matching the
        // designation name, which is a guess dressed up as a fact.
        isProjectManager: true,
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        user: { select: { email: true, role: true } },
        // Which days are this person's own. The attendance grid was assuming
        // Saturday and Sunday for everybody, which is not what any branch here
        // actually has — and a wrong day off is not cosmetic: a real working
        // day rendered as a day off hides an absence, and a day off rendered
        // as a working day invents one.
        branch: { select: { id: true, name: true, weeklyOffs: true } },
        shift: { select: { id: true, name: true, workingDays: true } },
        weeklyOffs: true,
      },
      orderBy: { firstName: 'asc' }
    });
  }

  async getHeadcountSummary(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { department: { select: { name: true } } }
    });

    const map = new Map<string, number>();
    for (const emp of employees) {
      const dept = emp.department?.name || 'Unassigned';
      map.set(dept, (map.get(dept) || 0) + 1);
    }

    return {
      total: employees.length,
      byDepartment: Array.from(map.entries()).map(([name, count]) => ({ name, count }))
    };
  }

  async findCeo(companyId: number) {
    // 1. Prefer an employee with the "CEO" designation
    const ceo = await this.prisma.employee.findFirst({
      where: {
        companyId,
        designation: { name: { equals: 'CEO', mode: 'insensitive' } },
        user: { status: { not: 'SUSPENDED' } }
      },
      include: {
        user: { select: { email: true, role: true } },
        designation: { select: { name: true } }
      }
    });
    if (ceo) return ceo;

    // 2. Fallback: the earliest SUPERADMIN (company founder)
    const founder = await this.prisma.user.findFirst({
      where: { companyId, role: 'SUPERADMIN', status: { not: 'SUSPENDED' } },
      orderBy: { id: 'asc' },
      select: {
        employee: {
          include: {
            user: { select: { email: true, role: true } },
            designation: { select: { name: true } }
          }
        }
      }
    });

    return founder?.employee || null;
  }

  async getOrgChart(companyId: number, role: string) {
    await this.assertDirectoryAccess(companyId, role);
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        managerId: true,
        employeeCode: true,
        phone: true,
        workLocation: true,
        designation: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        user: { select: { email: true, role: true, status: true } }
      }
    });

    return employees;
  }

  async generateEmployeeCode(prisma: any, companyId: number, employmentCategory: string): Promise<string> {
    const prefix = employmentCategory === 'TRAINEE' ? 'T' : employmentCategory === 'CONTRACT' ? 'C' : '';
    const defaultWidth = prefix === 'C' ? 3 : prefix === 'T' ? 4 : 5;

    const existing = await prisma.employee.findMany({
      where: { companyId, employeeCode: { startsWith: prefix || undefined, not: null } },
      select: { employeeCode: true }
    });

    let maxNumber = 0;
    let maxWidth = defaultWidth;
    for (const e of existing) {
      const suffix = prefix ? e.employeeCode.slice(prefix.length) : e.employeeCode;
      if (!/^\d+$/.test(suffix)) continue;
      const num = parseInt(suffix, 10);
      if (num > maxNumber) {
        maxNumber = num;
        maxWidth = suffix.length;
      }
    }

    const nextNumber = (maxNumber + 1).toString().padStart(maxWidth, '0');
    return `${prefix}${nextNumber}`;
  }

  async create(companyId: number, data: any) {
    // 1. Check if user already exists
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // 2. Hash default password
    const hashedPassword = await bcrypt.hash('Welcome@123', 10);

    // 3. Validate phone number if provided
    if (data.phone) {
      const phoneRegex = /^\+?[0-9\s\-()]{10,20}$/;
      if (!phoneRegex.test(data.phone)) {
        throw new BadRequestException('Invalid phone number format. Must be 10-20 characters, optionally starting with +');
      }
    }

    // 4. Determine Role from Department
    let assignedRole = data.role || 'EMPLOYEE';
    if (data.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
      if (dept && dept.defaultRole) {
        assignedRole = dept.defaultRole;
      }
    }

    // 5. Default reporting line: CEO of the organization when no manager specified
    let managerId = data.managerId || null;
    if (!managerId) {
      const ceo = await this.findCeo(companyId);
      managerId = ceo?.id ?? null;
    }

    const employmentCategory = data.employmentCategory || 'PERMANENT';

    // Probation from the company policy (4 Nov 2026), from the joining date.
    const joinedOn = data.joiningDate ? new Date(data.joiningDate) : new Date();
    const policySetting = await this.prisma.systemSetting.findUnique({ where: { companyId }, select: { probationPolicy: true } });
    const probationMonths = probationMonthsFor(normalisePolicy(policySetting?.probationPolicy), employmentCategory);
    const probationEnd = probationMonths > 0 && !isNaN(joinedOn.getTime()) ? probationEndFrom(joinedOn, probationMonths) : null;

    // 4. Create User and Employee in one transaction
    return this.prisma.$transaction(async (prisma) => {
      const newUser = await prisma.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          role: assignedRole,
          companyId: companyId
        }
      });

      const employeeCode = await this.generateEmployeeCode(prisma, companyId, employmentCategory);

      const newEmployee = await prisma.employee.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          departmentId: data.departmentId || null,
          designationId: data.designationId || null,
          branchId: data.branchId || null,
          managerId: managerId,
          shiftId: data.shiftId ? (typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId) : null,
          workFromAnywhere: !!data.workFromAnywhere,
          companyId: companyId,
          userId: newUser.id,
          onboardingStatus: 'PENDING',
          employeeCode,
          employmentCategory,
          ...(!isNaN(joinedOn.getTime()) ? { joiningDate: joinedOn } : {}),
          ...(probationEnd ? { probationEndDate: probationEnd, employmentType: 'On Probation' } : {}),
        },
        include: {
          user: { select: { email: true, role: true } },
          department: true,
          designation: true,
          branch: true,
          shift: true,
          manager: {
            select: { id: true, firstName: true, lastName: true }
          }
        }
      });

      // Auto-assign Onboarding Tasks
      const templates = await prisma.onboardingTemplate.findMany({ where: { companyId } });
      if (templates.length > 0) {
        await prisma.employeeOnboardingTask.createMany({
          data: templates.map(t => ({
            employeeId: newEmployee.id,
            title: t.title,
            description: t.description
          }))
        });
      }

      const token = crypto.randomBytes(32).toString('hex');
      await prisma.verificationToken.create({
        data: {
          identifier: newUser.email,
          token,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      this.mailService.sendVerificationEmail(newUser.email, token).catch(e => console.error(e));

      return newEmployee;
    });
  }

  /**
   * Start an offer for an existing trainee without creating a second account.
   * The resulting application deliberately uses the standard ATS Offered and
   * offer-letter editor/signing flow. The durable source-trainee link is kept
   * in the existing answers metadata so this works with the current database
   * role without requiring a schema migration.
   * used at signature time to promote this very Employee record.
   */
  async startTraineeConversion(employeeId: number, companyId: number, role: string, data: any) {
    if (!['HR', 'ADMIN', 'SUPERADMIN'].includes(role)) {
      throw new ForbiddenException('Only HR or an administrator can convert a trainee to an employee');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: { user: { select: { email: true } }, designation: { select: { name: true } }, department: { select: { name: true } }, branch: { select: { name: true } } },
    });
    if (!employee) throw new NotFoundException('Trainee not found');
    const isTrainee = employee.employmentCategory === 'TRAINEE'
      || /^trainee$/i.test(employee.designation?.name || '');
    if (!isTrainee) {
      throw new BadRequestException('Only an active trainee can be converted');
    }
    const offeredSalary = Number(data?.offeredSalary);
    if (!Number.isFinite(offeredSalary) || offeredSalary <= 0) {
      throw new BadRequestException('A valid offered salary is required');
    }
    const jobId = Number(data?.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      throw new BadRequestException('Choose the employee position for this conversion');
    }
    const job = await this.prisma.job.findFirst({ where: { id: jobId, companyId } });
    if (!job) throw new NotFoundException('Selected job position was not found');
    const previousApplication = await this.prisma.jobApplication.findFirst({
      where: { companyId, email: { equals: employee.user.email, mode: 'insensitive' }, source: { not: 'TRAINEE_CONVERSION' } },
      include: { job: { select: { title: true } } }, orderBy: { createdAt: 'desc' },
    });
    const previousProfile = {
      employeeCode: employee.employeeCode,
      employmentCategory: employee.employmentCategory,
      position: employee.designation?.name || previousApplication?.job?.title || 'Trainee',
      department: employee.department?.name || null,
      branch: employee.branch?.name || null,
      joiningDate: employee.joiningDate,
      annualCtc: previousApplication?.offeredSalary || previousApplication?.expectedCtc || previousApplication?.currentCtc || null,
    };

    const candidates = await this.prisma.jobApplication.findMany({
      where: { companyId }, select: { id: true, status: true, answers: true },
    });
    const existing = candidates.find((candidate) => {
      try { return JSON.parse(candidate.answers || '{}')?.__traineeConversion?.sourceTraineeId === employee.id; }
      catch { return false; }
    });
    if (existing && !['REJECTED'].includes(existing.status)) {
      throw new ConflictException('This trainee already has an active or completed conversion request');
    }

    const [firstName, ...lastNameParts] = `${employee.firstName} ${employee.lastName || ''}`.trim().split(/\s+/);
    const fullName = [firstName, ...lastNameParts].filter(Boolean).join(' ');
    const payload: any = {
      jobId: job.id,
      companyId,
      answers: JSON.stringify({ __traineeConversion: { sourceTraineeId: employee.id, startedAt: new Date().toISOString(), previousProfile } }),
      fullName,
      email: employee.user.email,
      phone: employee.phone || '',
      address: employee.address || null,
      dateOfBirth: employee.dateOfBirth || null,
      currentLocation: employee.workLocation || null,
      offeredSalary,
      profileBudget: offeredSalary,
      joiningDate: data?.joiningDate ? new Date(data.joiningDate) : employee.joiningDate || null,
      source: 'TRAINEE_CONVERSION',
      coverLetter: data?.remarks?.trim() || null,
      status: 'OFFERED',
      completedStages: ['APPLIED', 'OFFERED'],
      approvalStatus: 'APPROVED',
    };
    if (existing) {
      return this.prisma.jobApplication.update({ where: { id: existing.id }, data: payload });
    }
    return this.prisma.jobApplication.create({ data: payload });
  }

  /**
   * The signed-offer terminal action for a trainee conversion.  This promotes
   * the existing employee/user pair and intentionally does not call create(),
   * generate onboarding tasks, or send verification/onboarding credentials.
   */
  async promoteTraineeAfterSignedOffer(traineeId: number, applicationId: number, companyId: number) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockJobCapacity(tx, companyId);
      const [trainee, application] = await Promise.all([
        tx.employee.findFirst({ where: { id: traineeId, companyId } }),
        tx.jobApplication.findFirst({ where: { id: applicationId, companyId }, include: { job: true } }),
      ]);
      const sourceTraineeId = (() => { try { return JSON.parse(application?.answers || '{}')?.__traineeConversion?.sourceTraineeId; } catch { return null; } })();
      if (!trainee || !application || sourceTraineeId !== traineeId) throw new NotFoundException('Trainee conversion record was not found');

      // Older job records may have been created without a designation even
      // though their title maps exactly to one in master data.  Resolve that
      // here so the promoted profile reflects the hired role, rather than
      // retaining "Trainee" indefinitely.
      const matchingDesignation = application.job.designationId
        ? null
        : await tx.designation.findFirst({
            where: {
              companyId,
              name: { equals: application.job.title, mode: 'insensitive' },
              ...(application.job.departmentId ? { departmentId: application.job.departmentId } : {}),
            },
            select: { id: true },
          });
      const designationId = application.job.designationId || matchingDesignation?.id || trainee.designationId;
      const profileUpdates = {
        onboardingStatus: 'COMPLETED',
        joiningDate: application.joiningDate || trainee.joiningDate,
        departmentId: application.job.departmentId || trainee.departmentId,
        designationId,
        branchId: application.job.branchId || trainee.branchId,
      };

      // The signing endpoint can be retried by browsers/webhooks. Once this
      // trainee is permanent, keep the existing profile and code, but still
      // repair the ATS stage and job details. A converted trainee belongs in
      // the ATS Onboarded lane and starts directly in the onboarding board's
      // Completed column — their existing profile is already complete.
      if (trainee.employmentCategory !== 'TRAINEE') {
        const employee = await tx.employee.update({ where: { id: trainee.id }, data: profileUpdates });
        await tx.jobApplication.update({
          where: { id: application.id },
          data: {
            status: 'ONBOARDED',
            completedStages: Array.from(new Set([...(application.completedStages || []), 'HIRED', 'ONBOARDED'])),
          },
        });
        await closeFilledJobs(tx, companyId);
        return { employee, offeredSalary: application.offeredSalary };
      }

      const employeeCode = await this.generateEmployeeCode(tx, companyId, 'PERMANENT');
      const employee = await tx.employee.update({
        where: { id: trainee.id },
        data: {
          employeeCode,
          employmentCategory: 'PERMANENT',
          ...profileUpdates,
        },
      });
      await tx.jobApplication.update({
        where: { id: application.id },
        data: {
          status: 'ONBOARDED',
          completedStages: Array.from(new Set([...(application.completedStages || []), 'HIRED', 'ONBOARDED'])),
        },
      });
      await closeFilledJobs(tx, companyId);
      return { employee, offeredSalary: application.offeredSalary };
    });

    // The offer CTC is annual, while salary structures store monthly amounts.
    // Reapplying is safe for a retried signing callback and guarantees the
    // converted employee's next payroll uses the accepted offer, not trainee pay.
    if (result.offeredSalary && result.offeredSalary > 0) {
      await this.payrollService.applyTemplate(companyId, result.employee.id, result.offeredSalary / 12);
    }
    return result.employee;
  }

  /**
   * Set an employee's internal charge-out rate (§23).
   *
   * Its own endpoint rather than a field on update(): that method is reachable
   * by every role that can edit an employee, and a commercial rate should not
   * ride in on the same payload as a phone number. Null clears the rate, which
   * makes the person's hours unpriced rather than free — the project rollup
   * reports those hours separately so the cost is never quietly understated.
   */
  async setCostRate(id: number, companyId: number, role: string, rate: number | null) {
    if (!this.canSeeCostRate(role)) {
      throw new ForbiddenException('Only the Super Admin can set a cost rate');
    }

    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    if (rate != null && (!Number.isFinite(rate) || rate < 0)) {
      throw new BadRequestException('Cost rate must be a positive number');
    }

    return this.prisma.employee.update({
      where: { id },
      data: { hourlyCostRate: rate },
      select: { id: true, firstName: true, lastName: true, hourlyCostRate: true },
    });
  }

  async update(id: number, companyId: number, data: any) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const updateData: any = {};
    if (data.firstName) updateData.firstName = data.firstName;
    if (data.lastName) updateData.lastName = data.lastName;
    if (data.nextAppraisalDate !== undefined) updateData.nextAppraisalDate = data.nextAppraisalDate ? new Date(data.nextAppraisalDate) : null;
    if (data.phone) {
      const phoneRegex = /^\+?[0-9\s\-()]{10,20}$/;
      if (!phoneRegex.test(data.phone)) {
        throw new BadRequestException('Invalid phone number format. Must be 10-20 characters, optionally starting with +');
      }
      updateData.phone = data.phone;
    }
    if (data.departmentId !== undefined) {
      if (data.departmentId) updateData.department = { connect: { id: data.departmentId } };
      else updateData.department = { disconnect: true };
    }
    if (data.designationId !== undefined) {
      if (data.designationId) updateData.designation = { connect: { id: data.designationId } };
      else updateData.designation = { disconnect: true };
    }
    if (data.branchId !== undefined) {
      if (data.branchId) updateData.branch = { connect: { id: data.branchId } };
      else updateData.branch = { disconnect: true };
    }
    if (data.managerId !== undefined) {
      if (data.managerId) updateData.manager = { connect: { id: data.managerId } };
      else updateData.manager = { disconnect: true };
    }
    if (data.shiftId !== undefined) {
      if (data.shiftId) updateData.shift = { connect: { id: typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId } };
      else updateData.shift = { disconnect: true };
    }

    if (data.workFromAnywhere !== undefined) {
      updateData.workFromAnywhere = Boolean(data.workFromAnywhere);
    }

    if (data.isProjectManager !== undefined) {
      updateData.isProjectManager = Boolean(data.isProjectManager);
    }

    if (data.role) {
      updateData.user = { update: { role: data.role } };
    }

    return this.prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { email: true, role: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } }
      }
    });
  }

  async delete(id: number, companyId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: { user: { select: { status: true } } }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentStatus = employee.user.status;
    const newStatus = currentStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';

    await this.prisma.user.update({
      where: { id: employee.userId },
      data: { status: newStatus }
    });

    if (newStatus === 'SUSPENDED') {
      // Set subordinates' managerId to null
      await this.prisma.employee.updateMany({
        where: { managerId: employee.id, companyId },
        data: { managerId: null }
      });
    }

    return { success: true, newStatus };
  }

  // --- Profile Features ---

  /** Direct reports, and whether this person leads any project (for the mobile menu). */
  async getMyTeamSummary(companyId: number, employeeId: number | null) {
    if (employeeId == null) return { directReports: 0, leadsProjects: false, hasTeam: false };
    const [directReports, projects] = await Promise.all([
      this.prisma.employee.count({ where: { companyId, managerId: employeeId } }),
      this.prisma.project.count({
        where: {
          companyId, isSystem: false,
          OR: [{ leadId: employeeId }, { members: { some: { employeeId, role: 'PROJECT_MANAGER' } } }],
        },
      }),
    ]);
    return { directReports, leadsProjects: projects > 0, hasTeam: directReports > 0 };
  }

  async getMyProfile(companyId: number, currentUserId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: {
        user: { select: { email: true, role: true, id: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true, weeklyOffs: true } },
        manager: { select: { firstName: true, lastName: true, id: true } },
        emergencyContacts: true,
        documents: true,
        skills: true,
        resumeLines: true
      }
    });
    if (!employee) throw new NotFoundException('Employee profile not found');

    // Own profile: always allowed to see and manage their own documents. This
    // must stay in step with getProfile(), which returns the same flag.
    return { ...employee, isOwner: true, canManageDocuments: true };
  }

  async getProfile(id: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: {
        user: { select: { email: true, role: true, id: true, status: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true, id: true } },
        shift: { select: { name: true, startTime: true, endTime: true } },
        emergencyContacts: true,
        documents: true,
        skills: true,
        resumeLines: true
      }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const isOwner = employee.userId === currentUserId;
    if (!isOwner) {
      await this.assertDirectoryAccess(companyId, role);
    }

    // Personal documents (ID proofs, contracts) stay private. They are exposed to
    // the owner and to the people who are already allowed to add and delete them
    // — HR, admins and designation-level profile editors — but not to every
    // colleague who merely has directory access.
    const canViewDocuments = isOwner || (await this.canManageEmployeeDocuments(companyId, currentUserId, role));
    if (!canViewDocuments) {
      employee.documents = [];
    }

    // An employee opening their own profile does not get to read their own
    // charge-out rate either: it is what the company bills for their time,
    // not a fact about their employment, and it is not theirs to see.
    const conversionApplications = await this.prisma.jobApplication.findMany({
      where: { companyId, source: 'TRAINEE_CONVERSION' },
      select: { answers: true, status: true, offerLetter: { select: { status: true } } },
    });
    const hasCompletedTraineeConversion = conversionApplications.some((application) => {
      try {
        const linked = JSON.parse(application.answers || '{}')?.__traineeConversion?.sourceTraineeId === id;
        return linked && (application.offerLetter?.status === 'ACCEPTED' || ['HIRED', 'ONBOARDED'].includes(application.status));
      } catch { return false; }
    });
    return { ...this.stripCostRate(employee, role), isOwner, canManageDocuments: canViewDocuments, hasCompletedTraineeConversion };
  }

  /** Timeline for the same employee record; conversion applications are linked
   * through existing application metadata so no parallel employee is created. */
  async getEmploymentHistory(id: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.getProfile(id, companyId, currentUserId, role);
    const applications = await this.prisma.jobApplication.findMany({
      where: { companyId },
      include: { job: { select: { title: true } }, offerLetter: { select: { status: true, issuedAt: true, respondedAt: true } } },
    });
    const conversion = applications.filter((application) => {
      try { return JSON.parse(application.answers || '{}')?.__traineeConversion?.sourceTraineeId === id; }
      catch { return false; }
    });
    const events: any[] = [{
      type: 'PROFILE_CREATED', label: 'Trainee profile created',
      detail: `Employee ID ${employee.employeeCode || 'pending'} · ${employee.designation?.name || 'Trainee'}`,
      facts: [{ label: 'Employee ID', value: employee.employeeCode || 'Not assigned' }, { label: 'Position', value: employee.designation?.name || 'Trainee' }, { label: 'Department', value: employee.department?.name || 'Not specified' }],
      at: employee.createdAt,
    }];
    for (const application of conversion) {
      let metadata: any = {}; try { metadata = JSON.parse(application.answers || '{}')?.__traineeConversion || {}; } catch { /* legacy record */ }
      const before = metadata.previousProfile || {};
      events.push({ type: 'CONVERSION_STARTED', label: 'Trainee-to-employee offer created', detail: application.job?.title || 'Employee position', facts: [
        { label: 'Previous position', value: before.position || 'Trainee' }, { label: 'Previous department', value: before.department || 'Not recorded' },
        { label: 'Previous annual CTC', value: before.annualCtc ? `₹${Number(before.annualCtc).toLocaleString('en-IN')}` : 'Not recorded' },
        { label: 'Offered position', value: application.job?.title || 'Not specified' }, { label: 'Offered annual CTC', value: application.offeredSalary ? `₹${Number(application.offeredSalary).toLocaleString('en-IN')}` : 'Not recorded' },
        { label: 'Joining date', value: application.joiningDate ? new Date(application.joiningDate).toLocaleDateString('en-IN') : 'Not specified' },
      ], at: application.createdAt });
      if (application.offerLetter?.issuedAt) events.push({ type: 'OFFER_SENT', label: 'Offer letter sent for signature', detail: application.job?.title || '', facts: [{ label: 'Position', value: application.job?.title || 'Not specified' }, { label: 'Annual CTC', value: application.offeredSalary ? `₹${Number(application.offeredSalary).toLocaleString('en-IN')}` : 'Not recorded' }], at: application.offerLetter.issuedAt });
      if (application.offerLetter?.status === 'ACCEPTED') events.push({ type: 'OFFER_SIGNED', label: 'Offer letter signed', detail: 'Existing account retained; no onboarding account created.', facts: [{ label: 'New position', value: application.job?.title || 'Not specified' }, { label: 'New annual CTC', value: application.offeredSalary ? `₹${Number(application.offeredSalary).toLocaleString('en-IN')}` : 'Not recorded' }], at: application.offerLetter.respondedAt || application.updatedAt });
    }
    events.push({ type: 'CURRENT_STATUS', label: `Current employment: ${employee.employmentCategory}`, detail: employee.designation?.name || '', at: employee.updatedAt });
    return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }

  /**
   * Whether the caller may see and manage another employee's personal documents.
   * Deliberately narrower than checkProfileEditPermission, whose fallback admits
   * anyone with directory VIEW — too broad for ID proofs and contracts.
   */
  private async canManageEmployeeDocuments(companyId: number, currentUserId: number, role: string): Promise<boolean> {
    if (role === 'SUPERADMIN' || role === 'HR' || role === 'ADMIN') return true;

    const requestor = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: { designation: true },
    });
    return !!requestor?.designation?.canEditProfiles;
  }

  private async checkProfileEditPermission(employeeId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    
    if (employee.userId === currentUserId || role === 'SUPERADMIN' || role === 'HR') return employee; // Self edit, Super Admin, HR

    // Check Designation-level permissions
    const requestor = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: { designation: true }
    });

    if (requestor?.designation?.canEditProfiles) {
      return employee;
    }
    
    // Fallback to System Role-level permissions
    const hasPermission = await this.permissions.hasPermission(companyId, role, 'employees/directory', 'VIEW');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have permission to edit other employee profiles');
    }
    
    return employee;
  }

  /**
   * Partial update: a key the caller did not send is left untouched, and only an
   * explicit null/'' clears a column. This used to write every whitelisted column
   * on every call as `data.x || null`, so any caller that posted a narrow payload
   * silently NULLed everything it had not mentioned — bank details, identity and
   * visa numbers, and the department/designation/branch/manager links included.
   */
  async updateProfile(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    const updateData: any = {};

    // Blank input means "clear this field", so '' collapses to null. Absent means
    // "leave alone", so the key is never added to updateData at all.
    const setText = (key: string, source: string = key) => {
      if (data[source] !== undefined) updateData[key] = data[source] || null;
    };
    const setDate = (key: string, source: string = key) => {
      if (data[source] !== undefined) updateData[key] = data[source] ? new Date(data[source]) : null;
    };
    const setNumber = (key: string, source: string = key) => {
      if (data[source] === undefined) return;
      updateData[key] = data[source] === null || data[source] === '' ? null : Number(data[source]);
    };

    // Identity & basics
    setText('salutation');
    setText('firstName');
    setText('lastName');
    setText('phone');
    setText('country');
    setText('state');
    setText('city');
    setText('language');
    setText('gender');
    setDate('dateOfBirth');
    setText('slackId');
    setText('maritalStatus');
    // Personal email beside the office login email (16 Nov 2026): contact only, never a login.
    if (data.personalEmail !== undefined) {
      const pe = String(data.personalEmail ?? '').trim().toLowerCase();
      if (pe && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(pe)) throw new BadRequestException('Enter a valid personal email address.');
      updateData.personalEmail = pe || null;
    }
    setText('address');
    setText('about');
    // A photo is uploaded on its own and only its URL is stored. An inline data:
    // URL rides along in every employee list — four once made the directory 25 MB.
    if (typeof data.avatarUrl === 'string' && data.avatarUrl.startsWith('data:')) {
      throw new BadRequestException('Upload the photo first; only its URL can be saved.');
    }
    setText('avatarUrl');

    // Org links
    setNumber('managerId');
    setNumber('branchId');
    setNumber('departmentId');
    setNumber('designationId');

    // Work details
    if (data.usualWorkLocation !== undefined) {
      updateData.usualWorkLocation = data.usualWorkLocation ? data.usualWorkLocation : null;
    }
    setText('workLocation');
    // Personal weekly off (21 Oct 2026): "0,6:even", "1", "NONE"; empty = shift / branch.
    setText('weeklyOffs');
    setText('workNotes');
    setText('pfNumber');
    setText('esiNumber');
    setDate('joiningDate');
    if (data.employmentCategory !== undefined) updateData.employmentCategory = data.employmentCategory;
    setDate('nextAppraisalDate');

    // Bank details
    setText('bankName');
    setText('bankAccountNumber');
    setText('ifscCode');

    // Place of birth
    setText('placeOfBirthCity');
    setText('placeOfBirthCountry');

    // Citizenship & identification
    setText('nationality');
    setText('identificationNo');
    setText('passportNo');

    // Visa & permit
    setText('visaNo');
    setText('workPermitNo');

    // Location & distance
    setText('zipCode');
    setNumber('homeWorkDistanceKm');

    // Family
    setText('spouseName');
    setDate('spouseBirthdate');
    setNumber('childrenCount');

    // Education
    setText('educationLevel');
    setText('fieldOfStudy');

    // Passwords are not editable here. They go through POST /auth/change-password,
    // which touches nothing but the user row — this endpoint used to accept a
    // `password` key, which is how the header's change-password dialog ended up
    // wiping the profile it was never meant to touch.

    // skills / resumeLines are intentionally NOT accepted here — they used
    // to be a `deleteMany + create` full-replace driven by whatever array
    // the client happened to hold locally. Any device with a stale copy of
    // the form (e.g. hadn't refetched since another device added a skill)
    // would silently wipe that other device's change on its next unrelated
    // save. addSkill/updateSkill/deleteSkill and their resumeLine
    // equivalents below replace this — each touches exactly the row it
    // means to, using the row's real id, never the whole list.

    return this.prisma.employee.update({
      where: { id },
      data: updateData
    });
  }

  async addSkill(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    if (!data.category || !data.name || !data.level) {
      throw new BadRequestException('Category, name and level are required');
    }
    return this.prisma.employeeSkill.create({
      data: { employeeId: id, category: data.category, name: data.name, level: data.level }
    });
  }

  async updateSkill(id: number, skillId: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const skill = await this.prisma.employeeSkill.findFirst({ where: { id: skillId, employeeId: id } });
    if (!skill) throw new NotFoundException('Skill not found');
    return this.prisma.employeeSkill.update({
      where: { id: skillId },
      data: { category: data.category, name: data.name, level: data.level }
    });
  }

  async deleteSkill(id: number, skillId: number, companyId: number, currentUserId: number, role: string) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const skill = await this.prisma.employeeSkill.findFirst({ where: { id: skillId, employeeId: id } });
    if (!skill) throw new NotFoundException('Skill not found');
    return this.prisma.employeeSkill.delete({ where: { id: skillId } });
  }

  async addResumeLine(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    if (!data.title || !data.organization) {
      throw new BadRequestException('Title and organization are required');
    }
    return this.prisma.employeeResume.create({
      data: {
        employeeId: id,
        type: data.type || 'Experience',
        title: data.title,
        organization: data.organization,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        description: data.description || null,
        attachmentUrl: data.attachmentUrl || null,
      }
    });
  }

  async updateResumeLine(id: number, lineId: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const line = await this.prisma.employeeResume.findFirst({ where: { id: lineId, employeeId: id } });
    if (!line) throw new NotFoundException('Resume entry not found');
    return this.prisma.employeeResume.update({
      where: { id: lineId },
      data: {
        type: data.type || 'Experience',
        title: data.title,
        organization: data.organization,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        description: data.description || null,
        attachmentUrl: data.attachmentUrl || null,
      }
    });
  }

  async deleteResumeLine(id: number, lineId: number, companyId: number, currentUserId: number, role: string) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const line = await this.prisma.employeeResume.findFirst({ where: { id: lineId, employeeId: id } });
    if (!line) throw new NotFoundException('Resume entry not found');
    return this.prisma.employeeResume.delete({ where: { id: lineId } });
  }

  /** Emergency contacts are private: employees manage their own and a Super Admin may manage any profile. */
  private async checkEmergencyContactPermission(employeeId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    if (employee.userId === currentUserId || role === 'SUPERADMIN') return employee;
    throw new ForbiddenException('You can only manage your own emergency contacts.');
  }

  async addContact(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    const employee = await this.checkEmergencyContactPermission(id, companyId, currentUserId, role);

    if (!data.name || !data.mobile) {
      throw new BadRequestException('Name and Mobile are required');
    }

    const nameRegex = /^[a-zA-Z\s.'-]+$/;
    if (!nameRegex.test(data.name.trim())) {
      throw new BadRequestException('Invalid name format. Name should contain only letters and spaces.');
    }

    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!phoneRegex.test(data.mobile)) {
      throw new BadRequestException('Invalid mobile number format. Must be 7-15 digits, optionally starting with +');
    }

    return this.prisma.emergencyContact.create({
      data: {
        employeeId: id,
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        relationship: data.relationship
      }
    });
  }

  async deleteContact(id: number, contactId: number, companyId: number, currentUserId: number, role: string) {
    await this.checkEmergencyContactPermission(id, companyId, currentUserId, role);
    const contact = await this.prisma.emergencyContact.findFirst({ where: { id: contactId, employeeId: id } });
    if (!contact) throw new NotFoundException('Emergency contact not found');

    return this.prisma.emergencyContact.delete({
      where: { id: contactId }
    });
  }

  async updateContact(id: number, contactId: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkEmergencyContactPermission(id, companyId, currentUserId, role);
    const contact = await this.prisma.emergencyContact.findFirst({ where: { id: contactId, employeeId: id } });
    if (!contact) throw new NotFoundException('Emergency contact not found');
    if (!data.name || !data.mobile) throw new BadRequestException('Name and Mobile are required');
    const nameRegex = /^[a-zA-Z\s.'-]+$/;
    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!nameRegex.test(data.name.trim())) throw new BadRequestException('Invalid name format. Name should contain only letters and spaces.');
    if (!phoneRegex.test(data.mobile)) throw new BadRequestException('Invalid mobile number format. Must be 7-15 digits, optionally starting with +');
    return this.prisma.emergencyContact.update({
      where: { id: contactId },
      data: { name: data.name, email: data.email || null, mobile: data.mobile, relationship: data.relationship || null }
    });
  }

  async addDocument(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    return this.prisma.employeeDocument.create({
      data: {
        employeeId: employee.id,
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        documentType: data.documentType || 'Other'
      }
    });
  }

  async addDocuments(id: number, companyId: number, currentUserId: number, role: string, data: { docs: any[] }) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    const MAX_DOCS_PER_REQUEST = 5;
    const docs = Array.isArray(data.docs) ? data.docs : [];
    if (docs.length === 0) throw new BadRequestException('No documents provided.');
    if (docs.length > MAX_DOCS_PER_REQUEST) {
      throw new BadRequestException(`You can upload a maximum of ${MAX_DOCS_PER_REQUEST} documents at a time.`);
    }

    return this.prisma.$transaction(
      docs.map(d => this.prisma.employeeDocument.create({
        data: {
          employeeId: employee.id,
          fileName: d.fileName,
          fileUrl: d.fileUrl,
          documentType: d.documentType || 'Other'
        }
      }))
    );
  }

  async deleteDocument(id: number, documentId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    // Scoped to this employee: permission was checked for them, not for
    // whoever owns the document id in the URL.
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: documentId, employeeId: employee.id } });
    if (!doc) throw new NotFoundException('Document not found');
    const deleted = await this.prisma.employeeDocument.delete({ where: { id: doc.id } });
    await this.notifyDocumentDeleted(companyId, currentUserId, employee.id, doc.fileName, doc.documentType);
    // #35 (19 Nov 2026): record who removed which file.
    await this.prisma.auditLog.create({ data: { companyId, actorId: currentUserId, action: 'DOCUMENT_DELETED', entityType: 'EmployeeDocument', entityId: String(doc.id),
      oldValue: { employeeId: employee.id, fileName: doc.fileName, fileUrl: doc.fileUrl, type: doc.documentType } as any } }).catch(() => undefined);
    return deleted;
  }

  /**
   * Super Admin and HR hear about every deleted document (13 Nov 2026):
   * who deleted it, which file, whose it was. A failed notification never
   * undoes the delete.
   */
  private async notifyDocumentDeleted(companyId: number, actorUserId: number, employeeId: number, fileName: string, documentType?: string | null) {
    try {
      const [actor, owner, recipients] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true, employee: { select: { firstName: true, lastName: true } } } }),
        this.prisma.employee.findUnique({ where: { id: employeeId }, select: { firstName: true, lastName: true, employeeCode: true } }),
        this.prisma.user.findMany({ where: { companyId, role: { in: ['SUPERADMIN', 'HR'] }, status: { not: 'SUSPENDED' } }, select: { id: true } }),
      ]);
      const who = actor?.employee ? `${actor.employee.firstName} ${actor.employee.lastName ?? ''}`.trim() : (actor?.email || 'Someone');
      const whose = owner ? `${owner.firstName} ${owner.lastName ?? ''}`.trim() + (owner.employeeCode ? ` (${owner.employeeCode})` : '') : 'an employee';
      const what = `${fileName}${documentType ? ` · ${documentType}` : ''}`;
      const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
      for (const r of recipients) {
        if (r.id === actorUserId) continue;
        await this.notifications.createNotification(r.id, 'Document deleted', `${who} deleted "${what}" from ${whose}'s documents on ${when}.`, 'WARNING', `/employees/${employeeId}/profile`, companyId);
      }
    } catch {
      // Notification is best-effort.
    }
  }

  /**
   * Change what a document is filed as, e.g. a resume uploaded as "Other"
   * (16 Oct 2026). Same permission as uploading it.
   */
  /** #35 (19 Nov 2026): HR marks an uploaded document verified or rejected (audit logged). */
  async verifyDocument(id: number, documentId: number, companyId: number, actorUserId: number, role: string, status: string, note?: string) {
    if (!['SUPERADMIN', 'ADMIN', 'HR'].includes(role)) throw new ForbiddenException('Only HR can verify documents.');
    const s = String(status || '').toUpperCase();
    if (!['VERIFIED', 'REJECTED', 'PENDING'].includes(s)) throw new BadRequestException('Status must be VERIFIED, REJECTED or PENDING.');
    if (s === 'REJECTED' && !String(note || '').trim()) throw new BadRequestException('Say why the document is rejected.');
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: documentId, employeeId: id, employee: { companyId } } });
    if (!doc) throw new NotFoundException('Document not found');
    const updated = await this.prisma.employeeDocument.update({
      where: { id: documentId },
      data: { verificationStatus: s, verificationNote: note?.trim() || null, verifiedById: s === 'PENDING' ? null : actorUserId, verifiedAt: s === 'PENDING' ? null : new Date() },
    });
    await this.prisma.auditLog.create({ data: { companyId, actorId: actorUserId, action: 'DOCUMENT_VERIFICATION', entityType: 'EmployeeDocument', entityId: String(documentId),
      oldValue: { status: (doc as any).verificationStatus, employeeId: id } as any, newValue: { status: s, note: note?.trim() || null, fileName: doc.fileName, type: doc.documentType } as any } }).catch(() => undefined);
    return updated;
  }

  async updateDocumentType(id: number, documentId: number, companyId: number, currentUserId: number, role: string, documentType: string, fileName?: string) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    // Rename (13 Nov 2026): Super Admin only; changes the name shown, never the stored file.
    if (fileName !== undefined) {
      if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can rename documents');
      const name = String(fileName ?? '').trim();
      if (!name) throw new BadRequestException('Document name cannot be empty');
      if (name.length > 200) throw new BadRequestException('Document name is too long');
      const doc = await this.prisma.employeeDocument.findFirst({ where: { id: documentId, employeeId: employee.id } });
      if (!doc) throw new NotFoundException('Document not found');
      return this.prisma.employeeDocument.update({ where: { id: doc.id }, data: { fileName: name } });
    }
    const type = String(documentType ?? '').trim();
    if (!(ALL_DOCUMENT_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Pick a document type from the list');
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: documentId, employeeId: employee.id } });
    if (!doc) throw new NotFoundException('Document not found');
    return this.prisma.employeeDocument.update({ where: { id: doc.id }, data: { documentType: type } });
  }

  async sendWelcomeEmails(companyId: number, employeeIds: number[]) {
    const result = { successCount: 0, failedCount: 0, errors: [] as { employeeId: number; reason: string }[] };

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      include: { user: { select: { id: true, email: true, status: true } } }
    });
    const foundIds = new Set(employees.map(e => e.id));

    for (const employeeId of employeeIds) {
      if (!foundIds.has(employeeId)) {
        result.failedCount++;
        result.errors.push({ employeeId, reason: 'Employee not found' });
        continue;
      }
    }

    for (const employee of employees) {
      try {
        const tempPassword = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        await this.prisma.user.update({
          where: { id: employee.user.id },
          data: { password: passwordHash, status: 'ACTIVE' }
        });

        await this.mailService.sendCredentialsEmail(employee.user.email, tempPassword);
        result.successCount++;
      } catch (err) {
        result.failedCount++;
        result.errors.push({ employeeId: employee.id, reason: err.message || 'Failed to send email' });
      }
    }

    return result;
  }

  // ── Personal → office login email (16 Nov 2026) ────────────────────────
  // Super Admin or HR switch someone's MIRA login to their @ces-pl.com
  // address. Everything is keyed by user id, so history is untouched; the
  // old personal address is kept on the profile for contact after exit.

  static readonly OFFICE_DOMAIN = 'ces-pl.com';

  async changeLoginEmail(companyId: number, role: string, actorUserId: number | null, employeeId: number, rawEmail: string) {
    if (!['SUPERADMIN', 'HR'].includes(role)) throw new ForbiddenException('Only the Super Admin or HR can change a login email.');
    const email = String(rawEmail ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) throw new BadRequestException('Enter a valid email address.');
    if (!email.endsWith('@' + EmployeesService.OFFICE_DOMAIN)) throw new BadRequestException(`Use an @${EmployeesService.OFFICE_DOMAIN} office address.`);
    if (EmployeesService.SHARED_LOGINS.includes(email)) throw new BadRequestException(`${email} is a shared login — use "Hand over HR login" instead.`);

    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, firstName: true, lastName: true, personalEmail: true, user: { select: { id: true, email: true, role: true } } },
    });
    if (!emp?.user) throw new NotFoundException('Employee not found');
    if (role === 'HR' && emp.user.role === 'SUPERADMIN') throw new ForbiddenException('HR cannot change a Super Admin\'s login.');
    const oldEmail = emp.user.email;
    if (oldEmail.toLowerCase() === email) throw new BadRequestException('That is already their login email.');
    if (EmployeesService.SHARED_LOGINS.includes(oldEmail.toLowerCase())) throw new BadRequestException('This is the shared HR login — use "Hand over HR login".');
    const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) throw new ConflictException(`${email} is already used by another MIRA login.`);

    const wasPersonal = !oldEmail.toLowerCase().endsWith('@' + EmployeesService.OFFICE_DOMAIN);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: emp.user!.id }, data: { email, emailVerifiedAt: new Date() } });
      if (wasPersonal && !emp.personalEmail) await tx.employee.update({ where: { id: emp.id }, data: { personalEmail: oldEmail } });
      await tx.auditLog.create({
        data: {
          companyId, actorId: actorUserId, action: 'LOGIN_EMAIL_CHANGED', entityType: 'User', entityId: String(emp.user!.id),
          oldValue: { email: oldEmail } as any, newValue: { email, employeeId: emp.id } as any,
        },
      });
    });
    forgetAccountStatus(emp.user.id);

    const name = `${emp.firstName} ${emp.lastName}`.trim();
    const companyName = (await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name ?? undefined;
    let emailed = true;
    for (const to of [email, oldEmail]) {
      try { await this.mailService.sendLoginEmailChanged(to, name, email, oldEmail, companyName); } catch { emailed = false; }
    }
    // In-app notice too (19 Nov 2026), so they see it the next time they open MIRA.
    try {
      await this.notifications.createNotification(
        emp.user.id,
        'Your login email has been changed',
        `Use ${email} to sign in to MIRA from now on (previously ${oldEmail}). Your password stays the same. Login: ${(process.env.APP_URL || 'https://mira.ces-pl.com').replace(/\/+$/, '')}/login`,
        'INFO',
        '/dashboard',
        companyId,
      );
    } catch { /* the change is saved; the notice is best-effort */ }
    return { email, previousEmail: oldEmail, personalEmailKept: wasPersonal, emailed };
  }

  /**
   * A person's hourly cost today and where it comes from (19 Nov 2026), same
   * order as project costing: own rate → grade rate in force → ungraded rate →
   * monthly gross ÷ 234 h. Super Admin only.
   */
  async getHourlyCost(companyId: number, role: string, employeeId: number) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can see hourly cost.');
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, hourlyCostRate: true, payType: true, salaryStructures: { select: { amount: true, component: { select: { type: true } } } } },
    });
    if (!emp) throw new NotFoundException('Employee not found');
    const HOURS = 234;
    const gross = emp.salaryStructures.filter((s) => s.component.type === 'EARNING').reduce((a, s) => a + s.amount, 0);
    const grades = await this.prisma.salaryGrade.findMany({ where: { companyId }, orderBy: [{ position: 'asc' }, { minGross: 'asc' }], select: { name: true, label: true, minGross: true, maxGross: true } });
    const g = emp.payType === 'EMPLOYEE' && gross > 0 ? grades.find((x) => gross >= x.minGross && (x.maxGross == null || gross <= x.maxGross)) ?? null : null;
    const today = new Date(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const dated = await this.prisma.gradeCostRate.findFirst({
      where: { companyId, gradeName: g?.name ?? null, effectiveFrom: { lte: today } },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'desc' }],
    });
    const base = { grade: g ? { name: g.name, label: g.label } : null, monthlyGross: gross > 0 ? Math.round(gross) : null, hoursPerMonth: HOURS };
    if (emp.hourlyCostRate != null) return { ...base, rate: emp.hourlyCostRate, source: 'OWN' };
    if (dated) return { ...base, rate: dated.rate, source: g ? 'GRADE' : 'UNGRADED', since: dated.effectiveFrom.toISOString().slice(0, 10) };
    if (gross > 0) return { ...base, rate: Math.round((gross / HOURS) * 100) / 100, source: 'SALARY' };
    return { ...base, rate: null, source: null };
  }

  /**
   * Resend the "your login email has been changed" notice (19 Nov 2026) —
   * e.g. the person missed or deleted the first one. Uses the last recorded
   * change, so it always names the right old and new address.
   */
  async resendLoginEmailNotice(companyId: number, role: string, actorUserId: number | null, employeeId: number) {
    if (!['SUPERADMIN', 'HR'].includes(role)) throw new ForbiddenException('Only the Super Admin or HR can resend this.');
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, firstName: true, lastName: true, user: { select: { id: true, email: true, role: true } } },
    });
    if (!emp?.user) throw new NotFoundException('Employee not found');
    if (role === 'HR' && emp.user.role === 'SUPERADMIN') throw new ForbiddenException('HR cannot act on a Super Admin\'s login.');
    const last = await this.prisma.auditLog.findFirst({
      where: { companyId, action: 'LOGIN_EMAIL_CHANGED', entityType: 'User', entityId: String(emp.user.id) },
      orderBy: { createdAt: 'desc' },
    });
    const oldEmail = (last?.oldValue as any)?.email as string | undefined;
    if (!last || !oldEmail) throw new BadRequestException('No login email change on record for this person — use "Change login email" first.');
    const email = emp.user.email;
    const name = `${emp.firstName} ${emp.lastName}`.trim();
    const companyName = (await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name ?? undefined;
    let emailed = true;
    for (const to of [email, oldEmail]) {
      try { await this.mailService.sendLoginEmailChanged(to, name, email, oldEmail, companyName); } catch { emailed = false; }
    }
    try {
      await this.notifications.createNotification(
        emp.user.id,
        'Your login email has been changed',
        `Use ${email} to sign in to MIRA from now on (previously ${oldEmail}). Your password stays the same. Login: ${(process.env.APP_URL || 'https://mira.ces-pl.com').replace(/\/+$/, '')}/login`,
        'INFO', '/dashboard', companyId,
      );
    } catch { /* best-effort */ }
    await this.prisma.auditLog.create({
      data: { companyId, actorId: actorUserId, action: 'LOGIN_EMAIL_NOTICE_RESENT', entityType: 'User', entityId: String(emp.user.id),
        newValue: { email, oldEmail, emailed } as any },
    }).catch(() => undefined);
    return { email, previousEmail: oldEmail, emailed };
  }

  // ── Welcome + intro emails (#16, 19 Nov 2026) ───────────────────────
  private static readonly INTRO_ROLES = ['SUPERADMIN', 'HR'];

  private async introPerson(companyId: number, employeeId: number) {
    const emp = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      select: { id: true, firstName: true, lastName: true, avatarUrl: true, joiningDate: true,
        user: { select: { id: true, email: true } },
        designation: { select: { name: true } }, department: { select: { name: true } },
        branch: { select: { name: true } }, manager: { select: { firstName: true, lastName: true } } },
    });
    if (!emp?.user) throw new NotFoundException('Employee not found');
    const name = `${emp.firstName} ${emp.lastName}`.replace(/\s+/g, ' ').trim();
    const card = {
      name, designation: emp.designation?.name, department: emp.department?.name,
      manager: emp.manager ? `${emp.manager.firstName} ${emp.manager.lastName}`.replace(/\s+/g, ' ').trim() : undefined,
      joined: emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : undefined,
      location: emp.branch?.name, photo: emp.avatarUrl || undefined,
    };
    const companyName = (await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name ?? undefined;
    return { emp, name, card, companyName };
  }

  private async lastSend(companyId: number, action: string, employeeId: number) {
    const last = await this.prisma.auditLog.findFirst({ where: { companyId, action, entityType: 'Employee', entityId: String(employeeId) }, orderBy: { createdAt: 'desc' } });
    if (!last) return null;
    const by = last.actorId ? await this.prisma.user.findUnique({ where: { id: last.actorId }, select: { email: true, employee: { select: { firstName: true, lastName: true } } } }) : null;
    return { at: last.createdAt, by: by?.employee ? `${by.employee.firstName} ${by.employee.lastName}`.trim() : by?.email ?? 'someone', details: last.newValue };
  }

  async introStatus(companyId: number, role: string, employeeId: number) {
    if (!EmployeesService.INTRO_ROLES.includes(role)) throw new ForbiddenException('Only the Super Admin or HR can do this.');
    const { card, name, companyName } = await this.introPerson(companyId, employeeId);
    const first = name.split(' ')[0];
    const what = [card.designation && `as ${card.designation}`, card.department && `in ${card.department}`].filter(Boolean).join(' ');
    return {
      card,
      welcome: await this.lastSend(companyId, 'WELCOME_EMAIL_SENT', employeeId),
      intro: await this.lastSend(companyId, 'INTRO_EMAIL_SENT', employeeId),
      defaultSubject: `Please welcome ${name} to ${companyName || 'the team'}`,
      defaultMessage: `Hi everyone,\n\nPlease join us in welcoming ${name}, who has joined us ${what || 'today'}${card.manager ? `, reporting to ${card.manager}` : ''}.\n\nDo say hello and help ${first} settle in.\n\nWarm regards,\nHR Team`,
    };
  }

  async sendWelcome(companyId: number, role: string, actorUserId: number | null, employeeId: number, force = false) {
    if (!EmployeesService.INTRO_ROLES.includes(role)) throw new ForbiddenException('Only the Super Admin or HR can do this.');
    const { emp, name, companyName } = await this.introPerson(companyId, employeeId);
    const prev = await this.lastSend(companyId, 'WELCOME_EMAIL_SENT', employeeId);
    if (prev && !force) throw new ConflictException(`Welcome email was already sent on ${new Date(prev.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${prev.by}.`);
    let emailed = true;
    try { await this.mailService.sendJoinerWelcomeEmail(emp.user!.email, name, emp.user!.email, companyName); } catch { emailed = false; }
    try { await this.notifications.createNotification(emp.user!.id, `Welcome to ${companyName || 'the team'}!`, 'Start by completing your profile and uploading your documents.', 'INFO', `/employees/${emp.id}/profile`, companyId); } catch { /* best-effort */ }
    await this.prisma.auditLog.create({ data: { companyId, actorId: actorUserId, action: 'WELCOME_EMAIL_SENT', entityType: 'Employee', entityId: String(emp.id), newValue: { to: emp.user!.email, emailed, resent: !!prev } as any } }).catch(() => undefined);
    return { to: emp.user!.email, emailed };
  }

  async sendIntro(companyId: number, role: string, actorUserId: number | null, employeeId: number,
    body: { departmentIds?: number[]; employeeIds?: number[]; everyone?: boolean; subject?: string; message?: string; force?: boolean }) {
    if (!EmployeesService.INTRO_ROLES.includes(role)) throw new ForbiddenException('Only the Super Admin or HR can do this.');
    const subject = (body.subject || '').trim(); const message = (body.message || '').trim();
    if (!subject || !message) throw new BadRequestException('Subject and message are required.');
    const { emp, name, card, companyName } = await this.introPerson(companyId, employeeId);
    const prev = await this.lastSend(companyId, 'INTRO_EMAIL_SENT', employeeId);
    if (prev && !body.force) throw new ConflictException(`An intro for ${name} was already sent on ${new Date(prev.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} by ${prev.by}.`);
    const deptIds = (body.departmentIds || []).map(Number).filter(Boolean);
    const empIds = (body.employeeIds || []).map(Number).filter(Boolean);
    if (!body.everyone && !deptIds.length && !empIds.length) throw new BadRequestException('Pick at least one department or person.');
    const people = await this.prisma.employee.findMany({
      where: { companyId, isCompanyAccount: false, user: { status: 'ACTIVE' },
        ...(body.everyone ? {} : { OR: [{ id: { in: [...empIds, emp.id] } }, ...(deptIds.length ? [{ departmentId: { in: deptIds } }] : [])] }) },
      select: { id: true, user: { select: { id: true, email: true } } },
    });
    const list = people.filter(p => p.user?.email);
    if (!list.some(p => p.id === emp.id) && emp.user) list.push({ id: emp.id, user: emp.user } as any);
    let emailed = 0, failed = 0;
    for (const p of list) {
      try { await this.mailService.sendIntroEmail(p.user!.email, subject, message, card, companyName); emailed++; } catch { failed++; }
      try { await this.notifications.createNotification(p.user!.id, `Please welcome ${name}`, [card.designation, card.department].filter(Boolean).join(' · ') || 'Our newest team member', 'INFO', `/employees/${emp.id}/profile`, companyId); } catch { /* best-effort */ }
    }
    await this.prisma.auditLog.create({ data: { companyId, actorId: actorUserId, action: 'INTRO_EMAIL_SENT', entityType: 'Employee', entityId: String(emp.id),
      newValue: { recipients: list.length, emailed, failed, departmentIds: deptIds, employeeIds: empIds, everyone: !!body.everyone, subject, resent: !!prev } as any } }).catch(() => undefined);
    return { recipients: list.length, emailed, failed };
  }

  // ── Shared login hand over (16 Nov 2026) ───────────────────────────────
  // hr@ces-pl.com is a shared mailbox that is also somebody's MIRA login. When
  // HR changes, the Super Admin moves it to the next person in one step: the
  // leaver keeps their history under a renamed, deactivated login; the new
  // person gets the address, the role and the leaver's reportees.

  static readonly SHARED_LOGINS = ['hr@ces-pl.com'];

  async handoverSharedLogin(companyId: number, role: string, actorUserId: number | null, fromEmployeeId: number, toEmployeeId: number) {
    if (role !== 'SUPERADMIN') throw new ForbiddenException('Only the Super Admin can hand over the HR login.');
    if (fromEmployeeId === toEmployeeId) throw new BadRequestException('Choose a different person to hand over to.');
    const pick = { id: true, firstName: true, lastName: true, user: { select: { id: true, email: true, role: true, status: true } } } as const;
    const [from, to] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: fromEmployeeId, companyId }, select: pick }),
      this.prisma.employee.findFirst({ where: { id: toEmployeeId, companyId }, select: pick }),
    ]);
    if (!from?.user || !to?.user) throw new NotFoundException('Employee not found');
    const shared = from.user.email.toLowerCase();
    if (!EmployeesService.SHARED_LOGINS.includes(shared)) throw new BadRequestException('Only the shared HR login can be handed over.');
    if (to.user.status !== 'ACTIVE') throw new BadRequestException(`${to.firstName} ${to.lastName} is not an active user.`);

    const domain = shared.split('@')[1];
    const slug = `${from.firstName}.${from.lastName}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9.]+/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '') || 'former';
    const leaverEmail = `${slug}.exited${from.user.id}@${domain}`;
    // The Super Admin stays Super Admin; anyone else takes the shared login's role.
    const newRole = ['SUPERADMIN', 'ADMIN'].includes(to.user.role) ? to.user.role : from.user.role;

    const moved = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: from.user!.id }, data: { email: leaverEmail, status: 'SUSPENDED' } });
      await tx.user.update({ where: { id: to.user!.id }, data: { email: shared, role: newRole, emailVerifiedAt: new Date() } });
      const reportees = await tx.employee.updateMany({ where: { managerId: from.id, companyId, id: { not: to.id } }, data: { managerId: to.id } });
      await tx.auditLog.create({
        data: {
          companyId, actorId: actorUserId, action: 'SHARED_LOGIN_HANDOVER', entityType: 'User', entityId: String(to.user!.id),
          oldValue: { from: { employeeId: from.id, userId: from.user!.id, email: shared }, to: { employeeId: to.id, userId: to.user!.id, email: to.user!.email, role: to.user!.role } } as any,
          newValue: { from: { email: leaverEmail, status: 'SUSPENDED' }, to: { email: shared, role: newRole }, reporteesMoved: reportees.count } as any,
        },
      });
      return reportees.count;
    });
    forgetAccountStatus(from.user.id);
    forgetAccountStatus(to.user.id);

    try {
      await this.notifications.notifyEmployees([to.id], {
        companyId,
        title: `You now hold ${shared}`,
        message: `Your MIRA login is now ${shared} (was ${to.user.email}). Your password is unchanged.`,
        type: 'SYSTEM',
        linkUrl: '/employees/my-profile',
      } as any);
    } catch { /* the hand over stands without the notice */ }

    return {
      shared, role: newRole, reporteesMoved: moved,
      from: { name: `${from.firstName} ${from.lastName}`, email: leaverEmail },
      to: { name: `${to.firstName} ${to.lastName}`, previousEmail: to.user.email },
    };
  }
}
