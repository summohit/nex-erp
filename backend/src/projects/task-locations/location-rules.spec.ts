import { locationHasHistory, locationProgress, parentStatusFor, isLocationOverdue } from './location-rules';

const now = new Date('2026-10-23T10:00:00Z');

describe('location rules', () => {
  it('counts progress over active locations only', () => {
    const p = locationProgress([
      { status: 'COMPLETED' },
      { status: 'COMPLETED' },
      { status: 'BLOCKED' },
      { status: 'NOT_STARTED', dueDate: '2026-10-20' },
      { status: 'COMPLETED', removedAt: '2026-10-21' },
    ], now);
    expect(p).toEqual({
      total: 4, completed: 2, inProgress: 0, blocked: 1, notStarted: 1, overdue: 1, percent: 50,
    });
  });

  it('never calls a completed location overdue', () => {
    expect(isLocationOverdue({ status: 'COMPLETED', dueDate: '2026-01-01' }, now)).toBe(false);
    expect(isLocationOverdue({ status: 'IN_PROGRESS', dueDate: '2026-01-01' }, now)).toBe(true);
    expect(isLocationOverdue({ status: 'IN_PROGRESS', dueDate: null }, now)).toBe(false);
  });

  it('keeps a location with any recorded work', () => {
    const blank = { status: 'NOT_STARTED', timeLogCount: 0, attachmentCount: 0, activityCount: 0 };
    expect(locationHasHistory(blank)).toBe(false);
    expect(locationHasHistory({ ...blank, timeLogCount: 1 })).toBe(true);
    expect(locationHasHistory({ ...blank, attachmentCount: 1 })).toBe(true);
    expect(locationHasHistory({ ...blank, activityCount: 1 })).toBe(true);
    expect(locationHasHistory({ ...blank, status: 'BLOCKED' })).toBe(true);
  });

  describe('parent status', () => {
    it('completes the parent when every active location is done', () => {
      expect(parentStatusFor('IN_PROGRESS', [
        { status: 'COMPLETED' }, { status: 'NOT_STARTED', removedAt: '2026-10-01' },
      ])).toBe('DONE');
    });
    it('reopens a done parent when a location is open again', () => {
      expect(parentStatusFor('DONE', [{ status: 'COMPLETED' }, { status: 'NOT_STARTED' }])).toBe('IN_PROGRESS');
    });
    it('starts a to-do parent once work begins anywhere', () => {
      expect(parentStatusFor('TODO', [{ status: 'IN_PROGRESS' }, { status: 'NOT_STARTED' }])).toBe('IN_PROGRESS');
      expect(parentStatusFor('TODO', [{ status: 'NOT_STARTED' }])).toBeNull();
    });
    it('leaves cancelled tasks and tasks without locations alone', () => {
      expect(parentStatusFor('CANCELLED', [{ status: 'COMPLETED' }])).toBeNull();
      expect(parentStatusFor('TODO', [])).toBeNull();
      expect(parentStatusFor('DONE', [{ status: 'COMPLETED' }])).toBeNull();
    });
  });
});
