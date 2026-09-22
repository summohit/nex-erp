import { IssuesService } from './issues.service';

/**
 * NEX seeds two columns with type DONE -- "Done" (position 3) and "Archived"
 * (position 4). Any `columns.find(c => c.type === 'DONE')` therefore returns
 * whichever the array yields first, which is how 1,046 completed tasks were
 * filed as Archived by the August import, and how approving a task could put it
 * there too.
 */
const service: any = new IssuesService({} as any, {} as any, {} as any, {} as any);

const SEEDED = [
  { id: 1, name: 'To Do', type: 'TODO', position: 0 },
  { id: 2, name: 'In Progress', type: 'IN_PROGRESS', position: 1 },
  { id: 3, name: 'In Review', type: 'REVIEW', position: 2 },
  { id: 4, name: 'Done', type: 'DONE', position: 3 },
  { id: 5, name: 'Archived', type: 'DONE', position: 4 },
];

describe('finishing a task is not archiving it', () => {
  it('picks Done, not Archived', () => {
    expect(service.doneColumn(SEEDED).name).toBe('Done');
  });

  it('still picks Done when Archived comes first in the array', () => {
    // The order Prisma returns rows in is not guaranteed; this is the case that
    // actually bit, and a plain find() fails it.
    const reversed = [...SEEDED].reverse();
    expect(reversed.find((c) => c.type === 'DONE')!.name).toBe('Archived');
    expect(service.doneColumn(reversed).name).toBe('Done');
  });

  it('returns nothing rather than Archived when there is no real Done column', () => {
    const onlyArchived = SEEDED.filter((c) => c.name !== 'Done');
    expect(service.doneColumn(onlyArchived)).toBeUndefined();
  });

  it('tolerates an empty or missing column list', () => {
    expect(service.doneColumn([])).toBeUndefined();
    expect(service.doneColumn(undefined)).toBeUndefined();
  });
});
