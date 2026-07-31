import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicJob {
  id: number;
  title: string;
  department: string;
  location: string;
  address?: string;
  experienceYears?: string;
  type: string;
  postedDate: string;
  descriptionHtml: string;
  screeningQuestions: string[];
  companyId?: string;
}

export class CandidateApplicationDto {
  jobId!: number;
  fullName!: string;
  email!: string;
  phone!: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  experienceYears?: string;
  noticePeriod?: string;
  resumeUrl?: string;
  answers?: { question: string; answer: string }[];
}

@Injectable()
export class PublicJobsService {
  constructor(private prisma: PrismaService) {}

  async getOpenJobs() {
    const jobs = await this.prisma.job.findMany({
      where: { status: 'Open' },
      include: {
        department: true,
        designation: true,
        branch: true
      }
    });
    return jobs.map(j => this.mapToPublicJob(j));
  }

  async getJobById(id: number) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        department: true,
        designation: true,
        branch: true
      }
    });
    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }
    return this.mapToPublicJob(job);
  }

  async getJobsByCompanyId(companyId: string) {
    const parsedId = parseInt(companyId, 10);
    if (isNaN(parsedId)) {
      return [];
    }
    const jobs = await this.prisma.job.findMany({
      where: { companyId: parsedId, status: 'Open' },
      include: {
        department: true,
        designation: true,
        branch: true
      }
    });
    return jobs.map(j => this.mapToPublicJob(j));
  }

  async submitApplication(dto: CandidateApplicationDto) {
    const job = await this.prisma.job.findUnique({ where: { id: dto.jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const application = await this.prisma.jobApplication.create({
      data: {
        jobId: job.id,
        companyId: job.companyId,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        resumeUrl: dto.resumeUrl,
        linkedinUrl: dto.linkedinUrl,
        portfolioUrl: dto.portfolioUrl,
        experienceYears: dto.experienceYears,
        noticePeriod: dto.noticePeriod,
        answers: dto.answers ? JSON.stringify(dto.answers) : null,
      }
    });

    return {
      success: true,
      message: 'Application submitted successfully! Our HR team will review your application shortly.',
      applicationId: application.id
    };
  }

  async getApplications() {
    return this.prisma.jobApplication.findMany();
  }

  private mapToPublicJob(j: any): PublicJob {
    let questions: string[] = [];
    if (j.screeningQuestions) {
      try {
        questions = JSON.parse(j.screeningQuestions);
      } catch (e) {
        questions = [j.screeningQuestions];
      }
    }
    return {
      id: j.id,
      title: j.title,
      department: j.department?.name || 'General',
      location: j.branch?.name || 'Remote',
      address: j.branch?.address || '',
      experienceYears: j.experienceYears || '0-1 Years',
      type: j.type,
      postedDate: j.postedDate ? j.postedDate.toISOString() : j.createdAt.toISOString(),
      descriptionHtml: j.descriptionHtml || '',
      screeningQuestions: questions,
      companyId: String(j.companyId)
    };
  }
}
