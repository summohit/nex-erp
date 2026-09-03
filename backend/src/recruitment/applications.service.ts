import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollSettingsService } from '../payroll/payroll-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private payrollSettingsService: PayrollSettingsService,
    private notificationsService: NotificationsService,
  ) {}

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
  ) {
    const application = await this.findOne(id, companyId);

    let approvalStatus = application.approvalStatus;
    let finalStatus = status;

    if (offeredSalary !== undefined && (status === 'HIRED' || status === 'OFFERED')) {
      if (application.job?.maxSalary && offeredSalary > application.job.maxSalary) {
        approvalStatus = 'PENDING_APPROVAL';
        finalStatus = 'OFFERED'; // Enforce OFFERED if pending approval
      } else {
        approvalStatus = 'APPROVED';
      }
    }

    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: {
        status: finalStatus,
        ...(offeredSalary !== undefined && { offeredSalary }),
        ...(status === 'REJECTED' && { rejectionReason: rejectionReason || null }),
        ...(joiningDate !== undefined && {
          joiningDate: joiningDate ? new Date(joiningDate) : null,
        }),
        ...(address !== undefined && { address: address || null }),
        approvalStatus
      },
    });
  }

  async approveSalary(id: number, companyId: number) {
    const application = await this.findOne(id, companyId);
    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: { approvalStatus: 'APPROVED' },
    });
  }

  async rejectSalary(id: number, companyId: number) {
    const application = await this.findOne(id, companyId);
    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: { approvalStatus: 'REJECTED' },
    });
  }

  async remove(id: number, companyId: number) {
    const application = await this.findOne(id, companyId);
    return this.prisma.jobApplication.delete({
      where: { id: application.id },
    });
  }

  async onboardCandidate(id: number, companyId: number) {
    const application = await this.findOne(id, companyId);
    
    if (application.status !== 'HIRED') {
      throw new BadRequestException('Only HIRED candidates can be onboarded');
    }

    if (application.approvalStatus === 'PENDING_APPROVAL') {
      throw new BadRequestException('Cannot onboard candidate with pending salary approval');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: application.email }
    });
    if (existingUser) {
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
        data: { status: 'ONBOARDED' }
      });

      return employee;
    });

    return newEmployee;
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
          include: {
            job: { select: { title: true } }
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
