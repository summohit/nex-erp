import { canCreateTask } from './task-permissions';

/**
 * Who may raise a task.
 *
 * The rule used to be "admin, or the project's owner". Extending it to Sales
 * was nearly shipped as a name match on the string "Sales" — which this
 * company's data quietly defeats: it runs Sales, Field Sales and Sales &
 * Marketing as three separate departments, and the company seeder creates a
 * fourth spelling. So the rule is a flag, and these tests pin that.
 */
describe('canCreateTask', () => {
  const COMPANY = 1;

  /** A prisma double whose employee row carries whatever department we want. */
  const prismaWith = (department: { canCreateTasks: boolean } | null) => ({
    employee: { findFirst: jest.fn(async () => (department === undefined ? null : { department })) },
  });

  it('lets a SUPERADMIN through without touching the database', async () => {
    const prisma = prismaWith(null);
    await expect(canCreateTask(prisma as any, COMPANY, 5, 'SUPERADMIN')).resolves.toBe(true);
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('lets an ADMIN through', async () => {
    await expect(canCreateTask(prismaWith(null) as any, COMPANY, 5, 'ADMIN')).resolves.toBe(true);
  });

  // The rule issues.service has always enforced, preserved exactly.
  it("lets a project's owner create inside their own project", async () => {
    const prisma = prismaWith(null);
    await expect(
      canCreateTask(prisma as any, COMPANY, 7, 'EMPLOYEE', { leadId: 7 }),
    ).resolves.toBe(true);
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
  });

  it('does not let someone else in on the strength of another project', async () => {
    await expect(
      canCreateTask(prismaWith(null) as any, COMPANY, 8, 'EMPLOYEE', { leadId: 7 }),
    ).resolves.toBe(false);
  });

  it('lets a flagged department create', async () => {
    await expect(
      canCreateTask(prismaWith({ canCreateTasks: true }) as any, COMPANY, 9, 'EMPLOYEE'),
    ).resolves.toBe(true);
  });

  it('keeps an unflagged department out', async () => {
    await expect(
      canCreateTask(prismaWith({ canCreateTasks: false }) as any, COMPANY, 9, 'EMPLOYEE'),
    ).resolves.toBe(false);
  });

  it('keeps out an employee with no department at all', async () => {
    await expect(
      canCreateTask(prismaWith(null) as any, COMPANY, 9, 'EMPLOYEE'),
    ).resolves.toBe(false);
  });

  // A request with no resolved employee is not an anonymous admin.
  it('refuses when there is no employee id', async () => {
    await expect(
      canCreateTask(prismaWith({ canCreateTasks: true }) as any, COMPANY, null, 'EMPLOYEE'),
    ).resolves.toBe(false);
  });

  // The point of the flag: "Field Sales" is as much sales as "Sales", and a
  // rename must not revoke anything. Nothing here reads a department name.
  it('is decided by the flag, never by the department name', async () => {
    const renamed = { canCreateTasks: true };
    await expect(
      canCreateTask(prismaWith(renamed) as any, COMPANY, 9, 'EMPLOYEE'),
    ).resolves.toBe(true);
  });
  /**
   * A project manager raising work in their own project.
   *
   * They could not before, which sat oddly beside everything else a PM does:
   * approving that project's timesheets, owning its milestones, and being the
   * only non-admin able to move a task assigned to another PM.
   */
  describe('a project manager', () => {
    const pmPrisma = (managing: boolean) => ({
      employee: { findFirst: jest.fn(async () => ({ department: { canCreateTasks: false } })) },
      projectMember: { findFirst: jest.fn(async () => (managing ? { id: 1 } : null)) },
    });

    it('may raise a task in a project they manage', async () => {
      await expect(
        canCreateTask(pmPrisma(true) as any, COMPANY, 42, 'EMPLOYEE', { id: 7, leadId: 99 }),
      ).resolves.toBe(true);
    });

    // Managing one project says nothing about anybody else's.
    it('may not raise one in a project they do not manage', async () => {
      await expect(
        canCreateTask(pmPrisma(false) as any, COMPANY, 42, 'EMPLOYEE', { id: 8, leadId: 99 }),
      ).resolves.toBe(false);
    });

    // A general task has no project to manage, so the department flag decides.
    it('falls back to the department flag when there is no project', async () => {
      const prisma = pmPrisma(true);
      await expect(canCreateTask(prisma as any, COMPANY, 42, 'EMPLOYEE')).resolves.toBe(false);
      expect(prisma.projectMember.findFirst).not.toHaveBeenCalled();
    });

    it('scopes the membership check to the project in hand', async () => {
      const prisma = pmPrisma(true);
      await canCreateTask(prisma as any, COMPANY, 42, 'EMPLOYEE', { id: 7, leadId: 99 });
      expect(prisma.projectMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 7, employeeId: 42, role: 'PROJECT_MANAGER' },
        }),
      );
    });
  });
});
