import { PermissionsService } from './permissions.service';
export declare class PermissionsController {
    private readonly permissionsService;
    constructor(permissionsService: PermissionsService);
    getAllPermissions(req: any, role?: string): Promise<{
        id: number;
        role: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        module: string;
        action: string;
    }[]>;
    setPermission(req: any, body: {
        role: string;
        module: string;
        action: string;
        enabled: boolean;
    }): Promise<import("@prisma/client").Prisma.BatchPayload | {
        id: number;
        role: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        module: string;
        action: string;
    }>;
}
