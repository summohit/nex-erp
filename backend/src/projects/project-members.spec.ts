import { buildInitialMembers } from './project-members';

/**
 * ProjectMember is unique on (projectId, employeeId). A person picked as both
 * a manager and an assigned user — normal on a small team — has to collapse to
 * one row with the higher role, or the project cannot be created at all.
 */
describe('buildInitialMembers', () => {
  it('gives the owner ADMIN', () => {
    expect(buildInitialMembers(50, [], [])).toEqual([{ employeeId: 50, role: 'ADMIN' }]);
  });

  it('assigns managers and users their own roles', () => {
    const rows = buildInitialMembers(50, [60], [70, 80]);

    expect(rows).toEqual(
      expect.arrayContaining([
        { employeeId: 50, role: 'ADMIN' },
        { employeeId: 60, role: 'PROJECT_MANAGER' },
        { employeeId: 70, role: 'MEMBER' },
        { employeeId: 80, role: 'MEMBER' },
      ]),
    );
    expect(rows).toHaveLength(4);
  });

  // The case that would otherwise blow up the create.
  it('collapses someone who is both a manager and an assigned user', () => {
    const rows = buildInitialMembers(50, [60], [60, 70]);

    expect(rows).toHaveLength(3);
    expect(rows.find(r => r.employeeId === 60)!.role).toBe('PROJECT_MANAGER');
  });

  it('keeps the owner as ADMIN even when also picked as a manager or user', () => {
    const rows = buildInitialMembers(50, [50], [50]);

    expect(rows).toEqual([{ employeeId: 50, role: 'ADMIN' }]);
  });

  it('de-duplicates a list that names the same person twice', () => {
    expect(buildInitialMembers(50, [60, 60], [70, 70])).toHaveLength(3);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a non-array', 'nonsense'],
  ])('survives %s in place of a list', (_label, value) => {
    expect(buildInitialMembers(50, value, value)).toEqual([{ employeeId: 50, role: 'ADMIN' }]);
  });

  it('drops entries that are not whole numbers', () => {
    expect(buildInitialMembers(50, [null, 'x', 1.5], [undefined])).toEqual([
      { employeeId: 50, role: 'ADMIN' },
    ]);
  });

  it('accepts ids arriving as strings, as a form sends them', () => {
    const rows = buildInitialMembers(50, ['60'], ['70']);

    expect(rows).toEqual(
      expect.arrayContaining([
        { employeeId: 60, role: 'PROJECT_MANAGER' },
        { employeeId: 70, role: 'MEMBER' },
      ]),
    );
  });
});

describe('the technical architect', () => {
  it('is written as its own role', () => {
    const rows = buildInitialMembers(1, [], [60], [61]);
    expect(rows).toEqual(expect.arrayContaining([
      { employeeId: 61, role: 'TECHNICAL_ARCHITECT' },
      { employeeId: 60, role: 'MEMBER' },
    ]));
  });

  it('outranks plain membership', () => {
    // Named in both lists: seeing the whole board is the stronger standing.
    const rows = buildInitialMembers(1, [], [60], [60]);
    expect(rows.find(r => r.employeeId === 60)!.role).toBe('TECHNICAL_ARCHITECT');
  });

  it('gives way to the project manager', () => {
    // An architect who also manages keeps their hand on the board.
    const rows = buildInitialMembers(1, [60], [], [60]);
    expect(rows.find(r => r.employeeId === 60)!.role).toBe('PROJECT_MANAGER');
  });

  it('still collapses to one row for the owner', () => {
    const rows = buildInitialMembers(1, [], [], [1]);
    expect(rows.filter(r => r.employeeId === 1)).toEqual([{ employeeId: 1, role: 'ADMIN' }]);
  });

  it('is optional, so every existing caller behaves as before', () => {
    expect(buildInitialMembers(1, [2], [3])).toEqual([
      { employeeId: 3, role: 'MEMBER' },
      { employeeId: 2, role: 'PROJECT_MANAGER' },
      { employeeId: 1, role: 'ADMIN' },
    ]);
  });
});
