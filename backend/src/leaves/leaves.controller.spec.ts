import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { LeavesController } from './leaves.controller';
import { LeavesService } from './leaves.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Was Nest boilerplate with no providers at all. AuthGuard sits on the
 * controller, so its dependencies have to resolve even though no test here
 * exercises a route.
 */
describe('LeavesController', () => {
  let controller: LeavesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeavesController],
      providers: [
        { provide: LeavesService, useValue: {} },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        Reflector,
      ],
    }).compile();

    controller = module.get<LeavesController>(LeavesController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });
});
