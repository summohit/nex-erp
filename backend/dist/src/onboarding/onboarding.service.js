"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnboardingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let OnboardingService = class OnboardingService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTemplates(companyId) {
        return this.prisma.onboardingTemplate.findMany({
            where: { companyId },
            orderBy: { createdAt: 'asc' }
        });
    }
    async addTemplate(companyId, data) {
        return this.prisma.onboardingTemplate.create({
            data: {
                title: data.title,
                description: data.description,
                companyId
            }
        });
    }
    async deleteTemplate(companyId, id) {
        return this.prisma.onboardingTemplate.delete({
            where: { id, companyId }
        });
    }
    async getOnboardingBoard(companyId) {
        const employees = await this.prisma.employee.findMany({
            where: { companyId },
            include: {
                user: { select: { email: true } },
                designation: { select: { name: true } },
                onboardingTasks: true
            },
            orderBy: { createdAt: 'desc' }
        });
        const pending = employees.filter(e => e.onboardingStatus === 'PENDING');
        const inProgress = employees.filter(e => e.onboardingStatus === 'IN_PROGRESS');
        const completed = employees.filter(e => e.onboardingStatus === 'COMPLETED');
        return { pending, inProgress, completed };
    }
    async getMyTasks(companyId, userId) {
        const employee = await this.prisma.employee.findFirst({
            where: { userId, companyId },
            include: { onboardingTasks: { orderBy: { createdAt: 'asc' } } }
        });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        return {
            status: employee.onboardingStatus,
            tasks: employee.onboardingTasks
        };
    }
    async completeTask(companyId, userId, taskId) {
        const employee = await this.prisma.employee.findFirst({
            where: { userId, companyId }
        });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        await this.prisma.employeeOnboardingTask.update({
            where: { id: taskId, employeeId: employee.id },
            data: { isCompleted: true, completedAt: new Date() }
        });
        const allTasks = await this.prisma.employeeOnboardingTask.findMany({
            where: { employeeId: employee.id }
        });
        const completedTasksCount = allTasks.filter(t => t.isCompleted).length;
        let newStatus = employee.onboardingStatus;
        if (completedTasksCount === allTasks.length && allTasks.length > 0) {
            newStatus = 'COMPLETED';
        }
        else if (completedTasksCount > 0) {
            newStatus = 'IN_PROGRESS';
        }
        if (newStatus !== employee.onboardingStatus) {
            await this.prisma.employee.update({
                where: { id: employee.id },
                data: { onboardingStatus: newStatus }
            });
        }
        return { success: true, newStatus };
    }
    async toggleTaskForAdmin(companyId, taskId, isCompleted) {
        const task = await this.prisma.employeeOnboardingTask.findUnique({
            where: { id: taskId },
            include: { employee: true }
        });
        if (!task || task.employee.companyId !== companyId) {
            throw new common_1.NotFoundException('Task not found');
        }
        await this.prisma.employeeOnboardingTask.update({
            where: { id: taskId },
            data: {
                isCompleted,
                completedAt: isCompleted ? new Date() : null
            }
        });
        const allTasks = await this.prisma.employeeOnboardingTask.findMany({
            where: { employeeId: task.employeeId }
        });
        const completedTasksCount = allTasks.filter(t => t.isCompleted).length;
        let newStatus = task.employee.onboardingStatus;
        if (completedTasksCount === allTasks.length && allTasks.length > 0) {
            newStatus = 'COMPLETED';
        }
        else if (completedTasksCount > 0) {
            newStatus = 'IN_PROGRESS';
        }
        else {
            newStatus = 'PENDING';
        }
        if (newStatus !== task.employee.onboardingStatus) {
            await this.prisma.employee.update({
                where: { id: task.employeeId },
                data: { onboardingStatus: newStatus }
            });
        }
        return { success: true, newStatus, employeeId: task.employeeId };
    }
    async updateEmployeeStatus(companyId, employeeId, status) {
        const employee = await this.prisma.employee.findFirst({
            where: { id: employeeId, companyId }
        });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        await this.prisma.employee.update({
            where: { id: employeeId },
            data: { onboardingStatus: status }
        });
        return { success: true, status };
    }
};
exports.OnboardingService = OnboardingService;
exports.OnboardingService = OnboardingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], OnboardingService);
//# sourceMappingURL=onboarding.service.js.map