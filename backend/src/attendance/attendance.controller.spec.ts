import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Was Nest boilerplate with no providers at all. The controller carries
 * AuthGuard + PermissionsGuard, so their dependencies have to resolve even
 * though no test here exercises a route.
 */
describe('AttendanceController', () => {
  let controller: AttendanceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        { provide: AttendanceService, useValue: {} },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: PermissionsService, useValue: { hasPermission: jest.fn() } },
        Reflector,
      ],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });
});
