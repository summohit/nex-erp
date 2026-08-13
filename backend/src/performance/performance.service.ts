import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  // --- Goals ---
  async getMyGoals(employeeId: number) {
    return this.prisma.performanceGoal.findMany({
      where: { employeeId },
      include: { okr: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createGoal(employeeId: number, companyId: number, data: any) {
    return this.prisma.performanceGoal.create({
      data: {
        title: data.title,
        description: data.description,
        status: data.status || 'IN_PROGRESS',
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        targetValue: data.targetValue ? parseFloat(data.targetValue) : null,
        unit: data.unit,
        okrId: data.okrId,
        employeeId,
        companyId
      }
    });
  }

  async updateGoalStatus(goalId: number, status: string, employeeId: number) {
    const goal = await this.prisma.performanceGoal.findFirst({ where: { id: goalId, employeeId } });
    if (!goal) throw new NotFoundException('Goal not found');
    return this.prisma.performanceGoal.update({
      where: { id: goalId },
      data: { status }
    });
  }

  async updateGoalProgress(goalId: number, employeeId: number, data: any) {
    const goal = await this.prisma.performanceGoal.findFirst({ where: { id: goalId, employeeId } });
    if (!goal) throw new NotFoundException('Goal not found');
    return this.prisma.performanceGoal.update({
      where: { id: goalId },
      data: { progress: data.progress, currentValue: data.currentValue }
    });
  }

  async deleteGoal(goalId: number, employeeId: number) {
    const goal = await this.prisma.performanceGoal.findFirst({ where: { id: goalId, employeeId } });
    if (!goal) throw new NotFoundException('Goal not found');
    return this.prisma.performanceGoal.delete({
      where: { id: goalId }
    });
  }

  // --- OKRs ---
  async getCompanyOKRs(companyId: number) {
    return this.prisma.companyOKR.findMany({
      where: { companyId },
      include: { keyResults: true, linkedGoals: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createOKR(companyId: number, createdById: number, data: any) {
    return this.prisma.companyOKR.create({
      data: {
        title: data.title,
        description: data.description,
        period: data.period,
        companyId,
        createdById,
        keyResults: {
           create: data.keyResults || []
        }
      },
      include: { keyResults: true }
    });
  }

  async updateOKR(okrId: number, companyId: number, data: any) {
    return this.prisma.companyOKR.update({
      where: { id: okrId, companyId },
      data: {
        title: data.title,
        description: data.description,
        period: data.period,
        status: data.status,
        progress: data.progress
      }
    });
  }

  async deleteOKR(okrId: number, companyId: number) {
    return this.prisma.companyOKR.delete({
      where: { id: okrId, companyId }
    });
  }

  // --- Key Results ---
  async updateKeyResult(krId: number, data: any) {
    const kr = await this.prisma.oKRKeyResult.update({
      where: { id: krId },
      data: { currentValue: data.currentValue }
    });
    return kr;
  }

  // --- Appraisal Cycles ---
  async getAppraisalCycles(companyId: number) {
    return this.prisma.appraisalCycle.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' }
    });
  }

  async createAppraisalCycle(companyId: number, data: any) {
    return this.prisma.appraisalCycle.create({
      data: {
        name: data.name,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        companyId
      }
    });
  }

  // --- Reviews ---
  async getMyReviews(employeeId: number) {
    return this.prisma.performanceReview.findMany({
      where: { employeeId },
      include: { reviewer: true, cycle: true, signoffs: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getTeamReviews(managerId: number) {
    return this.prisma.performanceReview.findMany({
      where: { reviewerId: managerId },
      include: { employee: true, cycle: true, signoffs: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createReview(reviewerId: number, companyId: number, data: any) {
    return this.prisma.performanceReview.create({
      data: {
        employeeId: data.employeeId,
        reviewerId,
        companyId,
        cycleId: data.cycleId,
        cycleName: data.cycleName,
        rating: data.rating,
        feedback: data.feedback,
        status: data.status || 'PENDING_SELF_REVIEW'
      }
    });
  }

  async updateReview(reviewId: number, reviewerId: number, data: any) {
    const review = await this.prisma.performanceReview.findFirst({ where: { id: reviewId, reviewerId } });
    if (!review) throw new NotFoundException('Review not found');
    return this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: {
        rating: data.rating,
        feedback: data.feedback,
        status: data.status
      }
    });
  }

  async submitSelfAppraisal(reviewId: number, employeeId: number, data: any) {
     const review = await this.prisma.performanceReview.findFirst({ where: { id: reviewId, employeeId } });
     if (!review) throw new NotFoundException('Review not found');
     return this.prisma.performanceReview.update({
       where: { id: reviewId },
       data: {
         selfRating: data.selfRating,
         selfFeedback: data.selfFeedback,
         status: 'SELF_REVIEWED'
       }
     });
  }

  async submitManagerAppraisal(reviewId: number, reviewerId: number, data: any) {
     const review = await this.prisma.performanceReview.findFirst({ where: { id: reviewId, reviewerId } });
     if (!review) throw new NotFoundException('Review not found');
     return this.prisma.performanceReview.update({
       where: { id: reviewId },
       data: {
         rating: data.rating,
         feedback: data.feedback,
         status: 'MANAGER_REVIEWED'
       }
     });
  }

  async signoffReview(reviewId: number, signedById: number, role: string, action: string, comments?: string) {
    await this.prisma.appraisalSignoff.create({
      data: { reviewId, signedById, role, action, comments }
    });
    
    if (role === 'EMPLOYEE' && action === 'ACKNOWLEDGED') {
       return this.prisma.performanceReview.update({
         where: { id: reviewId },
         data: { status: 'ACKNOWLEDGED' }
       });
    } else if (role === 'HR' && action === 'APPROVED') {
       return this.prisma.performanceReview.update({
         where: { id: reviewId },
         data: { status: 'HR_APPROVED' }
       });
    }
    return { success: true };
  }

  async setNextAppraisalDate(employeeId: number, date: string) {
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { nextAppraisalDate: date ? new Date(date) : null }
    });
  }

  // --- Peer Feedback ---
  async requestPeerFeedback(companyId: number, data: any) {
    const records = data.peerIds.map((peerId: number) => ({
      employeeId: data.employeeId,
      reviewerId: peerId,
      cycleId: data.cycleId,
      cycleName: data.cycleName,
      companyId
    }));
    return this.prisma.peerFeedback.createMany({ data: records });
  }

  async getMyPeerRequests(reviewerId: number) {
    return this.prisma.peerFeedback.findMany({
      where: { reviewerId },
      include: { employee: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getPeerFeedbackForEmployee(employeeId: number, cycleId?: number) {
    const whereClause: any = { employeeId, status: 'SUBMITTED' };
    if (cycleId) whereClause.cycleId = cycleId;
    return this.prisma.peerFeedback.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });
  }

  async submitPeerFeedback(feedbackId: number, reviewerId: number, data: any) {
    return this.prisma.peerFeedback.update({
      where: { id: feedbackId, reviewerId },
      data: {
        rating: data.rating,
        strengths: data.strengths,
        improvements: data.improvements,
        comments: data.comments,
        status: 'SUBMITTED'
      }
    });
  }
}
