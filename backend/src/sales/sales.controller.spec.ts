import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Was Nest boilerplate with no providers, so it could not compile. The
 * controller carries AuthGuard and PermissionsGuard, whose dependencies have to resolve even though
 * no test here exercises a route.
 */
describe('SalesController', () => {
  let controller: SalesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: SalesService, useValue: {} },
        { provide: QuotationPdfService, useValue: { generate: jest.fn() } },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: PrismaService, useValue: {} },
        { provide: PermissionsService, useValue: { hasPermission: jest.fn() } },
        Reflector,
      ],
    }).compile();

    controller = module.get<SalesController>(SalesController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });
});
