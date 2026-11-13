import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { lockJobCapacity, closeFilledJobs } from '../recruitment/job-capacity';

import { MailService } from '../mail/mail.service';

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
      where: { companyId },
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

  async getMySelfOnboarding(companyId: number, userId: number) {
    const e = await this.employeeForUser(companyId, userId);
    return {
      employeeId: e.id,
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
    const missing: string[] = [];
    if (!e.dateOfBirth) missing.push('date of birth');
    if (!e.bankAccountNumber) missing.push('bank account number');
    if (!e.address) missing.push('address');
    const contacts = await this.prisma.emergencyContact.count({ where: { employeeId: e.id } });
    if (!contacts) missing.push('at least one emergency contact');
    if (missing.length) throw new BadRequestException(`Please add your ${missing.join(', ')} before submitting.`);

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

  async reviewSelfOnboarding(companyId: number, employeeId: number, decision: 'APPROVE' | 'CHANGES', notes?: Record<string, string>) {
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { user: { select: { email: true } } } });
    if (!e) throw new NotFoundException('Employee not found');
    if (e.selfOnboardingStatus !== 'SUBMITTED') throw new BadRequestException('Only a submitted profile can be reviewed.');

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

  async getCompanyPipelineSummary(companyId: number) {
    return this.prisma.employee.groupBy({
      by: ['onboardingStatus'],
      where: { companyId },
      _count: true
    });
  }
}
