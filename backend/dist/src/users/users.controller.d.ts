import { PrismaService } from '../prisma/prisma.service';
export declare class UsersController {
    private prisma;
    constructor(prisma: PrismaService);
    getMe(req: any): Promise<({
        company: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            domain: string | null;
            logoUrl: string | null;
            industry: string | null;
            size: string | null;
            timezone: string | null;
            onboardingCompleted: boolean;
        };
        employee: {
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
        } | null;
    } & {
        id: number;
        email: string;
        password: string;
        role: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
    }) | null>;
    completeOnboarding(req: any, data: any): Promise<{
        success: boolean;
        message: string;
    } | {
        success: boolean;
        message?: undefined;
    }>;
}
