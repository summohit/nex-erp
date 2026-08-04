import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async createProject(companyId: number, leadId: number, data: { name: string, description?: string, color?: string, icon?: string }) {
    // Generate base key from name
    const words = data.name.split(' ').filter(w => w.length > 0);
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
                { name: 'To Do', color: '#6b7280', position: 0 },
                { name: 'In Progress', color: '#3b82f6', position: 1 },
                { name: 'In Review', color: '#8b5cf6', position: 2 },
                { name: 'Done', color: '#22c55e', position: 3 },
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
    const whereClause: any = { companyId };
    
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
      recentActivity
    ] = await Promise.all([
      this.prisma.issue.count({
        where: { projectId, companyId, status: 'DONE', updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, updatedAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, createdAt: { gte: sevenDaysAgo } }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, dueDate: { gte: new Date(), lte: sevenDaysFromNow }, status: { not: 'DONE' } }
      }),
      this.prisma.issue.groupBy({
        by: ['status'],
        where: { projectId, companyId },
        _count: { _all: true }
      }),
      this.prisma.issueMember.groupBy({
        by: ['employeeId'],
        where: { issue: { projectId, companyId } },
        _count: { _all: true }
      }),
      this.prisma.issue.count({
        where: { projectId, companyId, members: { none: {} } }
      }),
      this.prisma.issue.groupBy({
        by: ['priority'],
        where: { projectId, companyId },
        _count: { _all: true }
      }),
      this.prisma.issueActivity.findMany({
        where: { issue: { projectId, companyId } },
        include: {
          actor: { select: { firstName: true, lastName: true, avatarUrl: true } },
          issue: { select: { id: true, key: true, title: true, status: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
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
      recentActivity
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

    return this.prisma.project.update({
      where: { id },
      data: { color: data.color }
    });
  }
}
