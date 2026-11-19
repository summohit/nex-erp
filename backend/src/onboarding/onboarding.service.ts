import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { temporaryPassword } from '../common/temporary-password';
import { forgetAccountStatus } from '../auth/auth.guard';
import { lockJobCapacity, closeFilledJobs } from '../recruitment/job-capacity';

import { MailService } from '../mail/mail.service';
import { documentProgress, loadDocumentPolicy, requiredRulesFor } from '../employees/profile-completeness/document-policy';
import { isIntern } from '../employees/profile-completeness/profile-documents';

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService, private mailService: MailService) {}

  // --- Templates (HR view) ---
  async getTemplates(companyId: number) {
    return this.prisma.onboardingTemplate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async addTemplate(companyId: number, data: { title: string, description?: string }) {
    const template = await this.prisma.onboardingTemplate.create({
      data: {
        title: data.title,
        description: data.description,
        companyId
      }
    });

    // Retroactively assign to employees currently in the onboarding pipeline
    const onboardingEmployees = await this.prisma.employee.findMany({
      where: {
        companyId,
        onboardingStatus: {
          in: ['PENDING', 'IN_PROGRESS']
        }
      },
      select: { id: true }
    });

    if (onboardingEmployees.length > 0) {
      await this.prisma.employeeOnboardingTask.createMany({
        data: onboardingEmployees.map(emp => ({
          employeeId: emp.id,
          title: template.title,
          description: template.description
        }))
      });
    }

    return template;
  }

  async deleteTemplate(companyId: number, id: number) {
    const template = await this.prisma.onboardingTemplate.findUnique({
      where: { id, companyId }
    });

    if (!template) throw new NotFoundException('Template not found');

    // Find affected employees before deleting
    const affectedTasks = await this.prisma.employeeOnboardingTask.findMany({
      where: {
        title: template.title,
        isCompleted: false,
        employee: { companyId }
      },
      select: { employeeId: true }
    });

    const affectedEmployeeIds = [...new Set(affectedTasks.map(t => t.employeeId))];

    // Retroactively remove this task from employees who haven't completed it
    await this.prisma.employeeOnboardingTask.deleteMany({
      where: {
        title: template.title,
        isCompleted: false,
        employee: { companyId }
      }
    });

    // Recalculate status for affected employees
    for (const empId of affectedEmployeeIds) {
      const allTasks = await this.prisma.employeeOnboardingTask.findMany({
        where: { employeeId: empId }
      });

      const completedTasksCount = allTasks.filter(t => t.isCompleted).length;
      let newStatus = 'PENDING';

      if (completedTasksCount === allTasks.length && allTasks.length > 0) {
        newStatus = 'COMPLETED';
      } else if (completedTasksCount > 0) {
        newStatus = 'IN_PROGRESS';
      }

      await this.setOnboardingStatus(companyId, empId, newStatus);
    }

    return this.prisma.onboardingTemplate.delete({
      where: { id, companyId }
    });
  }

  // --- Board (HR view) ---
  async getOnboardingBoard(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      // #33 (19 Nov 2026): deactivated / separated people drop off the board.
      where: {
        companyId, isCompanyAccount: false, user: { status: { not: 'SUSPENDED' } }, offboardingStatus: { not: 'SEPARATED' },
        // 19 Nov 2026: only new hires — anyone mid self-onboarding, plus anyone
        // who joined in the last 30 days. Long-standing staff stay off the board.
        OR: [
          { selfOnboardingStatus: { in: ['PENDING', 'SUBMITTED', 'CHANGES_REQUESTED'] } },
          { joiningDate: { gte: new Date(Date.now() - 30 * 86400000) } },
        ],
      },
      // Only what the board shows. This used to return every column of every
      // employee — bank, passport and ID numbers included.
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        employeeCode: true,
        joiningDate: true,
        onboardingStatus: true,
        selfOnboardingStatus: true,
        createdAt: true,
        user: { select: { email: true } },
        designation: { select: { name: true } },
        department: { select: { name: true } },
        onboardingTasks: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const pending = employees.filter(e => e.onboardingStatus === 'PENDING');
    const inProgress = employees.filter(e => e.onboardingStatus === 'IN_PROGRESS');
    const completed = employees.filter(e => e.onboardingStatus === 'COMPLETED');

    return { pending, inProgress, completed };
  }

  // --- My Tasks (Employee view) ---
  async getMyTasks(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      include: { onboardingTasks: { orderBy: { createdAt: 'asc' } } }
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return {
      status: employee.onboardingStatus,
      tasks: employee.onboardingTasks
    };
  }

  async completeTask(companyId: number, userId: number, taskId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId, companyId },
      include: { user: true }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    // Mark task as completed
    await this.prisma.employeeOnboardingTask.update({
      where: { id: taskId, employeeId: employee.id },
      data: { isCompleted: true, completedAt: new Date() }
    });

    // Check if all tasks are now completed
    const allTasks = await this.prisma.employeeOnboardingTask.findMany({
      where: { employeeId: employee.id }
    });

    const completedTasksCount = allTasks.filter(t => t.isCompleted).length;
    let newStatus = employee.onboardingStatus;

    if (completedTasksCount === allTasks.length && allTasks.length > 0) {
      newStatus = 'COMPLETED';
    } else if (completedTasksCount > 0) {
      newStatus = 'IN_PROGRESS';
    }

    if (newStatus !== employee.onboardingStatus) {
      await this.setOnboardingStatus(companyId, employee.id, newStatus);

      if (newStatus === 'COMPLETED') {
        void this.notifyOnboardingCompleted(companyId, employee.id);
      }
    }

    return { success: true, newStatus };
  }

  // --- Admin/HR Actions ---
  async toggleTaskForAdmin(companyId: number, taskId: number, isCompleted: boolean) {
    // First, verify the task belongs to an employee in this company
    const task = await this.prisma.employeeOnboardingTask.findUnique({
      where: { id: taskId },
      include: { employee: { include: { user: true } } }
    });
    
    if (!task || task.employee.companyId !== companyId) {
      throw new NotFoundException('Task not found');
    }

    await this.prisma.employeeOnboardingTask.update({
      where: { id: taskId },
      data: { 
        isCompleted, 
        completedAt: isCompleted ? new Date() : null 
      }
    });

    // Recalculate status
    const allTasks = await this.prisma.employeeOnboardingTask.findMany({
      where: { employeeId: task.employeeId }
    });

    const completedTasksCount = allTasks.filter(t => t.isCompleted).length;
    let newStatus = task.employee.onboardingStatus;

    if (completedTasksCount === allTasks.length && allTasks.length > 0) {
      newStatus = 'COMPLETED';
    } else if (completedTasksCount > 0) {
      newStatus = 'IN_PROGRESS';
    } else {
      newStatus = 'PENDING';
    }

    if (newStatus !== task.employee.onboardingStatus) {
      await this.setOnboardingStatus(companyId, task.employeeId, newStatus);

      if (newStatus === 'COMPLETED') {
        void this.notifyOnboardingCompleted(companyId, task.employeeId);
      }
    }

    return { success: true, newStatus, employeeId: task.employeeId };
  }

  async updateEmployeeStatus(companyId: number, employeeId: number, status: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId }
    });
    
    if (!employee) throw new NotFoundException('Employee not found');

    await this.setOnboardingStatus(companyId, employeeId, status);

    return { success: true, status };
  }

  private async setOnboardingStatus(companyId: number, employeeId: number, status: string) {
    await this.prisma.$transaction(async tx => {
      await lockJobCapacity(tx, companyId);
      await tx.employee.update({ where: { id: employeeId, companyId }, data: { onboardingStatus: status } });
      if (status === 'COMPLETED') await closeFilledJobs(tx, companyId);
    });
  }

  /** Notify both the new colleague and their reporting manager after onboarding completes. */
  private async notifyOnboardingCompleted(companyId: number, employeeId: number) {
    try {
      const employee = await this.prisma.employee.findFirst({
        where: { id: employeeId, companyId },
        include: {
          user: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
          branch: { select: { name: true } },
          manager: { include: { user: true } },
        },
      });
      if (!employee) return;

      const employeeName = `${employee.firstName} ${employee.lastName}`.trim();
      const notifications: Promise<unknown>[] = [];

      if (employee.user?.email) {
        notifications.push(
          this.mailService.sendOnboardingCompletedEmail(employee.user.email, employeeName),
        );
      }

      const managerEmail = employee.manager?.user?.email;
      if (managerEmail && managerEmail.toLowerCase() !== employee.user?.email?.toLowerCase()) {
        const managerName = `${employee.manager?.firstName || ''} ${employee.manager?.lastName || ''}`.trim();
        notifications.push(
          this.mailService.sendManagerOnboardingCompletedEmail({
            managerEmail,
            managerName,
            employeeName,
            employeeCode: employee.employeeCode,
            designation: employee.designation?.name,
            department: employee.department?.name,
            joiningDate: employee.joiningDate,
            workLocation: employee.workLocation || employee.branch?.name,
            employeeEmail: employee.user?.email,
          }),
        );
      }

      await Promise.allSettled(notifications);
    } catch (error) {
      // Email delivery must never prevent an onboarding action from succeeding.
      console.error('Failed to send onboarding completion notifications:', error);
    }
  }

  // --- Self-service onboarding (13 Nov 2026) ---------------------------------
  // The new joiner fills their own profile (personal, bank, address, family,
  // emergency contacts, documents, resume) and submits it; HR approves it or
  // sends it back with a note per section. Until approval the app shows the
  // person nothing but this form.

  static readonly SELF_SECTIONS: Record<string, string> = {
    personal: 'Personal information',
    contact: 'Private contact & banking',
    address: 'Location & address',
    family: 'Family details',
    emergency: 'Emergency contacts',
    documents: 'Documents',
    resume: 'Resume & skills',
  };

  private async employeeForUser(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('No employee record for this login');
    return employee;
  }

  /**
   * Required before a new joiner can submit. Keys match the profile form
   * fields, so the screen can jump straight to the empty one.
   */
  /** Documents a new joiner must upload (types as the Documents tab saves them; decided 16 Nov 2026). */
  static readonly SELF_REQUIRED_DOCS = [
    'Resume / CV', 'Aadhaar Card', 'PAN Card', 'Passport Size Photo',
    '10th Marksheet', '12th Marksheet', 'Graduation Degree', 'Bank Proof / Cancelled Cheque',
  ];

  /** Checklist groups shown to the new joiner; `fields` are profile form keys (16 Nov 2026). */
  static readonly SELF_REQUIRED: { key: string; label: string; tab: 'personal' | 'contacts' | 'documents'; fields?: { key: string; label: string }[] }[] = [
    // Required from 16 Nov 2026.
    { key: 'profilePhoto', label: 'Profile picture', tab: 'personal', fields: [{ key: 'avatarUrl', label: 'Profile picture' }] },
    { key: 'dateOfBirth', label: 'Date of birth', tab: 'personal', fields: [{ key: 'dateOfBirth', label: 'Date of birth' }] },
    { key: 'contactBank', label: 'Contact & bank details', tab: 'personal', fields: [
      { key: 'personalEmail', label: 'Personal email' },
      { key: 'phone', label: 'Mobile phone' }, { key: 'bankName', label: 'Bank name' },
      { key: 'bankAccountNumber', label: 'Bank account number' }, { key: 'ifscCode', label: 'IFSC code' },
    ] },
    { key: 'addressDetails', label: 'Address details', tab: 'personal', fields: [
      { key: 'country', label: 'Country' }, { key: 'state', label: 'State' }, { key: 'city', label: 'City' },
      { key: 'zipCode', label: 'PIN code' },
      { key: 'address', label: 'Street address' },
    ] },
    { key: 'emergencyContact', label: 'Emergency contact', tab: 'contacts' },
    { key: 'documents', label: 'Documents', tab: 'documents' },
  ];

  private async missingRequired(e: any) {
    const contacts = await this.prisma.emergencyContact.count({ where: { employeeId: e.id } });
    const docs = await this.prisma.employeeDocument.findMany({ where: { employeeId: e.id }, select: { documentType: true } });
    // HR's document rules (Settings → Document Requirements, 16 Nov 2026).
    const policy = await loadDocumentPolicy(this.prisma, e.companyId);
    const designation = e.designationId
      ? (await this.prisma.designation.findUnique({ where: { id: e.designationId }, select: { name: true } }))?.name
      : null;
    const docRules = documentProgress(
      requiredRulesFor(policy, { intern: isIntern(e.employmentType, designation), firstJob: !!e.firstJob }), docs,
      (await this.prisma.documentWaiver.findMany({ where: { employeeId: e.id, status: 'APPROVED' }, select: { documentType: true } }))
        .map(w => w.documentType));
    const missingDocs = docRules.filter(r => !r.done).map(r => r.type);
    const text = (v: any) => !!String(v ?? '').trim();
    // State and city lists exist for India; elsewhere they may be empty, so don't block on them.
    const statesExpected = !e.country || e.country === 'IN';
    const fieldFilled: Record<string, boolean> = {
      avatarUrl: text(e.avatarUrl),
      personalEmail: text(e.personalEmail),
      dateOfBirth: !!e.dateOfBirth,
      phone: text(e.phone), bankName: text(e.bankName), bankAccountNumber: text(e.bankAccountNumber), ifscCode: text(e.ifscCode),
      country: text(e.country), state: !statesExpected || text(e.state), city: !statesExpected || text(e.city),
      zipCode: text(e.zipCode), address: text(e.address),
    };
    return OnboardingService.SELF_REQUIRED.map(r => {
      if (r.fields) {
        const missingFields = r.fields.filter(f => !fieldFilled[f.key]);
        const total = r.fields.length;
        return {
          key: r.key, tab: r.tab, done: !missingFields.length,
          label: missingFields.length && total > 1 ? `${r.label} (${missingFields.length} of ${total} left)` : r.label,
          field: missingFields[0]?.key ?? r.fields[0].key,
          missingFields,
        };
      }
      if (r.key === 'documents') {
        return {
          key: r.key, tab: r.tab, done: !missingDocs.length,
          label: missingDocs.length ? `Documents (${missingDocs.length} of ${docRules.length} left)` : 'Documents',
          missingDocs, requiredDocs: docRules.map(r => r.type), docRules,
        };
      }
      return { key: r.key, label: r.label, tab: r.tab, done: contacts > 0 };
    });
  }

  async getMySelfOnboarding(companyId: number, userId: number) {
    const e = await this.employeeForUser(companyId, userId);
    return {
      employeeId: e.id,
      required: await this.missingRequired(e),
      status: e.selfOnboardingStatus,
      notes: e.selfOnboardingNotes ?? {},
      submittedAt: e.selfOnboardingSubmittedAt,
      reviewedAt: e.selfOnboardingReviewedAt,
      sections: OnboardingService.SELF_SECTIONS,
    };
  }

  async submitMySelfOnboarding(companyId: number, userId: number) {
    const e = await this.employeeForUser(companyId, userId);
    if (e.selfOnboardingStatus !== 'PENDING' && e.selfOnboardingStatus !== 'CHANGES_REQUESTED') {
      throw new BadRequestException('Your profile is not open for submission.');
    }
    // The few fields HR can't do without; everything else is reviewed by eye.
    const required = await this.missingRequired(e);
    const missing = required.filter(r => !r.done);
    if (missing.length) {
      throw new BadRequestException({
        message: `Please add your ${missing.map(m => m.label.toLowerCase()).join(', ')} before submitting.`,
        missing,
      });
    }

    await this.prisma.employee.update({
      where: { id: e.id },
      data: { selfOnboardingStatus: 'SUBMITTED', selfOnboardingSubmittedAt: new Date() },
    });
    return { status: 'SUBMITTED' };
  }

  /** HR list: everyone in the self-service flow who isn't approved yet. */
  async getSelfOnboardingQueue(companyId: number) {
    return this.prisma.employee.findMany({
      where: { companyId, selfOnboardingStatus: { in: ['PENDING', 'SUBMITTED', 'CHANGES_REQUESTED'] } },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, joiningDate: true,
        selfOnboardingStatus: true, selfOnboardingNotes: true, selfOnboardingSubmittedAt: true, selfOnboardingReviewedAt: true,
        department: { select: { name: true } }, designation: { select: { name: true } },
        user: { select: { email: true } },
      },
      orderBy: [{ selfOnboardingSubmittedAt: 'desc' }, { id: 'desc' }],
    });
  }

  async reviewSelfOnboarding(companyId: number, employeeId: number, decision: 'APPROVE' | 'CHANGES', notes?: Record<string, string>, role?: string) {
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { user: { select: { email: true } } } });
    if (!e) throw new NotFoundException('Employee not found');
    // The Super Admin may approve a profile that was sent back, without waiting
    // for the joiner to resubmit (16 Nov 2026). Everyone else reviews submitted ones only.
    const overrideApprove = decision === 'APPROVE' && role === 'SUPERADMIN' && e.selfOnboardingStatus === 'CHANGES_REQUESTED';
    if (e.selfOnboardingStatus !== 'SUBMITTED' && !overrideApprove) {
      throw new BadRequestException(role === 'SUPERADMIN' && decision === 'APPROVE'
        ? 'Only a submitted or sent-back profile can be approved.'
        : 'Only a submitted profile can be reviewed.');
    }

    if (decision === 'CHANGES') {
      const clean = Object.fromEntries(Object.entries(notes || {})
        .filter(([k, v]) => k in OnboardingService.SELF_SECTIONS && typeof v === 'string' && v.trim())
        .map(([k, v]) => [k, v.trim().slice(0, 1000)]));
      if (!Object.keys(clean).length) throw new BadRequestException('Add a note to at least one section.');
      await this.prisma.employee.update({
        where: { id: e.id },
        data: { selfOnboardingStatus: 'CHANGES_REQUESTED', selfOnboardingNotes: clean, selfOnboardingReviewedAt: new Date() },
      });
      if (e.user?.email) {
        await this.mailService.sendOnboardingChangesRequestedEmail(e.user.email, `${e.firstName} ${e.lastName}`.trim(), clean, OnboardingService.SELF_SECTIONS);
      }
      return { status: 'CHANGES_REQUESTED' };
    }

    await this.prisma.employee.update({
      where: { id: e.id },
      data: { selfOnboardingStatus: 'APPROVED', selfOnboardingNotes: Prisma.DbNull, selfOnboardingReviewedAt: new Date() },
    });
    await this.setOnboardingStatus(companyId, e.id, 'COMPLETED');
    await this.notifyOnboardingCompleted(companyId, e.id);
    return { status: 'APPROVED' };
  }

  /**
   * Bring an employee created before self-service onboarding (or one whose
   * invite needs resending) into the new flow: activate the login, issue a
   * fresh temporary password, and email it with their employee ID (16 Nov 2026).
   */
  async inviteToSelfOnboarding(companyId: number, employeeId: number) {
    const e = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: { user: { select: { id: true, email: true } }, company: { select: { name: true } } },
    });
    if (!e || !e.user) throw new NotFoundException('Employee not found');
    if (e.selfOnboardingStatus === 'APPROVED' || e.onboardingStatus === 'COMPLETED') {
      throw new BadRequestException('Onboarding is already complete for this employee.');
    }
    if (e.selfOnboardingStatus === 'SUBMITTED') {
      throw new BadRequestException('They have already submitted their profile. Review it under Profile reviews.');
    }

    const tempPassword = temporaryPassword();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: e.user.id },
        data: {
          password: await bcrypt.hash(tempPassword, 10),
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          mustChangePassword: true,
        },
      }),
      this.prisma.employee.update({
        where: { id: e.id },
        data: {
          selfOnboardingStatus: e.selfOnboardingStatus === 'CHANGES_REQUESTED' ? 'CHANGES_REQUESTED' : 'PENDING',
          ...(e.onboardingStatus === 'PENDING' ? { onboardingStatus: 'IN_PROGRESS' } : {}),
        },
      }),
    ]);
    forgetAccountStatus(e.user.id);

    let credentialsEmailed = true;
    try {
      await this.mailService.sendOnboardingCredentialsEmail({
        email: e.user.email,
        name: `${e.firstName} ${e.lastName}`.trim(),
        employeeCode: e.employeeCode || '',
        tempPassword,
        companyName: e.company?.name,
      });
    } catch {
      credentialsEmailed = false;
    }
    return { credentialsEmailed, email: e.user.email };
  }

  async getCompanyPipelineSummary(companyId: number) {
    return this.prisma.employee.groupBy({
      by: ['onboardingStatus'],
      where: { companyId },
      _count: true
    });
  }
}
