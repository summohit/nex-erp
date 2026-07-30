import { PrismaService } from '../prisma/prisma.service';
export declare class OnboardingService {
    private prisma;
    constructor(prisma: PrismaService);
    getTemplates(companyId: number): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        title: string;
    }[]>;
    addTemplate(companyId: number, data: {
        title: string;
        description?: string;
    }): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        title: string;
    }>;
    deleteTemplate(companyId: number, id: number): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        title: string;
    }>;
    getOnboardingBoard(companyId: number): Promise<{
        pending: ({
            user: {
                email: string;
            };
            designation: {
                name: string;
            } | null;
            onboardingTasks: {
                id: number;
                createdAt: Date;
                updatedAt: Date;
                description: string | null;
                title: string;
                employeeId: number;
                isCompleted: boolean;
                completedAt: Date | null;
            }[];
        } & {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            phone: string | null;
            onboardingStatus: string;
            salutation: string | null;
            country: string | null;
            state: string | null;
            city: string | null;
            language: string | null;
            gender: string | null;
            dateOfBirth: Date | null;
            slackId: string | null;
            maritalStatus: string | null;
            address: string | null;
            about: string | null;
            avatarUrl: string | null;
            themePref: string | null;
            currency: string | null;
            departmentId: number | null;
            designationId: number | null;
            userId: number;
            branchId: number | null;
            managerId: number | null;
            shiftId: number | null;
        })[];
        inProgress: ({
            user: {
                email: string;
            };
            designation: {
                name: string;
            } | null;
            onboardingTasks: {
                id: number;
                createdAt: Date;
                updatedAt: Date;
                description: string | null;
                title: string;
                employeeId: number;
                isCompleted: boolean;
                completedAt: Date | null;
            }[];
        } & {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            phone: string | null;
            onboardingStatus: string;
            salutation: string | null;
            country: string | null;
            state: string | null;
            city: string | null;
            language: string | null;
            gender: string | null;
            dateOfBirth: Date | null;
            slackId: string | null;
            maritalStatus: string | null;
            address: string | null;
            about: string | null;
            avatarUrl: string | null;
            themePref: string | null;
            currency: string | null;
            departmentId: number | null;
            designationId: number | null;
            userId: number;
            branchId: number | null;
            managerId: number | null;
            shiftId: number | null;
        })[];
        completed: ({
            user: {
                email: string;
            };
            designation: {
                name: string;
            } | null;
            onboardingTasks: {
                id: number;
                createdAt: Date;
                updatedAt: Date;
                description: string | null;
                title: string;
                employeeId: number;
                isCompleted: boolean;
                completedAt: Date | null;
            }[];
        } & {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            phone: string | null;
            onboardingStatus: string;
            salutation: string | null;
            country: string | null;
            state: string | null;
            city: string | null;
            language: string | null;
            gender: string | null;
            dateOfBirth: Date | null;
            slackId: string | null;
            maritalStatus: string | null;
            address: string | null;
            about: string | null;
            avatarUrl: string | null;
            themePref: string | null;
            currency: string | null;
            departmentId: number | null;
            designationId: number | null;
            userId: number;
            branchId: number | null;
            managerId: number | null;
            shiftId: number | null;
        })[];
    }>;
    getMyTasks(companyId: number, userId: number): Promise<{
        status: string;
        tasks: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            description: string | null;
            title: string;
            employeeId: number;
            isCompleted: boolean;
            completedAt: Date | null;
        }[];
    }>;
    completeTask(companyId: number, userId: number, taskId: number): Promise<{
        success: boolean;
        newStatus: string;
    }>;
    toggleTaskForAdmin(companyId: number, taskId: number, isCompleted: boolean): Promise<{
        success: boolean;
        newStatus: string;
        employeeId: number;
    }>;
    updateEmployeeStatus(companyId: number, employeeId: number, status: string): Promise<{
        success: boolean;
        status: string;
    }>;
}
