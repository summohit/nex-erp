import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollSettingsService } from '../payroll/payroll-settings.service';
import { LettersService } from '../letters/letters.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private payrollSettingsService: PayrollSettingsService,
    private notificationsService: NotificationsService,
    private lettersService: LettersService,
  ) {}

  /**
   * The stages that gate progression. NEGOTIATION, ON_HOLD and REJECTED are
   * deliberately absent: they are skippable, so nothing is ever withheld for
   * want of them, and reaching them is never itself blocked.
   */
  private static readonly GATED_STAGES = ['OFFERED', 'HIRED', 'ONBOARDED'];

  /** Every stage a candidate must have passed through before being OFFERED. */
  private static readonly MANDATORY_BEFORE_OFFER = ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW'];

  private static readonly STAGE_LABELS: Record<string, string> = {
    APPLIED: 'Applied',
    PHONE_SCREENING: 'Phone Screening',
    INTERVIEW: 'Interview',
    NEGOTIATION: 'Negotiation',
    OFFERED: 'Offered',
    HIRED: 'Hired',
    ONBOARDED: 'Onboarded',
    ON_HOLD: 'On Hold',
    REJECTED: 'Rejected',
  };

  /** Map any retired status onto a current stage. Mirrors the frontend. */
  private normaliseStage(status?: string | null): string {
    switch (status) {
      case 'NEW': return 'APPLIED';
      case 'REVIEWING':
      case 'SHORTLISTED': return 'PHONE_SCREENING';
      case 'INTERVIEWING': return 'INTERVIEW';
      default: return status || 'APPLIED';
    }
  }

  private stageLabel(key: string): string {
    return ApplicationsService.STAGE_LABELS[key] || key;
  }

  /**
   * Stages this candidate has been through: whatever was recorded, plus the
   * stage they are sitting in right now. Every application starts at APPLIED,
   * so that one is always credited.
   */
  private visitedStages(application: { status: string; completedStages?: string[] }): Set<string> {
    const visited = new Set<string>(['APPLIED']);
    for (const stage of application.completedStages || []) visited.add(this.normaliseStage(stage));
    visited.add(this.normaliseStage(application.status));
    return visited;
  }

  /**
   * The budget the offer is measured against: the candidate's own approved
   * budget, falling back to the job's ceiling.
   *
   * Plenty of jobs carry only one bound — a posted `minSalary` with no
   * `maxSalary` is common — and treating those as "no budget at all" silently
   * disabled the approval rule for them. Whichever bound exists is the ceiling.
   */
  private effectiveProfileBudget(application: any): number | null {
    const candidates = [
      application.profileBudget,
      application.job?.maxSalary,
      application.job?.minSalary,
    ];
    for (const value of candidates) {
      if (value !== null && value !== undefined) return Number(value);
    }
    return null;
  }

  /**
   * Refuse a move that skips a mandatory stage. NEGOTIATION, ON_HOLD and
   * REJECTED are never required, so they are absent from every check below.
   */
  private assertStageAllowed(application: any, target: string) {
    if (!ApplicationsService.GATED_STAGES.includes(target)) return;

    const visited = this.visitedStages(application);

    const missing = ApplicationsService.MANDATORY_BEFORE_OFFER.filter((s) => !visited.has(s));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Cannot move to ${this.stageLabel(target)} — this candidate has not been through ` +
        `${missing.map((s) => this.stageLabel(s)).join(', ')}. Every stage except ` +
        `Negotiation, On Hold and Rejected is mandatory.`,
      );
    }

    if ((target === 'HIRED' || target === 'ONBOARDED') && !visited.has('OFFERED')) {
      throw new BadRequestException(
        `Cannot move to ${this.stageLabel(target)} — the candidate must be Offered first.`,
      );
    }

    if (target === 'ONBOARDED' && !visited.has('HIRED')) {
      throw new BadRequestException('Cannot onboard — the candidate must be Hired first.');
    }
  }

  /**
   * An above-budget offer only really gates the hire if the unapproved state
   * blocks HIRED. Checked against the approval status the write is about to
   * leave behind, not the one it started with, so revising the salary down to
   * within budget clears a previous rejection in the same call.
   */
  private assertApprovalClear(stage: string, approvalStatus?: string | null) {
    if (stage !== 'HIRED' && stage !== 'ONBOARDED') return;

    if (approvalStatus === 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'This offer is above the profile budget and is still waiting for approval.',
      );
    }
    if (approvalStatus === 'REJECTED') {
      throw new BadRequestException(
        'The extra payment on this offer was rejected. Revise the offered salary before hiring.',
      );
    }
  }

  async findAll(companyId: number, jobId?: number) {
    const whereClause: any = { companyId };
    if (jobId) {
      whereClause.jobId = jobId;
    }

    return this.prisma.jobApplication.findMany({
      where: whereClause,
      include: {
        job: {
          select: {
            title: true,
            // The board's offer modal compares against these, so the list
            // payload has to carry them too — not just findOne's.
            minSalary: true,
            maxSalary: true,
            department: { select: { name: true } },
            designation: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number, companyId: number) {
    const application = await this.prisma.jobApplication.findFirst({
      where: { id, companyId },
      include: {
        job: {
          select: {
            title: true,
            departmentId: true,
            designationId: true,
            branchId: true,
            minSalary: true,
            maxSalary: true,
            department: { select: { name: true } },
            designation: { select: { name: true } },
            branch: { select: { name: true, address: true } }
          }
        }
      },
    });

    if (!application) {
      throw new NotFoundException(`Application #${id} not found`);
    }
    return application;
  }

  async updateStatus(
    id: number,
    companyId: number,
    status: string,
    offeredSalary?: number,
    rejectionReason?: string,
    // Captured alongside the salary when an offer is made — both are printed on
    // the generated offer letter ({{joiningDate}} / {{candidateAddress}}).
    joiningDate?: string | Date | null,
    address?: string | null,
    actorUserId?: number,
    // Why the company is paying above the candidate's profile budget. Required
    // whenever the offer exceeds it; ignored otherwise.
    approvalReason?: string | null,
  ) {
    const application = await this.findOne(id, companyId);

    const target = this.normaliseStage(status);
    this.assertStageAllowed(application, target);

    let approvalStatus = application.approvalStatus;
    let finalStatus = status;

    const budget = this.effectiveProfileBudget(application);
    const approvalFields: Record<string, any> = {};

    if (offeredSalary !== undefined && (target === 'HIRED' || target === 'OFFERED')) {
      if (budget !== null && offeredSalary > budget) {
        const reason = (approvalReason || '').trim();
        if (!reason) {
          throw new BadRequestException(
            `This offer is above the candidate's profile budget of ${budget}. ` +
            `Give a reason for the extra payment so it can be sent for approval.`,
          );
        }
        approvalStatus = 'PENDING_APPROVAL';
        // Hold the candidate where they are. Moving them to OFFERED here would
        // tell the board an offer had been made when the money behind it has
        // not been approved yet; approveSalary completes the move instead.
        finalStatus = application.status;
        approvalFields.approvalRequestedStage = target;
        approvalFields.approvalReason = reason;
        // Snapshot the budget in force now, so a later edit to profileBudget
        // never rewrites what the approver is being asked to sign off on.
        approvalFields.approvalBudget = budget;
        approvalFields.approvalRequestedAt = new Date();
        approvalFields.approvalDecidedAt = null;
        approvalFields.approvalDecidedById = null;
      } else {
        // A within-budget revision clears any earlier request outright, so a
        // previous rejection cannot keep blocking the hire.
        approvalStatus = 'APPROVED';
        approvalFields.approvalReason = null;
        approvalFields.approvalBudget = null;
        approvalFields.approvalRequestedStage = null;
        approvalFields.approvalRequestedAt = null;
        approvalFields.approvalDecidedAt = null;
        approvalFields.approvalDecidedById = null;
      }
    }

    this.assertApprovalClear(this.normaliseStage(finalStatus), approvalStatus);

    // Moving to ONBOARDED must actually create the employee, whichever route
    // the user took. Do it before writing the status so a failure surfaces
    // instead of leaving the application claiming an onboarding that never ran.
    let onboarding: { employeeId?: number; lettersIssued?: string[]; alreadyOnboarded?: boolean } | undefined;
    if (finalStatus === 'ONBOARDED' && application.status !== 'ONBOARDED') {
      const emp: any = await this.convertToEmployee(application, companyId, actorUserId);
      onboarding = {
        employeeId: emp?.id,
        lettersIssued: emp?.lettersIssued || [],
        alreadyOnboarded: !!emp?.alreadyOnboarded,
      };
    }

    const updated = await this.prisma.jobApplication.update({
      where: { id: application.id },
      data: {
        status: finalStatus,
        // Record the stage actually landed on, so a later move can tell what
        // this candidate has genuinely been through.
        completedStages: this.recordStage(application, finalStatus),
        ...(offeredSalary !== undefined && { offeredSalary }),
        ...(status === 'REJECTED' && { rejectionReason: rejectionReason || null }),
        ...(joiningDate !== undefined && {
          joiningDate: joiningDate ? new Date(joiningDate) : null,
        }),
        ...(address !== undefined && { address: address || null }),
        ...approvalFields,
        approvalStatus
      },
    });

    if (approvalStatus === 'PENDING_APPROVAL' && application.approvalStatus !== 'PENDING_APPROVAL') {
      await this.notifyBudgetApprovers(updated, companyId, budget, actorUserId);
    }

    return onboarding ? { ...updated, onboarding } : updated;
  }

  /**
   * The candidate's stage history with `stage` appended. Order is preserved and
   * duplicates dropped, so re-entering a stage does not bloat the column.
   */
  private recordStage(application: { status: string; completedStages?: string[] }, stage: string): string[] {
    const history = (application.completedStages || []).map((s) => this.normaliseStage(s));
    const current = this.normaliseStage(application.status);
    const next = this.normaliseStage(stage);
    return [...new Set(['APPLIED', ...history, current, next])];
  }

  /** Tell whoever can approve that an above-budget offer is waiting on them. */
  private async notifyBudgetApprovers(
    application: any,
    companyId: number,
    budget: number | null,
    actorUserId?: number,
  ) {
    try {
      await this.notificationsService.notifyApprovers({
        companyId,
        roles: ['SUPERADMIN', 'ADMIN', 'HR'],
        title: 'Offer above budget needs approval',
        message:
          `${application.fullName} has been offered ${application.offeredSalary}` +
          (budget !== null ? ` against a profile budget of ${budget}` : '') +
          `. Reason: ${application.approvalReason}`,
        type: 'ACTION_REQUIRED',
        linkUrl: '/recruitment/candidates',
        excludeUserId: actorUserId ?? null,
      });
    } catch (error) {
      // A failed notification must not roll back an offer that was saved.
      this.logger.error('Failed to notify budget approvers', error as any);
    }
  }

  /**
   * The candidate's own approved budget. Set on the profile rather than in the
   * offer modal on purpose — a recruiter raising the budget in the same breath
   * as the offer would make the approval gate meaningless.
   */
  async setProfileBudget(id: number, companyId: number, profileBudget: number | null) {
    const application = await this.findOne(id, companyId);
    if (profileBudget !== null && (!Number.isFinite(profileBudget) || profileBudget < 0)) {
      throw new BadRequestException('Profile budget must be a positive amount');
    }
    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: { profileBudget },
    });
  }

  /**
   * Approve the extra payment and finish the move the recruiter asked for. The
   * candidate has been sitting in their original stage all along, so approving
   * is what actually advances them.
   */
  async approveSalary(id: number, companyId: number, actorUserId?: number) {
    const application = await this.findOne(id, companyId);
    if (application.approvalStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException('There is no pending approval request on this offer');
    }

    const requested = application.approvalRequestedStage || 'OFFERED';
    // The pipeline rules still apply — approving the money never buys a way
    // past a stage the candidate has not been through.
    this.assertStageAllowed(application, this.normaliseStage(requested));

    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: {
        approvalStatus: 'APPROVED',
        status: requested,
        completedStages: this.recordStage(application, requested),
        approvalDecidedAt: new Date(),
        approvalDecidedById: actorUserId ?? null,
      },
    });
  }

  /** Every offer whose extra payment is still waiting on an approver. */
  async findPendingApprovals(companyId: number) {
    return this.prisma.jobApplication.findMany({
      where: { companyId, approvalStatus: 'PENDING_APPROVAL' },
      include: {
        job: {
          select: {
            title: true,
            minSalary: true,
            maxSalary: true,
            department: { select: { name: true } },
          },
        },
      },
      orderBy: { approvalRequestedAt: 'asc' },
    });
  }

  async rejectSalary(id: number, companyId: number, actorUserId?: number) {
    const application = await this.findOne(id, companyId);
    if (application.approvalStatus !== 'PENDING_APPROVAL') {
      throw new BadRequestException('There is no pending approval request on this offer');
    }
    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: {
        approvalStatus: 'REJECTED',
        approvalDecidedAt: new Date(),
        approvalDecidedById: actorUserId ?? null,
      },
    });
  }

  async remove(id: number, companyId: number) {
    const application = await this.findOne(id, companyId);
    return this.prisma.jobApplication.delete({
      where: { id: application.id },
    });
  }

  async onboardCandidate(id: number, companyId: number, actorUserId?: number) {
    const application = await this.findOne(id, companyId);

    if (application.status !== 'HIRED') {
      throw new BadRequestException('Only HIRED candidates can be onboarded');
    }

    this.assertStageAllowed(application, 'ONBOARDED');

    this.assertApprovalClear('ONBOARDED', application.approvalStatus);

    return this.convertToEmployee(application, companyId, actorUserId);
  }

  /**
   * Turn an application into a real User + Employee.
   *
   * Split out from onboardCandidate so that moving a candidate to ONBOARDED by
   * any route — the button, the status dropdown, a kanban drag — creates the
   * employee. Previously only the button did, so the other routes left the
   * application claiming ONBOARDED with no employee behind it.
   */
  private async convertToEmployee(application: any, companyId: number, actorUserId?: number) {
    if (!application.email) {
      throw new BadRequestException('This candidate has no email address, so no employee login can be created');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: application.email },
      include: { employee: { select: { id: true, companyId: true } } },
    });
    if (existingUser) {
      // Already converted: report it rather than failing the caller.
      if (existingUser.employee && existingUser.employee.companyId === companyId) {
        return { ...existingUser.employee, alreadyOnboarded: true, lettersIssued: [] as string[] };
      }
      throw new BadRequestException('A user with this email already exists');
    }

    const [firstName, ...lastNameParts] = application.fullName.split(' ');
    const lastName = lastNameParts.join(' ') || '';

    const hashedPassword = await bcrypt.hash('nexerp2026', 10);

    const newEmployee = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: application.email,
          password: hashedPassword,
          role: 'EMPLOYEE',
          companyId: companyId
        }
      });

      const employee = await tx.employee.create({
        data: {
          firstName,
          lastName,
          phone: application.phone,
          departmentId: application.job?.departmentId || null,
          designationId: application.job?.designationId || null,
          userId: user.id,
          companyId: companyId,
          branchId: application.job?.branchId || null,
          onboardingStatus: 'PENDING'
        }
      });

      if (application.resumeUrl) {
        await tx.employeeDocument.create({
          data: {
            employeeId: employee.id,
            fileName: 'Candidate Resume',
            fileUrl: application.resumeUrl
          }
        });
      }

      const defaultTasks = [
        { title: 'Complete your profile details', description: 'Fill out emergency contacts and address' },
        { title: 'Upload ID Proof', description: 'Upload government issued ID card' },
        { title: 'Read Company Handbook', description: 'Review the latest HR policies' }
      ];

      await tx.employeeOnboardingTask.createMany({
        data: defaultTasks.map(t => ({
          employeeId: employee.id,
          title: t.title,
          description: t.description
        }))
      });

      await tx.jobApplication.update({
        where: { id: application.id },
        data: {
          status: 'ONBOARDED',
          completedStages: this.recordStage(application, 'ONBOARDED'),
        }
      });

      return employee;
    });

    // Now that the employee exists, issue whatever letters are flagged to go out
    // at onboarding (Joining Letter, Welcome Letter, …). Kept outside the
    // transaction: a letter that fails to render must not undo the hire.
    let letters = { issued: 0, titles: [] as string[] };
    try {
      letters = await this.lettersService.generateOnboardingLetters(
        companyId, newEmployee.id, actorUserId);
    } catch {
      // Onboarding succeeded; letters can be generated manually instead.
    }

    return { ...newEmployee, lettersIssued: letters.titles };
  }

  async generateAnnexure(id: number, companyId: number) {
    const application = await this.findOne(id, companyId);
    if (!application.offeredSalary) {
      throw new BadRequestException('Cannot generate annexure. Salary is not finalized for this application.');
    }

    const ctc = application.offeredSalary;
    const settings = await this.payrollSettingsService.getSettings(companyId);

    const basic = Math.round(ctc * (settings.basicPercent / 100));
    const hra = Math.round(ctc * (settings.hraPercent / 100));
    const pf = Math.round(basic * (settings.pfPercent / 100));
    const gratuity = Math.round(basic * (settings.gratuityPercent / 100));
    const specialAllowance = Math.max(0, Math.round(ctc - (basic + hra + pf + gratuity)));

    const grossAnnual = basic + hra + specialAllowance;
    const netPayAnnual = Math.max(0, grossAnnual - pf);

    return {
      candidateName: application.fullName,
      jobTitle: application.job?.title || 'Position',
      totalCTC: ctc,
      monthlyCTC: Math.round(ctc / 12),
      breakdown: {
        earnings: {
          basic: { annual: basic, monthly: Math.round(basic / 12) },
          hra: { annual: hra, monthly: Math.round(hra / 12) },
          specialAllowance: { annual: specialAllowance, monthly: Math.round(specialAllowance / 12) },
          totalGross: { annual: grossAnnual, monthly: Math.round(grossAnnual / 12) }
        },
        deductions: {
          pf: { annual: pf, monthly: Math.round(pf / 12) },
          gratuity: { annual: gratuity, monthly: Math.round(gratuity / 12) }, // Employer contribution
          totalDeductions: { annual: pf + gratuity, monthly: Math.round((pf + gratuity) / 12) }
        },
        netPay: {
          annual: netPayAnnual, // Gratuity isn't typically deducted from monthly in-hand directly, but depends on company. We'll simplify to Gross - PF.
          monthly: Math.round(netPayAnnual / 12)
        }
      }
    };
  }

  // --- Interview Methods ---

  async getInterviews(applicationId: number, companyId: number) {
    const app = await this.findOne(applicationId, companyId);
    return this.prisma.interview.findMany({
      where: { applicationId: app.id },
      include: {
        interviewer: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      },
      orderBy: { scheduledAt: 'asc' }
    });
  }

  async getMyInterviews(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, userId }
    });

    if (!employee) return [];

    return this.prisma.interview.findMany({
      where: { interviewerId: employee.id, application: { companyId } },
      include: {
        application: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            resumeUrl: true,
            photoUrl: true,
            experienceYears: true,
            status: true,
            job: { select: { id: true, title: true, department: true } }
          }
        }
      },
      orderBy: { scheduledAt: 'asc' }
    });
  }

  async scheduleInterview(applicationId: number, companyId: number, data: any) {
    const app = await this.findOne(applicationId, companyId);
    const interview = await this.prisma.interview.create({
      data: {
        applicationId: app.id,
        title: data.title,
        scheduledAt: new Date(data.scheduledAt),
        durationMins: data.durationMins || 30,
        interviewerId: data.interviewerId || null,
        locationUrl: data.locationUrl || null,
        status: 'SCHEDULED'
      },
      include: {
        interviewer: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });

    // Being booked to interview someone is the clearest case of "you have been
    // given work" in the whole recruitment flow, and it was entirely silent.
    if (interview.interviewerId) {
      const when = interview.scheduledAt.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      });
      await this.notificationsService.notifyEmployees([interview.interviewerId], {
        companyId,
        title: 'Interview Scheduled',
        message: `You are interviewing ${app.fullName} for ${app.job?.title ?? 'a role'} on ${when}.`,
        type: 'ASSIGNMENT',
        linkUrl: '/recruitment/interviews',
      });
    }

    return interview;
  }

  async updateInterview(interviewId: number, companyId: number, data: any) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: { application: true }
    });
    if (!interview || interview.application.companyId !== companyId) {
      throw new NotFoundException('Interview not found');
    }

    const updateData: any = {};
    if (data.status) updateData.status = data.status;
    if (data.rating !== undefined) updateData.rating = data.rating;
    if (data.feedback !== undefined) updateData.feedback = data.feedback;
    if (data.title) updateData.title = data.title;
    if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt);
    if (data.durationMins) updateData.durationMins = data.durationMins;
    if (data.locationUrl !== undefined) updateData.locationUrl = data.locationUrl;

    return this.prisma.interview.update({
      where: { id: interviewId },
      data: updateData,
      include: {
        interviewer: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } }
      }
    });
  }

  async deleteInterview(interviewId: number, companyId: number) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: { application: true }
    });
    if (!interview || interview.application.companyId !== companyId) {
      throw new NotFoundException('Interview not found');
    }
    return this.prisma.interview.delete({
      where: { id: interviewId }
    });
  }

  // --- Analytics Methods ---

  async getAnalytics(companyId: number) {
    const applications = await this.prisma.jobApplication.findMany({
      where: { companyId },
      select: { status: true, aiScore: true }
    });

    const pipelineCounts = {
      NEW: 0, REVIEWING: 0, SHORTLISTED: 0, INTERVIEWING: 0, OFFERED: 0, HIRED: 0, REJECTED: 0
    };
    let totalScore = 0;
    let scoredCount = 0;

    for (const app of applications) {
      if (pipelineCounts[app.status] !== undefined) {
        pipelineCounts[app.status]++;
      }
      if (app.aiScore !== null && app.aiScore > 0) {
        totalScore += app.aiScore;
        scoredCount++;
      }
    }

    return {
      totalApplications: applications.length,
      pipeline: pipelineCounts,
      averageScore: scoredCount > 0 ? Math.round(totalScore / scoredCount) : 0,
    };
  }

  async getHiringReports(companyId: number) {
    const applications = await this.prisma.jobApplication.findMany({
      where: { companyId },
      select: {
        status: true,
        jobId: true,
        createdAt: true,
        updatedAt: true,
        job: {
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            totalOpenings: true,
            department: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
            recruiterId: true,
            recruiter: { 
              select: { 
                id: true,
                firstName: true, 
                lastName: true,
                avatarUrl: true,
                user: { select: { email: true } },
                designation: { select: { name: true } },
                department: { select: { name: true } }
              } 
            },
          },
        },
      },
    });

    const perJob: Record<string, { 
      jobId: number; 
      jobTitle: string; 
      department: string;
      branch: string;
      type: string;
      status: string;
      totalOpenings: number;
      total: number; 
      pipeline: Record<string, number> 
    }> = {};
    const perRecruiter: Record<string, { 
      recruiterId: number | null;
      recruiterName: string;
      avatarUrl: string | null;
      email: string | null;
      designation: string | null;
      department: string | null;
      total: number; 
      hired: number 
    }> = {};

    let totalTimeToHireDays = 0;
    let hiredCount = 0;

    for (const app of applications) {
      const jobKey = String(app.jobId);
      if (!perJob[jobKey]) {
        perJob[jobKey] = { 
          jobId: app.jobId, 
          jobTitle: app.job.title, 
          department: app.job.department?.name || 'General',
          branch: app.job.branch?.name || 'Main Office',
          type: app.job.type || 'Full Time',
          status: app.job.status || 'Open',
          totalOpenings: app.job.totalOpenings || 1,
          total: 0, 
          pipeline: {} 
        };
      }
      perJob[jobKey].total++;
      perJob[jobKey].pipeline[app.status] = (perJob[jobKey].pipeline[app.status] || 0) + 1;

      const recruiterKey = app.job.recruiterId ? String(app.job.recruiterId) : 'unassigned';
      const recruiterName = app.job.recruiter
        ? `${app.job.recruiter.firstName} ${app.job.recruiter.lastName}`
        : 'Unassigned';
      if (!perRecruiter[recruiterKey]) {
        perRecruiter[recruiterKey] = { 
          recruiterId: app.job.recruiter?.id || null,
          recruiterName, 
          avatarUrl: app.job.recruiter?.avatarUrl || null,
          email: app.job.recruiter?.user?.email || null,
          designation: app.job.recruiter?.designation?.name || null,
          department: app.job.recruiter?.department?.name || null,
          total: 0, 
          hired: 0 
        };
      }
      perRecruiter[recruiterKey].total++;

      if (app.status === 'HIRED' || app.status === 'ONBOARDED') {
        perRecruiter[recruiterKey].hired++;
        const days = (app.updatedAt.getTime() - app.createdAt.getTime()) / (1000 * 60 * 60 * 24);
        totalTimeToHireDays += days;
        hiredCount++;
      }
    }

    return {
      perJob: Object.values(perJob),
      perRecruiter: Object.values(perRecruiter),
      averageTimeToHireDays: hiredCount > 0 ? Math.round(totalTimeToHireDays / hiredCount) : null,
      timeToHireNote: 'Approximated from application creation to last status update — no status-change history is tracked, so this is a lower bound, not an exact figure.',
    };
  }
}
