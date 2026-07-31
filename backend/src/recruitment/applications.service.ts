import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ApplicationsService {
  constructor(private prisma: PrismaService) {}

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

  async updateStatus(id: number, companyId: number, status: string) {
    const application = await this.findOne(id, companyId);
    return this.prisma.jobApplication.update({
      where: { id: application.id },
      data: { status },
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
    return this.prisma.interview.create({
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
}
