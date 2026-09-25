import { ProjectsService } from './projects.service';

/**
 * Adding somebody to a board, and as what.
 *
 * The role is not decoration: it decides whether they see the whole project or
 * only their own tasks, so an unrecognised one would create a member who
 * matches no rule at all.
 */
describe('adding a project member', () => {
  function make(existing: any = null) {
    const prisma: any = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: 3, leadId: 70 }) },
      projectMember: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 9, ...a.data })),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: existing?.id, ...a.data })),
      },
    };
    // Adding a member touches nothing but Prisma; the second dependency is
    // never reached on this path.
    const service = new ProjectsService(prisma, {} as any);
    return { service, prisma };
  }

  it('stores the role that was asked for', async () => {
    const { service, prisma } = make();
    await service.addProjectMember(1, 3, 60, 'TECHNICAL_ARCHITECT', 70, 'EMPLOYEE');
    expect(prisma.projectMember.create.mock.calls[0][0].data.role).toBe('TECHNICAL_ARCHITECT');
  });

  it('falls back to MEMBER when the role is not one we know', async () => {
    const { service, prisma } = make();
    await service.addProjectMember(1, 3, 60, 'ARCHITECT_TYPO', 70, 'EMPLOYEE');
    expect(prisma.projectMember.create.mock.calls[0][0].data.role).toBe('MEMBER');
  });

  it('promotes somebody already on the board rather than ignoring the click', async () => {
    const { service, prisma } = make({ id: 5, role: 'MEMBER' });
    await service.addProjectMember(1, 3, 60, 'PROJECT_MANAGER', 70, 'EMPLOYEE');
    expect(prisma.projectMember.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { role: 'PROJECT_MANAGER' },
    });
  });

  it('leaves an unchanged role alone', async () => {
    const { service, prisma } = make({ id: 5, role: 'MEMBER' });
    await service.addProjectMember(1, 3, 60, 'MEMBER', 70, 'EMPLOYEE');
    expect(prisma.projectMember.update).not.toHaveBeenCalled();
    expect(prisma.projectMember.create).not.toHaveBeenCalled();
  });

  it('still refuses anybody but the owner or an administrator', async () => {
    const { service } = make();
    await expect(service.addProjectMember(1, 3, 60, 'PROJECT_MANAGER', 61, 'EMPLOYEE'))
      .rejects.toThrow(/Only the project owner/);
  });
});
