import { PrismaService } from '../prisma/prisma.service';
export declare class ShiftsService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(companyId: number): Promise<({
        _count: {
            employees: number;
        };
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    })[]>;
    create(companyId: number, data: {
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes?: number;
    }): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    }>;
    update(companyId: number, id: number, data: {
        name?: string;
        startTime?: string;
        endTime?: string;
        bufferTimeMinutes?: number;
    }): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    }>;
    delete(companyId: number, id: number): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    }>;
}
