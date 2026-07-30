import { PrismaService } from '../prisma/prisma.service';
export declare class MasterDataController {
    private prisma;
    constructor(prisma: PrismaService);
    getDepartments(req: any, activeOnly: string): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        defaultRole: string;
    }[]>;
    getDesignations(req: any, activeOnly: string): Promise<({
        department: {
            id: number;
            name: string;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            isActive: boolean;
            defaultRole: string;
        } | null;
    } & {
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        departmentId: number | null;
        canEditProfiles: boolean;
    })[]>;
    createDepartment(req: any, data: {
        name: string;
        defaultRole?: string;
    }): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        defaultRole: string;
    }>;
    updateDepartment(req: any, id: number, data: {
        name?: string;
        isActive?: boolean;
        defaultRole?: string;
    }): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        defaultRole: string;
    }>;
    deleteDepartment(req: any, id: number): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        defaultRole: string;
    }>;
    createDesignation(req: any, data: {
        name: string;
        departmentId: number;
        canEditProfiles?: boolean;
    }): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        departmentId: number | null;
        canEditProfiles: boolean;
    }>;
    updateDesignation(req: any, id: number, data: {
        name?: string;
        departmentId?: number;
        isActive?: boolean;
        canEditProfiles?: boolean;
    }): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        departmentId: number | null;
        canEditProfiles: boolean;
    }>;
    deleteDesignation(req: any, id: number): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        departmentId: number | null;
        canEditProfiles: boolean;
    }>;
    getBranches(req: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        startTime: string;
        endTime: string;
        weeklyOffs: string;
    }[]>;
    createBranch(req: any, data: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        startTime: string;
        endTime: string;
        weeklyOffs: string;
    }>;
    updateBranch(req: any, id: number, data: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        startTime: string;
        endTime: string;
        weeklyOffs: string;
    }>;
    deleteBranch(req: any, id: number): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        startTime: string;
        endTime: string;
        weeklyOffs: string;
    }>;
    getLeaveTypes(req: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        defaultDays: number;
        isPaid: boolean;
        carryForward: boolean;
        carryForwardLimit: number;
    }[]>;
    createLeaveType(req: any, data: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        defaultDays: number;
        isPaid: boolean;
        carryForward: boolean;
        carryForwardLimit: number;
    }>;
    updateLeaveType(req: any, id: number, data: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        defaultDays: number;
        isPaid: boolean;
        carryForward: boolean;
        carryForwardLimit: number;
    }>;
    deleteLeaveType(req: any, id: number): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        description: string | null;
        defaultDays: number;
        isPaid: boolean;
        carryForward: boolean;
        carryForwardLimit: number;
    }>;
    getHolidays(req: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
    }[]>;
    createHoliday(req: any, data: any): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
    }>;
    seedHolidays(req: any, data: {
        holidays: {
            name: string;
            date: string;
        }[];
    }): Promise<{
        success: boolean;
        count?: undefined;
    } | {
        success: boolean;
        count: number;
    }>;
    updateHoliday(req: any, id: number, data: {
        name?: string;
        date?: string;
    }): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
    }>;
    deleteHoliday(req: any, id: number): Promise<{
        id: number;
        name: string;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
    }>;
}
