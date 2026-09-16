import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { applyFinancialVisibilityAll } from './project-visibility';
import { buildInitialMembers } from './project-members';
import { renameKeepingExtension, InvalidDocumentName } from './document-naming';
import { CrmService } from '../crm/crm.service';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
const pdfParse = require('pdf-parse');
import * as mammoth from 'mammoth';
import * as xlsx from 'xlsx';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private crm: CrmService,
  ) {}

  /**
   * The Client id a project should be saved against (§4).
   *
   * The form picks a LEAD CONTACT, not a client — that is who the business
   * actually knows at the point a project is created. Project.clientId still
   * points at Client, so every client filter, column and future invoice is
   * unaffected; this is the step that turns the chosen contact into that row,
   * reusing an existing client of the same name rather than duplicating it.
   *
   * `clientId` is still honoured when sent directly, so anything already
   * passing a client (imports, the AI onboarding flow) keeps working.
   */
  private async resolveClientId(companyId: number, data: any): Promise<number | null | undefined> {
    if (data.leadContactId) {
      const client = await this.crm.findOrCreateClientFromLeadContact(
        companyId,
        parseInt(data.leadContactId, 10),
      );
      return client.id;
    }
    // Explicitly cleared, versus simply not mentioned in the payload.
    if (data.leadContactId === null && data.clientId === undefined) return null;
    if (data.clientId !== undefined) return data.clientId ? parseInt(data.clientId, 10) : null;
    return undefined;
  }

  /**
   * Fields a NEW project cannot be created without.
   *
   * Enforced on create only, deliberately. When this rule was introduced 82 of
   * 83 existing projects had no department — it had been added a phase earlier
   * and never backfilled — so applying it to updates would have made almost
   * every project in the system unsaveable until somebody guessed a department
   * for it. New projects start complete; old ones are fixed deliberately
   * rather than by being held hostage to an unrelated edit.
   *
   * Server-side because the form is not the only caller, and a required field
   * that only the UI knows about is a suggestion rather than a rule.
   */
  private assertRequiredForCreate(data: any) {
    const missing: string[] = [];

    if (!data.name?.trim()) missing.push('Board title');
    if (!data.startDate) missing.push('Start date');
    if (!data.endDate) missing.push('Deadline');
    if (!data.departmentId) missing.push('Department');
    if (!data.category?.trim()) missing.push('Category');
    if (!Array.isArray(data.pmIds) || data.pmIds.length === 0) {
      missing.push('At least one project manager');
    }
    if (!Array.isArray(data.memberIds) || data.memberIds.length === 0) {
      missing.push('At least one assigned user');
    }

    if (missing.length) {
      throw new BadRequestException(`${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
    }

    // A deadline before the start is not a missing field but it is not a
    // project either, and the two are worth reporting separately.
    if (new Date(data.endDate) < new Date(data.startDate)) {
      throw new BadRequestException('Deadline must be on or after the start date');
    }
  }

  async createProject(companyId: number, leadId: number, data: any) {
    this.assertRequiredForCreate(data);

    // Ensure unique project name per company (case-insensitive)
    const existingProject = await this.prisma.project.findFirst({
      where: { companyId, name: { equals: data.name.trim(), mode: 'insensitive' } }
    });
    if (existingProject) {
      throw new BadRequestException(`Project with name "${data.name}" already exists`);
    }

    // Generate new project code format: CES/MMYY/SEQ (e.g., CES/0626/01)
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const baseKey = `CES/${mm}${yy}/`;

    // Find the highest sequence number for this month
    const existingProjects = await this.prisma.project.findMany({
      where: {
        companyId,
        key: { startsWith: baseKey }
      },
      select: { key: true }
    });

    let maxSeq = 0;
    for (const proj of existingProjects) {
      const parts = proj.key.split('/');
      if (parts.length === 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }

    const nextSeq = String(maxSeq + 1).padStart(2, '0');
    const finalKey = `${baseKey}${nextSeq}`;

    // The form sends a lead contact; this is the Client it resolves to.
    const resolvedClientId = await this.resolveClientId(companyId, data);

    // Create project, member, and default board
    const project = await this.prisma.project.create({
      data: {
        name: data.name,
        key: finalKey,
        description: data.description,
        color: data.color || '#2563eb',
        icon: data.icon || 'folder',
        address: data.address ?? null,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        billingType: data.billingType || 'NON_BILLABLE',
        budgetAmount: data.budgetAmount ? parseFloat(data.budgetAmount) : null,
        hourlyRate: data.hourlyRate ? parseFloat(data.hourlyRate) : null,
        clientId: resolvedClientId ?? null,
        // What was actually chosen, so an edit can show it again.
        leadContactId: data.leadContactId ? parseInt(data.leadContactId, 10) : null,
        // Delivery module fields (§4, §7, §9). A project created without a
        // status is ACTIVE rather than DRAFT: somebody filling in this form is
        // starting work, and DRAFT would hide it behind the default filter.
        category: data.category || null,
        priority: data.priority || 'MEDIUM',
        departmentId: data.departmentId ? parseInt(data.departmentId, 10) : null,
        workStatus: data.workStatus || 'ACTIVE',
        currency: data.currency || 'INR',
        budgetNotes: data.budgetNotes || null,
        estimatedHours: data.estimatedHours ? parseFloat(data.estimatedHours) : null,
        allowManualTimeLogging: data.allowManualTimeLogging === undefined ? true : !!data.allowManualTimeLogging,
        companyId,
        leadId,
        members: {
          // One row per person, highest role wins. The owner is ADMIN, the
          // chosen managers are PROJECT_MANAGER, and everyone else assigned to
          // the project is MEMBER — de-duplicated, because ProjectMember is
          // unique on (projectId, employeeId) and somebody picked as both a
          // manager and a user would otherwise fail the insert.
          create: buildInitialMembers(leadId, data.pmIds, data.memberIds)
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
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const baseKey = `CES/${mm}${yy}/`;

    const existingProjects = await this.prisma.project.findMany({
      where: {
        companyId,
        key: { startsWith: baseKey }
      },
      select: { key: true }
    });

    let maxSeq = 0;
    for (const proj of existingProjects) {
      const parts = proj.key.split('/');
      if (parts.length === 3) {
        const seqNum = parseInt(parts[2], 10);
        if (!isNaN(seqNum) && seqNum > maxSeq) {
          maxSeq = seqNum;
        }
      }
    }

    const nextSeq = String(maxSeq + 1).padStart(2, '0');
    const finalKey = `${baseKey}${nextSeq}`;

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
          address: data.address ?? null,
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

  /**
   * Project-level documents (§6): the scope, the proposal, the agreement.
   *
   * Distinct from task attachments, which the Attachments tab was showing on
   * its own — those belong to a work item, these belong to the project.
   */
  async listProjectDocuments(companyId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.projectDocument.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, url: true, type: true, status: true,
        createdAt: true, updatedAt: true,
        employee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
      },
    });
  }

  /**
   * Rename a document, keeping whatever extension it was uploaded with.
   *
   * The bytes are not re-uploaded, so the extension must not move: it is what
   * decides whether a browser previews or downloads the file, and which parser
   * reads it. See document-naming.ts.
   */
  async renameProjectDocument(companyId: number, projectId: number, documentId: number, requestedName: string) {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, projectId, project: { companyId } },
      select: { id: true, name: true },
    });
    if (!doc) throw new NotFoundException('Document not found');

    let name: string;
    try {
      name = renameKeepingExtension(doc.name, requestedName);
    } catch (e) {
      if (e instanceof InvalidDocumentName) throw new BadRequestException(e.message);
      throw e;
    }

    return this.prisma.projectDocument.update({
      where: { id: documentId },
      data: { name },
      select: { id: true, name: true, url: true, type: true, updatedAt: true },
    });
  }

  async deleteProjectDocument(companyId: number, projectId: number, documentId: number) {
    const doc = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, projectId, project: { companyId } },
      select: { id: true },
    });
    if (!doc) throw new NotFoundException('Document not found');

    await this.prisma.projectDocument.delete({ where: { id: documentId } });
    return { success: true };
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
    // isSystem excludes the hidden "General" project, which exists only to give
    // projectless tasks a key, a board column and a detail screen. It is not a
    // project anybody works on and must never appear in a board list.
    const whereClause: any = { companyId, status: 'ACTIVE', isSystem: false };
    
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
          select: { members: true, issues: true, milestones: true }
        },
        lead: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        },
        // Client and department are columns and filters on the list, so they
        // come down with it rather than costing a lookup per row.
        client: {
          select: { id: true, name: true }
        },
        leadContact: {
          select: { id: true, name: true, companyName: true }
        },
        department: {
          select: { id: true, name: true }
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
          where: { status: { in: ['APPROVED', 'PAID'] } },
          select: { amount: true, status: true }
        }
      }
    });

    const costByProject = await this.getCostRollupByProject(projects.map((p) => p.id));

    const rows = projects.map(({ issues, expenseClaims, ...p }) => {
      const totalIssues = issues.length;
      const doneIssues = issues.filter((i) => i.status === 'DONE').length;
      const cost = costByProject.get(p.id) ?? { loggedHours: 0, employeeCost: 0, unratedHours: 0 };
      const expenseTotal = expenseClaims.reduce((sum, c) => sum + c.amount, 0);
      // §23: what the project has actually consumed — the people on it plus
      // the expenses approved against it. Approved, not merely claimed: an
      // unreviewed claim is not yet a cost.
      const actualCost = Math.round((cost.employeeCost + expenseTotal) * 100) / 100;

      return {
        ...p,
        remainingIssues: issues.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED').length,
        totalIssues,
        doneIssues,
        // §11: progress from task completion, unless a PM has set it by hand.
        progress: p.progress ?? (totalIssues ? Math.round((doneIssues / totalIssues) * 100) : 0),
        loggedHours: cost.loggedHours,
        remainingHours: p.estimatedHours == null ? null : p.estimatedHours - cost.loggedHours,
        expenseTotal,
        paidExpenseTotal: expenseClaims
          .filter((c) => c.status === 'PAID')
          .reduce((sum, c) => sum + c.amount, 0),
        employeeCost: cost.employeeCost,
        /// Hours the cost figure could not price, because the person who
        /// logged them has no rate. Non-zero means employeeCost is an
        /// understatement, and the UI says so rather than letting the number
        /// pass as complete.
        unratedHours: cost.unratedHours,
        actualCost,
        budgetUsed: actualCost,
        budgetRemaining: p.budgetAmount == null ? null : Math.round((p.budgetAmount - actualCost) * 100) / 100,
        budgetUtilization:
          p.budgetAmount ? Math.round((actualCost / p.budgetAmount) * 100) : null,
        milestoneTotal: p._count?.milestones ?? 0,
      };
    });

    return applyFinancialVisibilityAll(rows, { role, employeeId: emp ? emp.id : null });
  }

  /**
   * Logged hours and employee cost per project (§8, §23).
   *
   * One grouped query rather than including `timeLogs` on every issue: a
   * project with a thousand tasks and years of timer sessions would otherwise
   * pull every row across the wire to add them up.
   *
   * `unratedHours` is the part of the total logged by people with no
   * hourlyCostRate. It is carried alongside the cost rather than folded into
   * it, because those hours are real work that cost is silently missing — a
   * project reporting itself cheaper than it is would be worse than one
   * saying which hours it could not price.
   */
  private async getCostRollupByProject(projectIds: number[]): Promise<
    Map<number, { loggedHours: number; employeeCost: number; unratedHours: number }>
  > {
    if (!projectIds.length) return new Map();

    const rows = await this.prisma.$queryRaw<
      { projectId: number; minutes: bigint | null; cost: number | null; unratedMinutes: bigint | null }[]
    >`
      SELECT i."projectId"                        AS "projectId",
             SUM(COALESCE(t."durationMin", 0))    AS minutes,
             SUM(COALESCE(t."durationMin", 0) / 60.0
                 * COALESCE(e."hourlyCostRate", 0)) AS cost,
             SUM(CASE WHEN e."hourlyCostRate" IS NULL
                      THEN COALESCE(t."durationMin", 0) ELSE 0 END) AS "unratedMinutes"
        FROM "IssueTimeLog" t
        JOIN "Issue" i    ON i.id = t."issueId"
        JOIN "Employee" e ON e.id = t."employeeId"
       WHERE i."projectId" IN (${Prisma.join(projectIds)})
       GROUP BY i."projectId"
    `;

    const toHours = (min: bigint | null) => Math.round((Number(min ?? 0) / 60) * 100) / 100;

    return new Map(
      rows.map((r) => [
        r.projectId,
        {
          loggedHours: toHours(r.minutes),
          employeeCost: Math.round(Number(r.cost ?? 0) * 100) / 100,
          unratedHours: toHours(r.unratedMinutes),
        },
      ]),
    );
  }

  async getArchivedProjects(companyId: number, userId: number, role: string) {
    const isAdmin = role === 'SUPERADMIN' || role === 'ADMIN';
    const whereClause: any = { companyId, status: 'ARCHIVED', isSystem: false };
    
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
    if (data.address !== undefined) updateData.address = data.address ?? null;
    if (data.color !== undefined) updateData.color = data.color;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    if (data.billingType !== undefined) updateData.billingType = data.billingType;
    if (data.budgetAmount !== undefined) updateData.budgetAmount = data.budgetAmount ? parseFloat(data.budgetAmount) : null;
    if (data.hourlyRate !== undefined) updateData.hourlyRate = data.hourlyRate ? parseFloat(data.hourlyRate) : null;
    // Resolves a chosen lead contact to its Client, or takes clientId directly.
    // Left alone entirely when the payload mentions neither.
    const resolvedClientId = await this.resolveClientId(companyId, data);
    if (resolvedClientId !== undefined) updateData.clientId = resolvedClientId;
    if (data.leadContactId !== undefined) {
      updateData.leadContactId = data.leadContactId ? parseInt(data.leadContactId, 10) : null;
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.workStatus !== undefined) updateData.workStatus = data.workStatus;
    // Delivery module fields (§4, §7, §9, §37).
    if (data.category !== undefined) updateData.category = data.category || null;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.departmentId !== undefined) updateData.departmentId = data.departmentId ? parseInt(data.departmentId, 10) : null;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.budgetNotes !== undefined) updateData.budgetNotes = data.budgetNotes || null;
    if (data.estimatedHours !== undefined) updateData.estimatedHours = data.estimatedHours ? parseFloat(data.estimatedHours) : null;
    if (data.allowManualTimeLogging !== undefined) updateData.allowManualTimeLogging = !!data.allowManualTimeLogging;
    if (data.closureStatus !== undefined) updateData.closureStatus = data.closureStatus;
    if (data.progress !== undefined) {
      // Null clears a hand-set percentage and hands progress back to the
      // task-completion calculation in getProjects — without this there is no
      // way to undo a manual override.
      updateData.progress = data.progress === null || data.progress === '' ? null : parseInt(data.progress, 10);
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: updateData
    });

    if (data.pmIds !== undefined) {
      await this.syncProjectManagers(id, data.pmIds || []);
    }
    if (data.memberIds !== undefined) {
      await this.syncProjectMembers(id, data.memberIds || []);
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

  /**
   * Reconcile the plain members of a project with the chosen list.
   *
   * Only ever touches MEMBER rows. The owner (ADMIN) and the project managers
   * are governed by their own fields, and a manager who also appears in the
   * assigned-users list keeps the higher role rather than being demoted by
   * this running second — which is what a blanket "set everyone in this list
   * to MEMBER" would do.
   */
  private async syncProjectMembers(projectId: number, memberIds: number[]) {
    const existing = await this.prisma.projectMember.findMany({ where: { projectId } });

    const privileged = new Set(
      existing.filter(m => m.role === 'ADMIN' || m.role === 'PROJECT_MANAGER').map(m => m.employeeId),
    );
    const wanted = memberIds.filter(id => !privileged.has(id));

    const currentMemberIds = existing.filter(m => m.role === 'MEMBER').map(m => m.employeeId);
    const toRemove = currentMemberIds.filter(id => !wanted.includes(id));
    const toAdd = wanted.filter(id => !existing.some(m => m.employeeId === id));

    await this.prisma.$transaction([
      ...(toRemove.length
        ? [this.prisma.projectMember.deleteMany({
            where: { projectId, employeeId: { in: toRemove }, role: 'MEMBER' }
          })]
        : []),
      ...(toAdd.length
        ? [this.prisma.projectMember.createMany({
            data: toAdd.map(employeeId => ({ projectId, employeeId, role: 'MEMBER' }))
          })]
        : [])
    ]);
  }

  async archiveProject(companyId: number, projectId: number, force: boolean) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');
    // The General project is where projectless tasks live. Archiving it would
    // strand every one of them.
    if (project.isSystem) throw new BadRequestException('The General project cannot be archived.');

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

  /**
   * Project-wide activity feed: every issue activity in the project, newest
   * first. The rows were already being written on every status change, comment
   * and timer action — nothing surfaced them until now.
   */
  async getProjectActivity(companyId: number, projectId: number, limit = 50) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) throw new NotFoundException('Project not found');

    const activities = await this.prisma.issueActivity.findMany({
      where: { issue: { projectId, companyId } },
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        issue: { select: { id: true, title: true, key: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(limit) || 50, 1), 200),
    });

    return activities;
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
