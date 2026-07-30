import { PrismaService } from '../prisma/prisma.service';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    inviteEmployee(adminCompanyId: number, email: string, firstName: string, lastName: string, role: string): Promise<{
        user: {
            id: number;
            email: string;
            password: string;
            role: string;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
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
        };
    }>;
}
