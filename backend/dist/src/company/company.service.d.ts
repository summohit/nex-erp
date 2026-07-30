import { PrismaService } from '../prisma/prisma.service';
export declare class CompanyService {
    private prisma;
    constructor(prisma: PrismaService);
    getCompanyProfile(companyId: number): Promise<{
        id: number;
        name: string;
        domain: string | null;
        logoUrl: string | null;
        industry: string | null;
        size: string | null;
        timezone: string | null;
    }>;
    updateCompanyProfile(companyId: number, data: {
        name?: string;
        domain?: string;
        industry?: string;
        size?: string;
        timezone?: string;
        logoUrl?: string;
    }): Promise<{
        id: number;
        name: string;
        domain: string | null;
        logoUrl: string | null;
        industry: string | null;
        size: string | null;
        timezone: string | null;
    }>;
}
