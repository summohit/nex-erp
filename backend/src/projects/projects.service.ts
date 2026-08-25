import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
const pdfParse = require('pdf-parse');
import * as mammoth from 'mammoth';
import * as xlsx from 'xlsx';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async createProject(companyId: number, leadId: number, data: any) {
    // Ensure unique project name per company (case-insensitive)
    const existingProject = await this.prisma.project.findFirst({
      where: { companyId, name: { equals: data.name.trim(), mode: 'insensitive' } }
    });
    if (existingProject) {
      throw new BadRequestException(`Project with name "${data.name}" already exists`);
    }

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
          create: [
            { employeeId: leadId, role: 'ADMIN' },
            ...(data.pmIds
              ? data.pmIds
                  .filter((id: number) => id !== leadId)
                  .map((id: number) => ({ employeeId: id, role: 'PROJECT_MANAGER' }))
              : [])
          ]
        },
        boards: {
          create: {
            name: 'Main Board',
            columns: {
              create: [
                { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
                { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
                { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
                { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
                { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' }
              ]
            }
          }
        }
      }
    });

    return project;
  }

  async createAiProject(companyId: number, leadId: number, data: any) {
    const words = data.name.split(' ').filter((w: string) => w.length > 0);
    let baseKey = '';
    if (words.length >= 2) {
      baseKey = (words[0].substring(0, 2) + words[1][0]).toUpperCase();
    } else {
      baseKey = data.name.substring(0, 3).toUpperCase();
    }
    
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

    try {
      // Create a client automatically using the project name
      const autoClient = await this.prisma.client.create({
        data: {
          name: data.name,
          companyId
        }
      });

      const newProject = await this.prisma.project.create({
        data: {
          name: data.name,
          key: finalKey,
          description: data.description,
          companyId,
          leadId,
          status: 'DRAFT',
          onboardingStatus: 'DRAFT',
          budgetAmount: data.budgetAmount ? parseFloat(data.budgetAmount) : null,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          clientId: autoClient.id,

          members: {
            create: [
              { employeeId: leadId, role: 'ADMIN' },
              ...(data.pmIds ? data.pmIds.map((id: number) => ({ employeeId: id, role: 'PROJECT_MANAGER' })) : [])
            ]
          },
          boards: {
            create: {
              name: 'Main Board',
              columns: {
                create: [
                  { name: 'To Do', color: '#6b7280', position: 0, isSystem: true, type: 'TODO' },
                  { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true, type: 'IN_PROGRESS' },
                  { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true, type: 'REVIEW' },
                  { name: 'Done', color: '#22c55e', position: 3, isSystem: true, type: 'DONE' },
                  { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true, type: 'DONE' }
                ]
              }
            }
          }
        }
      });

      return newProject;
    } catch (error) {
      console.error(error);
      throw new BadRequestException('Could not create AI project draft');
    }
  }

  async getProjectAnalysis(companyId: number, projectId: number) {
    const run = await this.prisma.projectAnalysisRun.findFirst({
      where: { projectId, project: { companyId } },
      orderBy: { version: 'desc' },
      include: {
        summary: true,
        scope: true,
        requirements: true,
        wbsTasks: true,
        resourcePlans: true,
        costEstimate: true,
        roadmap: true,
        milestones: true,
        risks: true,
        dependencies: true,
        assumptions: true,
        stakeholders: true,
        raci: true,
        openQuestions: true,
        missingInfo: true,
        recommendations: true,
        aiConfidence: true,
        health: true,
        kickoffReadiness: true,
      }
    });

    if (!run) {
      throw new NotFoundException('No analysis run found for this project');
    }
    return run;
  }

  async kickoffProject(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      include: { boards: { include: { columns: true } } }
    });
    if (!project) throw new NotFoundException('Project not found');

    const analysis = await this.getProjectAnalysis(companyId, projectId);
    if (!analysis || !analysis.wbsTasks) throw new BadRequestException('No WBS tasks to kickoff');

    const mainBoard = project.boards[0];
    if (!mainBoard) throw new BadRequestException('Project has no board setup');

    const todoColumn = mainBoard.columns.find(c => c.name.toLowerCase() === 'to do' || c.position === 0);
    if (!todoColumn) throw new BadRequestException('Board has no To Do column');

    // Make sure we don't duplicate if already kicked off
    if (project.onboardingStatus === 'COMPLETED') {
      return project;
    }

    let position = 0;
    const issues = analysis.wbsTasks.map((task, idx) => {
      return {
        title: task.task,
        description: task.description || '',
        projectId: project.id,
        columnId: todoColumn.id,
        type: 'TASK',
        status: 'TODO',
        key: `${project.key}-${idx + 1}`,
        position: position++,
        startDate: task.startDate ? new Date(task.startDate) : null,
        dueDate: task.endDate ? new Date(task.endDate) : null,
        estimatedHours: task.estimatedEffort || null,
        companyId
      };
    });

    if (issues.length > 0) {
      await this.prisma.issue.createMany({
        data: issues
      });
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        onboardingStatus: 'COMPLETED',
        status: 'ACTIVE'
      }
    });
  }

  async uploadProjectDocument(companyId: number, projectId: number, uploadedBy: number, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    // Verify project access
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId }
    });
    if (!project) throw new NotFoundException('Project not found');

    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) throw new HttpException('ImageKit not configured', HttpStatus.INTERNAL_SERVER_ERROR);

    try {
      // 1. Upload to ImageKit
      const ext = path.extname(file.originalname);
      const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
      
      const form = new FormData();
      form.append('file', file.buffer.toString('base64'));
      form.append('fileName', filename);
      form.append('folder', '/project_documents');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: { ...form.getHeaders(), Authorization: authHeader }
      });

      const url = response.data.url;
      const fileId = response.data.fileId;

      // 2. Extract Text (if PDF, DOCX, or XLSX)
      let rawText: string | null = null;
      let status = 'PENDING';
      const fileExt = ext.toLowerCase();

      try {
        if (fileExt === '.pdf') {
          if (typeof pdfParse === 'function') {
            const data = await pdfParse(file.buffer);
            rawText = data.text;
          } else if (pdfParse && pdfParse.PDFParse) {
            const parser = new pdfParse.PDFParse({ data: file.buffer });
            const res = await parser.getText();
            rawText = res.text;
            if (typeof parser.destroy === 'function') await parser.destroy();
          } else if ((pdfParse as any).default && typeof (pdfParse as any).default === 'function') {
            const data = await (pdfParse as any).default(file.buffer);
            rawText = data.text;
          }
          status = 'EXTRACTED';
        } else if (fileExt === '.docx') {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          rawText = result.value;
          status = 'EXTRACTED';
        } else if (fileExt === '.xlsx' || fileExt === '.xls') {
          const workbook = xlsx.read(file.buffer, { type: 'buffer' });
          const sheetsText = workbook.SheetNames.map(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            return `--- Sheet: ${sheetName} ---\n` + xlsx.utils.sheet_to_csv(worksheet);
          }).join('\n\n');
          rawText = sheetsText;
          status = 'EXTRACTED';
        } else if (['.txt', '.csv', '.md', '.json', '.log'].includes(fileExt)) {
          rawText = file.buffer.toString('utf-8');
          status = 'EXTRACTED';
        } else {
          // Fallback plain text read
          rawText = file.buffer.toString('utf-8');
          status = 'EXTRACTED';
        }
      } catch (e) {
        console.error(`Parse error for ${fileExt}:`, e);
        status = 'ERROR';
      }

      // 3. Save or Update in database (Handle re-upload of same file name)
      const existingDoc = await this.prisma.projectDocument.findFirst({
        where: { projectId, name: file.originalname }
      });

      let doc;
      if (existingDoc) {
        doc = await this.prisma.projectDocument.update({
          where: { id: existingDoc.id },
          data: {
            url,
            fileId,
            type: ext.toLowerCase().replace('.', ''),
            rawText,
            status,
            uploadedBy,
            updatedAt: new Date()
          }
        });
      } else {
        doc = await this.prisma.projectDocument.create({
          data: {
            projectId,
            name: file.originalname,
            url,
            fileId,
            type: ext.toLowerCase().replace('.', ''),
            rawText,
            status,
            uploadedBy
          }
        });
      }

      return doc;
    } catch (error) {
      console.error(error);
      throw new HttpException('Failed to process project document', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async analyzeProjectDocuments(companyId: number, projectId: number) {
    // Phase 2: AI Orchestration goes here
    // For now, return a success indicator
    return { status: 'ANALYZING', message: 'Analysis started in background' };
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

    const projects = await this.prisma.project.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { members: true, issues: true }
        },
        lead: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        members: {
          orderBy: { joinedAt: 'asc' },
          select: {
            employeeId: true,
            role: true,
            isStarred: true,
            employee: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            }
          }
        },
        issues: {
          select: { status: true }
        },
        expenseClaims: {
          where: { status: 'PAID' },
          select: { amount: true }
        }
      }
    });

    return projects.map(({ issues, expenseClaims, ...p }) => ({
      ...p,
      remainingIssues: issues.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED').length,
      paidExpenseTotal: expenseClaims.reduce((sum, c) => sum + c.amount, 0)
    }));
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
        lead: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true, user: { select: { email: true } } }
        },
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
        },
        documents: {
          include: {
            employee: { select: { firstName: true, lastName: true, avatarUrl: true } }
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

  async addProjectMember(companyId: number, projectId: number, employeeId: number, role: string, actorEmployeeId?: number, actorRole?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (actorEmployeeId !== undefined && !(actorRole === 'SUPERADMIN' || actorRole === 'ADMIN') && project.leadId !== actorEmployeeId) {
      throw new ForbiddenException('Only the project owner can add members');
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
    if (data.status !== undefined) updateData.status = data.status;
    if (data.workStatus !== undefined) updateData.workStatus = data.workStatus;

    const updated = await this.prisma.project.update({
      where: { id },
      data: updateData
    });

    if (data.pmIds !== undefined) {
      await this.syncProjectManagers(id, data.pmIds || []);
    }

    return updated;
  }

  private async syncProjectManagers(projectId: number, pmIds: number[]) {
    const members = await this.prisma.projectMember.findMany({ where: { projectId } });

    const currentPmIds = members.filter(m => m.role === 'PROJECT_MANAGER').map(m => m.employeeId);
    const toDowngrade = currentPmIds.filter(id => !pmIds.includes(id));
    const toPromote = pmIds.filter(id => {
      const existing = members.find(m => m.employeeId === id);
      return !existing || existing.role === 'MEMBER' || existing.role === 'VIEWER';
    });
    const toAdd = pmIds.filter(id => !members.some(m => m.employeeId === id));
    const toPromoteExisting = toPromote.filter(id => !toAdd.includes(id));

    await this.prisma.$transaction([
      ...(toDowngrade.length
        ? [this.prisma.projectMember.updateMany({
            where: { projectId, employeeId: { in: toDowngrade } },
            data: { role: 'MEMBER' }
          })]
        : []),
      ...(toPromoteExisting.length
        ? [this.prisma.projectMember.updateMany({
            where: { projectId, employeeId: { in: toPromoteExisting } },
            data: { role: 'PROJECT_MANAGER' }
          })]
        : []),
      ...(toAdd.length
        ? [this.prisma.projectMember.createMany({
            data: toAdd.map(employeeId => ({ projectId, employeeId, role: 'PROJECT_MANAGER' }))
          })]
        : [])
    ]);
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
