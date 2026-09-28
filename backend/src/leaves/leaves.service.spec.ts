import { Test, TestingModule } from '@nestjs/testing';

import { LeavesService } from './leaves.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FieldVisitActivationService } from '../field-visits/requests/field-visit-activation.service';
import { ApprovalsService } from '../approvals/approvals.service';

/** Was Nest boilerplate that supplied no providers and could not compile. */
describe('LeavesService', () => {
  let service: LeavesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        { provide: PrismaService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        // Applying for leave now asks whether the days belong to a field visit.
        { provide: FieldVisitActivationService, useValue: {} },
        // §Att9: and who may raise it for somebody else.
        { provide: ApprovalsService, useValue: { mayApprove: jest.fn() } },
      ],
    }).compile();

    service = module.get<LeavesService>(LeavesService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
