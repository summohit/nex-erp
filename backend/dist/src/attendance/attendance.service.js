"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttendanceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AttendanceService = class AttendanceService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTodayAttendance(userId) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee profile not found');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return this.prisma.attendance.findUnique({
            where: {
                employeeId_date: {
                    employeeId: employee.id,
                    date: today
                }
            }
        });
    }
    async getMyHistory(userId) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee profile not found');
        return this.prisma.attendance.findMany({
            where: { employeeId: employee.id },
            orderBy: { date: 'desc' }
        });
    }
    async clockIn(userId, data) {
        const employee = await this.prisma.employee.findUnique({
            where: { userId },
            include: { shift: true }
        });
        if (!employee)
            throw new common_1.BadRequestException('Employee profile not found');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const existing = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId: employee.id, date: today } }
        });
        if (existing && existing.clockIn) {
            throw new common_1.BadRequestException('Already clocked in today');
        }
        const now = new Date();
        let isLate = false;
        if (employee.shift) {
            const shiftStartTokens = employee.shift.startTime.split(':');
            const shiftStartHour = parseInt(shiftStartTokens[0], 10);
            const shiftStartMinute = parseInt(shiftStartTokens[1], 10);
            const expectedStart = new Date(now);
            expectedStart.setHours(shiftStartHour, shiftStartMinute, 0, 0);
            const maxStartTime = new Date(expectedStart.getTime() + (employee.shift.bufferTimeMinutes * 60000));
            if (now > maxStartTime) {
                isLate = true;
            }
        }
        if (existing) {
            return this.prisma.attendance.update({
                where: { id: existing.id },
                data: {
                    clockIn: now,
                    clockInLat: data.lat,
                    clockInLng: data.lng,
                    isLate
                }
            });
        }
        return this.prisma.attendance.create({
            data: {
                employeeId: employee.id,
                date: today,
                clockIn: now,
                clockInLat: data.lat,
                clockInLng: data.lng,
                isLate
            }
        });
    }
    async clockOut(userId, data) {
        const employee = await this.prisma.employee.findUnique({
            where: { userId },
            include: { shift: true }
        });
        if (!employee)
            throw new common_1.BadRequestException('Employee profile not found');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const existing = await this.prisma.attendance.findUnique({
            where: { employeeId_date: { employeeId: employee.id, date: today } }
        });
        if (!existing || !existing.clockIn) {
            throw new common_1.BadRequestException('You must clock in first');
        }
        if (existing.clockOut) {
            throw new common_1.BadRequestException('Already clocked out today');
        }
        const now = new Date();
        let isEarlyLeave = false;
        let status = 'PRESENT';
        if (employee.shift) {
            const shiftEndTokens = employee.shift.endTime.split(':');
            const shiftEndHour = parseInt(shiftEndTokens[0], 10);
            const shiftEndMinute = parseInt(shiftEndTokens[1], 10);
            const expectedEnd = new Date(now);
            expectedEnd.setHours(shiftEndHour, shiftEndMinute, 0, 0);
            if (now < expectedEnd) {
                isEarlyLeave = true;
                status = 'HALF_DAY';
            }
        }
        return this.prisma.attendance.update({
            where: { id: existing.id },
            data: {
                clockOut: now,
                clockOutLat: data.lat,
                clockOutLng: data.lng,
                isEarlyLeave,
                status
            }
        });
    }
};
exports.AttendanceService = AttendanceService;
exports.AttendanceService = AttendanceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AttendanceService);
//# sourceMappingURL=attendance.service.js.map