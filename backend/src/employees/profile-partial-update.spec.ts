import { EmployeesService } from './employees.service';

/**
 * updateProfile used to write every whitelisted column on every call as
 * `data.x || null`, so a caller that posted a narrow payload silently NULLed
 * everything it had not mentioned. The header's change-password dialog posted
 * `{ password }` to this endpoint and wiped people's bank details, identity
 * numbers and their department/designation/branch/manager links.
 */
function makeService() {
  const prisma: any = {
    employee: {
      findFirst: jest.fn().mockResolvedValue({ id: 1, userId: 11, companyId: 1 }),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
    },
  };
  const permissions: any = { hasPermission: jest.fn().mockResolvedValue(true) };
  return { service: new EmployeesService(prisma, permissions, {} as any), prisma };
}

/** Self-edit: employee 1 is owned by user 11. */
const asOwner = (service: EmployeesService, data: any) =>
  service.updateProfile(1, 1, 11, 'EMPLOYEE', data);

describe('updateProfile leaves untouched fields alone', () => {
  it('writes only the keys the caller actually sent', async () => {
    const { service, prisma } = makeService();

    await asOwner(service, { bankName: 'HDFC Bank' });

    const written = prisma.employee.update.mock.calls[0][0].data;
    expect(written).toEqual({ bankName: 'HDFC Bank' });
  });

  it('does not null the profile when the payload mentions none of it', async () => {
    const { service, prisma } = makeService();

    // The exact shape the change-password dialog used to send.
    await asOwner(service, { password: 'hunter2hunter2' });

    const written = prisma.employee.update.mock.calls[0][0].data;
    for (const field of [
      'bankName', 'bankAccountNumber', 'ifscCode', 'passportNo', 'visaNo',
      'nationality', 'identificationNo', 'dateOfBirth', 'spouseName',
      'departmentId', 'designationId', 'branchId', 'managerId',
    ]) {
      expect(written).not.toHaveProperty(field);
    }
  });

  it('never lets a password reach this endpoint', async () => {
    const { service, prisma } = makeService();

    await asOwner(service, { password: 'hunter2hunter2', firstName: 'Richard' });

    expect(prisma.employee.update.mock.calls[0][0].data).not.toHaveProperty('password');
  });

  it('still clears a field the caller explicitly blanks', async () => {
    const { service, prisma } = makeService();

    await asOwner(service, { bankName: '', spouseName: null, childrenCount: '' });

    const written = prisma.employee.update.mock.calls[0][0].data;
    expect(written.bankName).toBeNull();
    expect(written.spouseName).toBeNull();
    expect(written.childrenCount).toBeNull();
  });

  it('coerces ids, numbers and dates that are sent', async () => {
    const { service, prisma } = makeService();

    await asOwner(service, {
      departmentId: '4',
      homeWorkDistanceKm: '12.5',
      childrenCount: 2,
      dateOfBirth: '1990-04-01',
    });

    const written = prisma.employee.update.mock.calls[0][0].data;
    expect(written.departmentId).toBe(4);
    expect(written.homeWorkDistanceKm).toBe(12.5);
    expect(written.childrenCount).toBe(2);
    expect(written.dateOfBirth).toEqual(new Date('1990-04-01'));
  });
});
