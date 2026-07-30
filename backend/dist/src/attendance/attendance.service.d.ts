import { PrismaService } from '../prisma/prisma.service';
export declare class AttendanceService {
    private prisma;
    constructor(prisma: PrismaService);
    getTodayAttendance(userId: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    } | null>;
    getMyHistory(userId: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    }[]>;
    clockIn(userId: number, data: {
        lat?: number;
        lng?: number;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    }>;
    clockOut(userId: number, data: {
        lat?: number;
        lng?: number;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    }>;
}
