import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OffboardingService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService
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

    return this.prisma.resignation.findMany({
      where: whereClause,
      include: {
        employee: { select: { id: true, user: { select: { email: true } }, salutation: true } },
        approver: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
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

    const resignation = await this.prisma.resignation.create({
      data: {
        companyId,
        employeeId,
        reason: data.reason,
        intendedLastWorkingDay: new Date(data.intendedLastWorkingDay)
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
    remarks?: string
  ) {
    const resignation = await this.prisma.resignation.findFirst({
      where: { id: resignationId, companyId },
      include: { employee: true }
    });

    if (!resignation) throw new NotFoundException('Resignation not found');

    const updated = await this.prisma.resignation.update({
      where: { id: resignationId },
      data: {
        status,
        approvedLastWorkingDay: approvedLastWorkingDay ? new Date(approvedLastWorkingDay) : null,
        approverId: userId,
        remarks
      }
    });

    if (status === 'APPROVED') {
      // Update Employee Status
      await this.prisma.employee.update({
        where: { id: resignation.employeeId },
        data: { offboardingStatus: 'IN_PROGRESS' }
      });

      // Seed Default Offboarding Tasks
      const defaultTasks = [
        { department: 'IT', taskName: 'Revoke Systems Access', description: 'Disable email, Slack, and internal tools.' },
        { department: 'IT', taskName: 'Collect Hardware', description: 'Retrieve laptop, monitor, and peripherals.' },
        { department: 'HR', taskName: 'Exit Interview', description: 'Conduct exit interview.' },
        { department: 'FINANCE', taskName: 'Full & Final Settlement', description: 'Process final payroll, clear dues.' }
      ];

      await this.prisma.offboardingTask.createMany({
        data: defaultTasks.map(t => ({
          companyId,
          employeeId: resignation.employeeId,
          department: t.department,
          taskName: t.taskName,
          description: t.description,
          status: 'PENDING'
        }))
      });

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

  // Clearance Tasks Methods
  async getTasks(companyId: number) {
    return this.prisma.offboardingTask.findMany({
      where: { companyId },
      include: {
        employee: { select: { id: true, userId: true } },
        clearedBy: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async clearTask(taskId: number, companyId: number, userId: number, remarks?: string) {
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
        remarks
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
        employee: { select: { id: true } },
        interviewer: { select: { id: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
