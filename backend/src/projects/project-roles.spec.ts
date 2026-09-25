import {
  PROJECT_ROLE, seesEveryTask, mayChangeAnyTask, taskVisibilityFilter, resolveProjectViewer,
} from './project-roles';

/**
 * Who sees and who changes, on one project.
 *
 * Four standings: the owner and the project manager run it, the technical
 * architect sees all of it without running it, and everybody else sees the
 * work that is actually theirs.
 */

const viewer = (over: any = {}) => ({
  employeeId: 60, companyRole: 'EMPLOYEE', projectRole: null, isOwner: false, ...over,
});

describe('who sees every task', () => {
  it.each([
    ['the project owner', viewer({ isOwner: true })],
    ['a project manager', viewer({ projectRole: PROJECT_ROLE.MANAGER })],
    ['a technical architect', viewer({ projectRole: PROJECT_ROLE.ARCHITECT })],
    ['a company administrator', viewer({ companyRole: 'ADMIN' })],
    ['a superadmin', viewer({ companyRole: 'SUPERADMIN' })],
  ])('%s does', (_label, v) => {
    expect(seesEveryTask(v)).toBe(true);
    expect(taskVisibilityFilter(v)).toBeNull();
  });

  it.each([
    ['a plain member', viewer({ projectRole: PROJECT_ROLE.MEMBER })],
    ['a viewer', viewer({ projectRole: PROJECT_ROLE.VIEWER })],
    // The project's own ADMIN role is not a deputy manager.
    ['a project ADMIN member', viewer({ projectRole: PROJECT_ROLE.ADMIN })],
    ['somebody not on the project at all', viewer()],
  ])('%s does not', (_label, v) => {
    expect(seesEveryTask(v)).toBe(false);
  });
});

describe('what a limited viewer sees', () => {
  it('is the task they are assigned, added to, or raised', () => {
    expect(taskVisibilityFilter(viewer({ projectRole: PROJECT_ROLE.MEMBER }))).toEqual({
      OR: [
        { assigneeId: 60 },
        { reporterId: 60 },
        { members: { some: { employeeId: 60 } } },
      ],
    });
  });

  it('is nothing at all when the login has no employee record', () => {
    // -1 matches nobody. Failing open here would hand the whole board to a
    // half-configured account.
    const filter = taskVisibilityFilter(viewer({ employeeId: null }));
    expect(filter.OR).toEqual([
      { assigneeId: -1 }, { reporterId: -1 }, { members: { some: { employeeId: -1 } } },
    ]);
  });
});

describe('who may change a task', () => {
  it.each([
    ['the owner', viewer({ isOwner: true })],
    ['a project manager', viewer({ projectRole: PROJECT_ROLE.MANAGER })],
    ['an administrator', viewer({ companyRole: 'ADMIN' })],
  ])('%s may', (_label, v) => expect(mayChangeAnyTask(v)).toBe(true));

  it('the technical architect may not — seeing the plan is not rewriting it', () => {
    expect(mayChangeAnyTask(viewer({ projectRole: PROJECT_ROLE.ARCHITECT }))).toBe(false);
  });

  it('but an architect who also owns the project still may', () => {
    // Standing adds up; it does not cancel out.
    expect(mayChangeAnyTask(viewer({ projectRole: PROJECT_ROLE.ARCHITECT, isOwner: true }))).toBe(true);
  });
});

describe('reading the viewer off the database', () => {
  const prisma = (lead: number | null, memberRole: string | null) => ({
    project: { findFirst: jest.fn().mockResolvedValue(lead == null ? null : { leadId: lead }) },
    projectMember: {
      findFirst: jest.fn().mockResolvedValue(memberRole ? { role: memberRole } : null),
    },
  });

  it('recognises the owner by the project lead', async () => {
    const v = await resolveProjectViewer(prisma(60, null) as any, 1, 3, 60, 'EMPLOYEE');
    expect(v.isOwner).toBe(true);
    expect(seesEveryTask(v)).toBe(true);
  });

  it('recognises the architect by their membership row', async () => {
    const v = await resolveProjectViewer(prisma(70, PROJECT_ROLE.ARCHITECT) as any, 1, 3, 60, 'EMPLOYEE');
    expect(v.projectRole).toBe(PROJECT_ROLE.ARCHITECT);
    expect(seesEveryTask(v)).toBe(true);
    expect(mayChangeAnyTask(v)).toBe(false);
  });

  it('does not look up a membership for a login with no employee', async () => {
    const p = prisma(70, PROJECT_ROLE.MANAGER);
    const v = await resolveProjectViewer(p as any, 1, 3, null, 'EMPLOYEE');
    expect(p.projectMember.findFirst).not.toHaveBeenCalled();
    expect(seesEveryTask(v)).toBe(false);
  });
});
