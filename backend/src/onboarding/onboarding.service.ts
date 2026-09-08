import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

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

      await this.prisma.employee.update({
        where: { id: empId },
        data: { onboardingStatus: newStatus }
      });
    }

    return this.prisma.onboardingTemplate.delete({
      where: { id, companyId }
    });
  }

  // --- Board (HR view) ---
  async getOnboardingBoard(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      include: {
        user: { select: { email: true } },
        designation: { select: { name: true } },
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
      where: { userId, companyId }
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
      await this.prisma.employee.update({
        where: { id: employee.id },
        data: { onboardingStatus: newStatus }
      });
    }

    return { success: true, newStatus };
  }

  // --- Admin/HR Actions ---
  async toggleTaskForAdmin(companyId: number, taskId: number, isCompleted: boolean) {
    // First, verify the task belongs to an employee in this company
    const task = await this.prisma.employeeOnboardingTask.findUnique({
      where: { id: taskId },
      include: { employee: true }
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
      await this.prisma.employee.update({
        where: { id: task.employeeId },
        data: { onboardingStatus: newStatus }
      });
    }

    return { success: true, newStatus, employeeId: task.employeeId };
  }

  async updateEmployeeStatus(companyId: number, employeeId: number, status: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId }
    });
    
    if (!employee) throw new NotFoundException('Employee not found');

    await this.prisma.employee.update({
      where: { id: employeeId },
      data: { onboardingStatus: status }
    });

    return { success: true, status };
  }

  async getCompanyPipelineSummary(companyId: number) {
    return this.prisma.employee.groupBy({
      by: ['onboardingStatus'],
      where: { companyId },
      _count: true
    });
  }
}
