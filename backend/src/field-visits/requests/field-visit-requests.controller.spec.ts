import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { FieldVisitRequestsController } from './field-visit-requests.controller';
import { FieldVisitRequestsService } from './field-visit-requests.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Every decision in the service turns on the acting EMPLOYEE, not the user id
 * in `sub` — approving your own trip is refused by comparing employee ids, and
 * a controller that forwarded `sub` would compare a user id against an
 * employee id and quietly let it through.
 */
describe('FieldVisitRequestsController', () => {
  let controller: FieldVisitRequestsController;
  let requests: Record<string, jest.Mock>;

  const req = { user: { sub: 501, employeeId: 71, companyId: 1, role: 'ADMIN' } };

  beforeEach(async () => {
    requests = {
      list: jest.fn(), getOne: jest.fn(), timeline: jest.fn(),
      create: jest.fn(), update: jest.fn(), submit: jest.fn(),
      approve: jest.fn(), reject: jest.fn(), cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FieldVisitRequestsController],
      providers: [
        { provide: FieldVisitRequestsService, useValue: requests },
        // AuthGuard sits on the whole controller, so its own dependencies
        // have to resolve even though no request is actually authenticated.
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get(FieldVisitRequestsController);
  });

  it('forwards the employee id, not the user id, when approving', () => {
    controller.approve(req, 9);
    expect(requests.approve).toHaveBeenCalledWith(1, 71, 'ADMIN', 9);
  });

  it('passes a null employee id through rather than falling back to sub', () => {
    // A login not linked to an employee record must reach the service as null,
    // where it is refused — silently substituting `sub` would make it look
    // like employee 501.
    controller.approve({ user: { sub: 501, companyId: 1, role: 'ADMIN' } }, 9);
    expect(requests.approve).toHaveBeenCalledWith(1, null, 'ADMIN', 9);
  });

  it('carries the rejection reason', () => {
    controller.reject(req, 9, { reason: 'Client postponed' });
    expect(requests.reject).toHaveBeenCalledWith(1, 71, 'ADMIN', 9, 'Client postponed');
  });

  it('passes the list filters straight through', () => {
    controller.list(req, 'PENDING_APPROVAL', '3');
    expect(requests.list).toHaveBeenCalledWith(1, 'ADMIN', 71, {
      status: 'PENDING_APPROVAL', projectId: '3',
    });
  });
});
