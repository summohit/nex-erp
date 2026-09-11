import { Test, TestingModule } from '@nestjs/testing';

import { LeavesService } from './leaves.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Was Nest boilerplate that supplied no providers and could not compile. */
describe('LeavesService', () => {
  let service: LeavesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeavesService,
        { provide: PrismaService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<LeavesService>(LeavesService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });
});
