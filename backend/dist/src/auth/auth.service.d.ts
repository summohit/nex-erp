import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
export declare class AuthService {
    private prisma;
    private jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    signupCompany(companyName: string, domain: string, adminEmail: string, adminPassword: string, firstName: string, lastName: string, phone?: string): Promise<{
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
        access_token: string;
    }>;
    login(email: string, pass: string): Promise<{
        access_token: string;
    }>;
}
