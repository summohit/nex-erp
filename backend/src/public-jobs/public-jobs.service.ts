import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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
  startDate?: string;
  endDate?: string;
  descriptionHtml: string;
  screeningQuestions: string[];
  companyId?: string;
  minSalary?: number;
  maxSalary?: number;
  workLocationType?: string;
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
  skills?: string[];
  answers?: { question: string; answer: string }[];
  
  // New fields
  dateOfBirth?: string;
  gender?: string;
  currentLocation?: string;
  currentCtc?: number;
  expectedCtc?: number;
  source?: string;
  coverLetter?: string;
  photoUrl?: string;
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

  // Lets a returning candidate prefill the apply form from their most recent
  // application to this same company. Always returns 200 with `found: false`
  // when there's no match, rather than a 404, so the response shape can't be
  // used to enumerate which emails have applied before.
  async lookupPreviousApplication(email: string, companyId: number) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return { found: false };

    const previous = await this.prisma.jobApplication.findFirst({
      where: { email: { equals: normalized, mode: 'insensitive' }, companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        fullName: true,
        phone: true,
        linkedinUrl: true,
        portfolioUrl: true,
        experienceYears: true,
        resumeUrl: true,
        skills: true,
        dateOfBirth: true,
        gender: true,
        currentLocation: true,
        currentCtc: true,
        expectedCtc: true,
        source: true,
      },
    });

    if (!previous) return { found: false };
    return { found: true, data: previous };
  }

  async submitApplication(dto: CandidateApplicationDto) {
    const job = await this.prisma.job.findUnique({ where: { id: dto.jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const email = (dto.email || '').trim().toLowerCase();

    // A candidate may re-apply to the same job once their earlier application was
    // rejected — only an active (non-rejected) application blocks a duplicate.
    const existing = await this.prisma.jobApplication.findFirst({
      where: {
        jobId: job.id,
        email: { equals: email, mode: 'insensitive' },
        status: { not: 'REJECTED' },
      }
    });
    if (existing) {
      throw new ConflictException('You have already applied for this position with this email.');
    }

    const application = await this.prisma.jobApplication.create({
      data: {
        jobId: job.id,
        companyId: job.companyId,
        fullName: dto.fullName,
        email: email,
        phone: dto.phone,
        resumeUrl: dto.resumeUrl,
        linkedinUrl: dto.linkedinUrl,
        portfolioUrl: dto.portfolioUrl,
        experienceYears: dto.experienceYears,
        noticePeriod: dto.noticePeriod,
        skills: Array.isArray(dto.skills) ? dto.skills : [],
        answers: dto.answers ? JSON.stringify(dto.answers) : null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        gender: dto.gender,
        currentLocation: dto.currentLocation,
        currentCtc: dto.currentCtc,
        expectedCtc: dto.expectedCtc,
        source: dto.source,
        coverLetter: dto.coverLetter,
        photoUrl: dto.photoUrl,
      }
    });

    return {
      success: true,
      message: 'Application submitted successfully! Our HR team will review your application shortly.',
      applicationId: application.id
    };
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
    const publicJob: PublicJob = {
      id: j.id,
      title: j.title,
      department: j.department?.name || 'General',
      location: j.branch?.name || 'Remote',
      address: j.branch?.address || '',
      experienceYears: j.experienceYears || '0-1 Years',
      type: j.type,
      workLocationType: j.workLocationType || 'On-site',
      postedDate: j.postedDate ? j.postedDate.toISOString() : j.createdAt.toISOString(),
      startDate: j.startDate ? j.startDate.toISOString() : undefined,
      endDate: j.endDate ? j.endDate.toISOString() : undefined,
      descriptionHtml: j.descriptionHtml || '',
      screeningQuestions: questions,
      companyId: String(j.companyId)
    };

    if (j.discloseSalary) {
      if (j.minSalary != null) publicJob.minSalary = j.minSalary;
      if (j.maxSalary != null) publicJob.maxSalary = j.maxSalary;
    }

    return publicJob;
  }
}
