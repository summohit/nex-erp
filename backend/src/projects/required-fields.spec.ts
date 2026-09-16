import { BadRequestException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/**
 * A new project has to arrive complete: title, dates, department, category
 * and someone accountable for it.
 *
 * Create only. When this was introduced 82 of 83 existing projects had no
 * department, so enforcing it on update would have made almost every project
 * unsaveable until somebody invented one — an unrelated edit held hostage to
 * a field nobody had filled in yet.
 */
const VALID = {
  name: 'Gurgaon rollout',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
  departmentId: 3,
  category: 'Implementation & Deployment',
  pmIds: [60],
  memberIds: [70],
};

const service = () => new ProjectsService({} as any, {} as any);
const check = (data: any) => (service() as any)['assertRequiredForCreate'](data);

describe('a complete project is accepted', () => {
  it('passes with every required field present', () => {
    expect(() => check({ ...VALID })).not.toThrow();
  });

  // Everything else on the form stays optional — budget, hours, client and
  // the rest are frequently unknown on day one.
  it('does not require a client, a budget or an estimate', () => {
    expect(() => check({ ...VALID, leadContactId: null, budgetAmount: null, estimatedHours: null }))
      .not.toThrow();
  });
});

describe('each required field is enforced', () => {
  it.each([
    ['name', 'Board title'],
    ['startDate', 'Start date'],
    ['endDate', 'Deadline'],
    ['departmentId', 'Department'],
    ['category', 'Category'],
  ])('rejects a missing %s', (field, label) => {
    expect(() => check({ ...VALID, [field]: null })).toThrow(new RegExp(label));
  });

  it.each([
    ['an empty array', []],
    ['a missing key', undefined],
    ['a non-array', 'nonsense'],
  ])('rejects %s of project managers', (_label, pmIds) => {
    expect(() => check({ ...VALID, pmIds })).toThrow(/project manager/);
  });

  it.each([
    ['an empty array', []],
    ['a missing key', undefined],
    ['a non-array', 'nonsense'],
  ])('rejects %s of assigned users', (_label, memberIds) => {
    expect(() => check({ ...VALID, memberIds })).toThrow(/assigned user/);
  });

  // Whitespace is not a category.
  it.each(['name', 'category'])('treats a blank %s as missing', (field) => {
    expect(() => check({ ...VALID, [field]: '   ' })).toThrow(BadRequestException);
  });

  it('names every missing field at once rather than one at a time', () => {
    expect(() => check({ name: 'x' })).toThrow(
      /Start date, Deadline, Department, Category, At least one project manager, At least one assigned user/,
    );
  });
});

describe('the dates have to make sense together', () => {
  it('rejects a deadline before the start date', () => {
    expect(() => check({ ...VALID, startDate: '2026-12-31', endDate: '2026-09-01' }))
      .toThrow(/Deadline must be on or after/);
  });

  it('allows a single-day project', () => {
    expect(() => check({ ...VALID, startDate: '2026-09-01', endDate: '2026-09-01' })).not.toThrow();
  });

  // Reported as missing, not as out of order — the fix is different.
  it('reports a missing deadline as missing rather than as out of order', () => {
    expect(() => check({ ...VALID, endDate: null })).toThrow(/Deadline is required/);
  });
});
