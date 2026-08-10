import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PerformanceService {
  constructor(private prisma: PrismaService) {}

  // Goals
  async getMyGoals(employeeId: number) {
    return this.prisma.performanceGoal.findMany({
      where: { employeeId },
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
  
  async deleteGoal(goalId: number, employeeId: number) {
    const goal = await this.prisma.performanceGoal.findFirst({ where: { id: goalId, employeeId } });
    if (!goal) throw new NotFoundException('Goal not found');
    return this.prisma.performanceGoal.delete({
      where: { id: goalId }
    });
  }

  // Reviews
  async getMyReviews(employeeId: number) {
    return this.prisma.performanceReview.findMany({
      where: { employeeId },
      include: { reviewer: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getTeamReviews(managerId: number) {
    return this.prisma.performanceReview.findMany({
      where: { reviewerId: managerId },
      include: { employee: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createReview(reviewerId: number, companyId: number, data: any) {
    return this.prisma.performanceReview.create({
      data: {
        employeeId: data.employeeId,
        reviewerId,
        companyId,
        cycleName: data.cycleName,
        rating: data.rating,
        feedback: data.feedback,
        status: data.status || 'DRAFT'
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

  async setNextAppraisalDate(employeeId: number, date: string) {
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: { nextAppraisalDate: date ? new Date(date) : null }
    });
  }
}
