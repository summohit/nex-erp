import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async createProject(companyId: number, leadId: number, data: any) {
    // Generate base key from name
    const words = data.name.split(' ').filter((w: string) => w.length > 0);
    let baseKey = '';
    if (words.length >= 2) {
      baseKey = (words[0].substring(0, 2) + words[1][0]).toUpperCase();
    } else {
      baseKey = data.name.substring(0, 3).toUpperCase();
    }
    
    // Ensure key uniqueness per company
    let finalKey = baseKey;
    let counter = 1;
    while (true) {
      const existing = await this.prisma.project.findUnique({
        where: { key_companyId: { key: finalKey, companyId } }
      });
      if (!existing) break;
      finalKey = `${baseKey}${counter}`;
      counter++;
    }

    // Create project, member, and default board
    const project = await this.prisma.project.create({
      data: {
        name: data.name,
        key: finalKey,
        description: data.description,
        color: data.color || '#2563eb',
        icon: data.icon || 'folder',
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        billingType: data.billingType || 'NON_BILLABLE',
        budgetAmount: data.budgetAmount ? parseFloat(data.budgetAmount) : null,
        hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : null,
        clientId: data.clientId ? parseInt(data.clientId, 10) : null,
        companyId,
        leadId,
        members: {
          create: {
            employeeId: leadId,
            role: 'ADMIN'
          }
        },
        boards: {
          create: {
            name: 'Main Board',
            columns: {
              create: [
                { name: 'To Do', color: '#6b7280', position: 0, isSystem: true },
                { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true },
                { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true },
                { name: 'Done', color: '#22c55e', position: 3, isSystem: true },
                { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true }
              ]
            }
          }
        }
      }
    });

    return project;
  }

  async getProjects(companyId: number, userId: number, role: string) {
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';
    const whereClause: any = { companyId, status: 'ACTIVE' };
    
    const emp = await this.prisma.employee.findUnique({ where: { userId } });
    const empId = emp ? emp.id : userId;

    if (!isAdmin) {
      whereClause.members = {
        some: { employeeId: empId }
      };
    }

    return this.prisma.project.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { members: true, issues: true }
        },
        lead: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        members: {
          where: { employeeId: empId },
          select: { isStarred: true }
        }
      }
    });
  }

  async getArchivedProjects(companyId: number, userId: number, role: string) {
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';
    const whereClause: any = { companyId, status: 'ARCHIVED' };
    
    const emp = await this.prisma.employee.findUnique({ where: { userId } });
    const empId = emp ? emp.id : userId;

    if (!isAdmin) {
      whereClause.members = {
        some: { employeeId: empId }
      };
    }

    return this.prisma.project.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { members: true, issues: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });
  }

  async getProjectDetails(companyId: number, projectId: number, userId: number, role: string) {
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';

    if (!isAdmin) {
      const emp = await this.prisma.employee.findUnique({ where: { userId } });
      const empId = emp ? emp.id : userId;
      const isMember = await this.prisma.projectMember.findFirst({
        where: { projectId, employeeId: empId }
      });
      if (!isMember) {
        throw new ForbiddenException('You do not have access to this project');
      }
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId },
      include: {
        members: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } }
            }
          }
        },
        boards: {
          include: {
            columns: {
              orderBy: { position: 'asc' }
            }
          }
        }
      }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async getProjectSummary(companyId: number, projectId: number) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [
      completedLast7Days,
      updatedLast7Days,
      createdLast7Days,
      dueSoonNext7Days,
      statusGroups,
      issueMembersGroups,
      unassignedCount,
      priorityGroups,
      recentActivity,
      typeGroups,
      estimatedHoursSum,
      loggedMinutesSum,
      fourteenDaysIssues
    ] = await Promise.all([
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, status: 'DONE', updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, createdAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, dueDate: { gte: new Date(), lte: sevenDaysFromNow }, status: { not: 'DONE' } }
      }),
      this.prisma.issue.groupBy({
        by: ['status'],
        where: { projectId, companyId, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issueMember.groupBy({
        by: ['employeeId'],
        where: { issue: { projectId, companyId, isArchived: false } },
        _count: { _all: true }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, isArchived: false, members: { none: {} } }
      }),
      this.prisma.issue.groupBy({
        by: ['priority'],
        where: { projectId, companyId, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issueActivity.findMany({
        where: { issue: { projectId, companyId } },
        include: {
          actor: { select: { firstName: true, lastName: true, avatarUrl: true } },
          issue: { select: { id: true, key: true, title: true, status: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 20
      }),
      this.prisma.issue.groupBy({
        by: ['type'],
        where: { projectId, companyId, isArchived: false },
        _count: { _all: true }
      }),
      this.prisma.issue.aggregate({
        _sum: { estimatedHours: true },
        where: { projectId, companyId, isArchived: false }
      }),
      this.prisma.issueTimeLog.aggregate({
        _sum: { durationMin: true },
        where: { issue: { projectId, companyId } }
      }),
      this.prisma.issue.findMany({
        where: { 
          projectId, companyId, isArchived: false,
          OR: [
            { createdAt: { gte: new Date(new Date().setDate(new Date().getDate() - 14)) } },
            { status: 'DONE', updatedAt: { gte: new Date(new Date().setDate(new Date().getDate() - 14)) } }
          ]
        },
        select: { createdAt: true, status: true, updatedAt: true }
      })
    ]);

    // Format assignee groups with names
    const assigneeIds = issueMembersGroups.map(a => a.employeeId);
    let assignees: any[] = [];
    if (assigneeIds.length > 0) {
      assignees = await this.prisma.employee.findMany({
        where: { id: { in: assigneeIds as number[] } },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true }
      });
    }

    const teamWorkload: any[] = issueMembersGroups.map(g => {
      const emp = assignees.find(a => a.id === g.employeeId);
      return {
        assigneeId: g.employeeId,
        name: emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown',
        avatarUrl: emp?.avatarUrl || null,
        count: g._count._all
      };
    });

    if (unassignedCount > 0) {
      teamWorkload.push({
        assigneeId: null,
        name: 'Unassigned',
        avatarUrl: null,
        count: unassignedCount
      });
    }

    const completionTrends: { date: string; created: number; completed: number }[] = [];
    const fourteenDaysAgoDate = new Date();
    fourteenDaysAgoDate.setDate(fourteenDaysAgoDate.getDate() - 13);
    for (let i = 0; i < 14; i++) {
      const d = new Date(fourteenDaysAgoDate);
      d.setDate(d.getDate() + i);
      completionTrends.push({ date: d.toISOString().split('T')[0], created: 0, completed: 0 });
    }

    fourteenDaysIssues.forEach(issue => {
      const createdStr = issue.createdAt.toISOString().split('T')[0];
      const createdBin = completionTrends.find(t => t.date === createdStr);
      if (createdBin) createdBin.created++;

      if (issue.status === 'DONE' && issue.updatedAt) {
        const completedStr = issue.updatedAt.toISOString().split('T')[0];
        const completedBin = completionTrends.find(t => t.date === completedStr);
        if (completedBin) completedBin.completed++;
      }
    });

    return {
      metrics: {
        completedLast7Days,
        updatedLast7Days,
        createdLast7Days,
        dueSoonNext7Days
      },
      statusOverview: statusGroups.map(g => ({ status: g.status, count: g._count._all })),
      teamWorkload,
      priorityBreakdown: priorityGroups.map(g => ({ priority: g.priority, count: g._count._all })),
      recentActivity,
      typeDistribution: typeGroups.map(g => ({ type: g.type, count: g._count._all })),
      timeTracking: {
        estimatedHours: estimatedHoursSum._sum.estimatedHours || 0,
        loggedHours: (loggedMinutesSum._sum.durationMin || 0) / 60
      },
      completionTrends
    };
  }

  async getProjectMembers(companyId: number, projectId: number) {
    return this.prisma.projectMember.findMany({
      where: { projectId, project: { companyId } },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } } }
      }
    });
  }

  async toggleProjectStar(companyId: number, projectId: number, userId: number) {
    const emp = await this.prisma.employee.findUnique({
      where: { userId }
    });

    const targetEmployeeId = emp ? emp.id : userId;

    let member = await this.prisma.projectMember.findFirst({
      where: { projectId, employeeId: targetEmployeeId }
    });

    if (!member) {
      member = await this.prisma.projectMember.create({
        data: { projectId, employeeId: targetEmployeeId, role: 'MEMBER', isStarred: true }
      });
      return { isStarred: true };
    }

    const updated = await this.prisma.projectMember.update({
      where: { id: member.id },
      data: { isStarred: !member.isStarred }
    });

    return { isStarred: updated.isStarred };
  }

  async addProjectMember(companyId: number, projectId: number, employeeId: number, role: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId }
    });
    
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_employeeId: { projectId, employeeId } }
    });

    if (existing) {
      return existing; // Already a member
    }

    return this.prisma.projectMember.create({
      data: {
        projectId,
        employeeId,
        role
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } } }
      }
    });
  }

  async removeProjectMember(companyId: number, projectId: number, employeeId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId },
      include: { members: true }
    });
    
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_employeeId: { projectId, employeeId } }
    });

    if (!existing) {
      return { success: true };
    }

    // Handle Owner Removal Logic
    if (project.leadId === employeeId) {
      const otherMembers = project.members.filter(m => m.employeeId !== employeeId);
      
      if (otherMembers.length > 0) {
        // Try to find an Admin to transfer ownership, else just pick the first member
        const newLead = otherMembers.find(m => m.role === 'ADMIN') || otherMembers[0];
        
        await this.prisma.project.update({
          where: { id: projectId },
          data: { leadId: newLead.employeeId }
        });
        
        // Also ensure the new lead is upgraded to ADMIN role if they aren't already
        if (newLead.role !== 'ADMIN') {
          await this.prisma.projectMember.update({
            where: { id: newLead.id },
            data: { role: 'ADMIN' }
          });
        }
      } else {
        // No other members left, clear the leadId
        await this.prisma.project.update({
          where: { id: projectId },
          data: { leadId: null }
        });
      }
    }

    await this.prisma.projectMember.delete({
      where: { id: existing.id }
    });

    return { success: true };
  }

  async updateProject(companyId: number, id: number, data: any) {
    const project = await this.prisma.project.findUnique({
      where: { id, companyId }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.color !== undefined) updateData.color = data.color;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    if (data.billingType !== undefined) updateData.billingType = data.billingType;
    if (data.budgetAmount !== undefined) updateData.budgetAmount = data.budgetAmount ? parseFloat(data.budgetAmount) : null;
    if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate ? parseFloat(data.hourlyRate) : null;
    if (data.clientId !== undefined) updateData.clientId = data.clientId ? parseInt(data.clientId, 10) : null;

    return this.prisma.project.update({
      where: { id },
      data: updateData
    });
  }

  async archiveProject(companyId: number, projectId: number, force: boolean) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');

    if (!force) {
      const activeTasksCount = await this.prisma.issue.count({
        where: {
          projectId,
          companyId,
          isArchived: false,
          status: { notIn: ['DONE', 'CANCELLED'] }
        }
      });
      if (activeTasksCount > 0) {
        throw new ConflictException({
          message: `There are ${activeTasksCount} active tasks remaining in this board.`,
          activeTasksCount
        });
      }
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'ARCHIVED' }
    });
  }

  async unarchiveProject(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId }
    });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'ACTIVE' }
    });
  }

  async getMyTimesheets(companyId: number, employeeUserId: number, startDateStr: string, endDateStr: string) {
    const employee = await this.prisma.employee.findUnique({ where: { userId: employeeUserId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    endDate.setHours(23, 59, 59, 999);

    const timeLogs = await this.prisma.issueTimeLog.findMany({
      where: {
        employeeId: employee.id,
        startedAt: {
          gte: startDate,
          lte: endDate
        },
        issue: {
          companyId
        }
      },
      include: {
        issue: {
          include: {
            project: true
          }
        }
      },
      orderBy: {
        startedAt: 'desc'
      }
    });

    return timeLogs.map(log => ({
      id: log.id,
      issueId: log.issueId,
      issueKey: log.issue.key,
      issueTitle: log.issue.title,
      projectId: log.issue.projectId,
      projectName: log.issue.project.name,
      projectColor: log.issue.project.color,
      startedAt: log.startedAt,
      endedAt: log.endedAt,
      durationMin: log.durationMin
    }));
  }
}
