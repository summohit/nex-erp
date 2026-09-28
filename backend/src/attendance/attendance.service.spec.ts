import { Test, TestingModule } from '@nestjs/testing';

import { AttendanceService } from './attendance.service';
import { ShiftRosterService } from './shift-roster.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../approvals/approvals.service';

/**
 * Was Nest boilerplate that supplied no providers and could not compile.
 * AttendanceService now also depends on ShiftRosterService, because clocking
 * resolves through the roster rather than reading Employee.shift directly, and
 * on ApprovalsService, because §Att5 asks it who may rule on a late clock-out.
 */
describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: ShiftRosterService, useValue: { getEffectiveShift: jest.fn() } },
        { provide: ApprovalsService, useValue: { mayApprove: jest.fn() } },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
