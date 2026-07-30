import { PrismaService } from '../prisma/prisma.service';
export declare class PermissionsService {
    private prisma;
    constructor(prisma: PrismaService);
    getPermissions(companyId: number, role: string): Promise<{
        id: number;
        role: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        module: string;
        action: string;
    }[]>;
    getAllPermissions(companyId: number): Promise<{
        id: number;
        role: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        module: string;
        action: string;
    }[]>;
    setPermission(companyId: number, role: string, module: string, action: string, enabled: boolean): Promise<import("@prisma/client").Prisma.BatchPayload | {
        id: number;
        role: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        module: string;
        action: string;
    }>;
    hasPermission(companyId: number, role: string, module: string, action: string): Promise<boolean>;
}
