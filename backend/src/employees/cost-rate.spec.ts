import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service';

/**
 * §23 and Rule 1: an employee's internal charge-out rate is commercial, and
 * directory access is not cost access. HR can see every person in the company
 * and must not see what an hour of their time is billed to a project at.
 */
function makeService(over: any = {}) {
  const prisma: any = {
    employee: {
      findMany: jest.fn().mockResolvedValue([
        { id: 1, firstName: 'Rahul', lastName: 'K', hourlyCostRate: 500, phone: '9000000000' },
        { id: 2, firstName: 'Asha', lastName: 'M', hourlyCostRate: null, phone: '9000000001' },
      ]),
      findFirst: jest.fn().mockResolvedValue({ id: 1, firstName: 'Rahul', userId: 11 }),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
    },
    ...over,
  };
  const permissions: any = { hasPermission: jest.fn().mockResolvedValue(true) };
  const mail: any = {};
  return { service: new EmployeesService(prisma, permissions, mail), prisma, permissions };
}

describe('employee directory does not leak the cost rate', () => {
  it.each(['SUPERADMIN', 'ADMIN', 'FINANCE'])('keeps the rate for %s', async (role) => {
    const { service } = makeService();
    const rows = await service.findAll(1, role);
    expect(rows[0]).toHaveProperty('hourlyCostRate', 500);
  });

  // The case this exists for. HR passes assertDirectoryAccess and must still
  // not see the rate.
  it.each(['HR', 'EMPLOYEE', 'PROJECT_MANAGER'])('strips the rate for %s', async (role) => {
    const { service } = makeService();
    const rows = await service.findAll(1, role);

    expect(rows[0]).not.toHaveProperty('hourlyCostRate');
    // Everything else the directory is for still comes through.
    expect(rows[0]).toHaveProperty('firstName', 'Rahul');
    expect(rows[1]).not.toHaveProperty('hourlyCostRate');
  });
});

describe('EmployeesService.setCostRate', () => {
  it.each(['HR', 'EMPLOYEE'])('refuses %s', async (role) => {
    const { service } = makeService();
    await expect(service.setCostRate(1, 1, role, 500)).rejects.toThrow(ForbiddenException);
  });

  it.each(['SUPERADMIN', 'ADMIN', 'FINANCE'])('lets %s set a rate', async (role) => {
    const { service, prisma } = makeService();
    await service.setCostRate(1, 1, role, 500);
    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hourlyCostRate: 500 } }),
    );
  });

  // Clearing a rate is meaningful: it makes the person's hours unpriced, which
  // the project rollup reports separately rather than treating as free.
  it('accepts null to clear the rate', async () => {
    const { service, prisma } = makeService();
    await service.setCostRate(1, 1, 'FINANCE', null);
    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hourlyCostRate: null } }),
    );
  });

  it('rejects a negative rate', async () => {
    const { service } = makeService();
    await expect(service.setCostRate(1, 1, 'ADMIN', -5)).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-finite rate', async () => {
    const { service } = makeService();
    await expect(service.setCostRate(1, 1, 'ADMIN', Number.NaN)).rejects.toThrow(BadRequestException);
  });

  it('404s for an employee in another company', async () => {
    const { service, prisma } = makeService();
    prisma.employee.findFirst.mockResolvedValue(null);
    await expect(service.setCostRate(1, 1, 'ADMIN', 500)).rejects.toThrow(NotFoundException);
  });

  // Authorisation is checked before existence, so a refused caller cannot use
  // the 404 to learn which employee ids exist.
  it('refuses an unauthorised caller before it looks the employee up', async () => {
    const { service, prisma } = makeService();
    await expect(service.setCostRate(999, 1, 'HR', 500)).rejects.toThrow(ForbiddenException);
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });
});
