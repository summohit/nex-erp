import { ShiftRosterService } from './shift-roster.service';

/**
 * getEffectiveShift is the whole point of the on-site roster: before it,
 * attendance read Employee.shift directly and the roster had no effect on
 * clocking at all. These tests pin the resolution order, and the rule that an
 * unapproved on-site request must not govern anything.
 */
describe('ShiftRosterService.getEffectiveShift', () => {
  const DATE = new Date('2026-09-10T00:00:00Z'); // a Thursday

  const OFFICE = {
    id: 1, name: 'General Shift',
    startTime: '09:30', endTime: '18:30',
    bufferTimeMinutes: 15, workingDays: 'Monday,Tuesday,Wednesday,Thursday,Friday',
  };
  const ONSITE_SHIFT = {
    id: 2, name: 'On-site Shift',
    startTime: '09:00', endTime: '18:00',
    bufferTimeMinutes: 10, workingDays: null,
  };

  let prisma: any;
  let service: ShiftRosterService;

  const withEntry = (entry: any) => {
    prisma.shiftRosterEntry.findUnique.mockResolvedValue(entry);
  };

  beforeEach(() => {
    prisma = {
      shiftRosterEntry: { findUnique: jest.fn().mockResolvedValue(null) },
      employee: { findUnique: jest.fn() },
    };
    service = new ShiftRosterService(prisma, {} as any);
  });

  it('falls back to the standing shift when the roster says nothing', async () => {
    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.source).toBe('STANDING');
    expect(r.startTime).toBe('09:30');
    expect(r.endTime).toBe('18:30');
    expect(r.onsite).toBeNull();
    expect(r.isDayOff).toBe(false);
  });

  it('treats a day the standing shift does not operate as a day off', async () => {
    const sunday = new Date('2026-09-13T00:00:00Z');
    const r = await service.getEffectiveShift(10, sunday, OFFICE as any);
    expect(r.isDayOff).toBe(true);
  });

  it('reports NONE when the employee has no shift at all', async () => {
    const r = await service.getEffectiveShift(10, DATE, null);
    expect(r.source).toBe('NONE');
    expect(r.shift).toBeNull();
    expect(r.startTime).toBeNull();
  });

  it("uses the roster entry's own window over the shift's", async () => {
    withEntry({
      isDayOff: false, onsiteApprovalStatus: 'NONE',
      shift: ONSITE_SHIFT, projectId: 7, address: 'Client site, Noida',
      startTime: '07:00', endTime: '14:00',
    });

    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.source).toBe('ROSTER');
    expect(r.startTime).toBe('07:00');
    expect(r.endTime).toBe('14:00');
    expect(r.shift).toMatchObject({ id: 2, bufferTimeMinutes: 10 });
    expect(r.onsite).toEqual({ projectId: 7, address: 'Client site, Noida' });
  });

  it("falls back to the rostered shift's window when the entry sets none", async () => {
    withEntry({
      isDayOff: false, onsiteApprovalStatus: 'NONE',
      shift: ONSITE_SHIFT, projectId: 7, address: 'Client site, Noida',
      startTime: null, endTime: null,
    });

    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.startTime).toBe('09:00');
    expect(r.endTime).toBe('18:00');
    expect(r.onsite).not.toBeNull();
  });

  // The security rule. A PENDING row is a *request*; if it governed, anyone
  // could move their own clock window — and skip the branch geofence — simply
  // by filing one and never being approved.
  it('ignores an on-site request that is still awaiting approval', async () => {
    withEntry({
      isDayOff: false, onsiteApprovalStatus: 'PENDING',
      shift: ONSITE_SHIFT, projectId: null, address: 'Somewhere',
      startTime: '07:00', endTime: '14:00',
    });

    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.source).toBe('STANDING');
    expect(r.startTime).toBe('09:30');
    expect(r.onsite).toBeNull();
  });

  it('honours an approved on-site request', async () => {
    withEntry({
      isDayOff: false, onsiteApprovalStatus: 'APPROVED',
      shift: ONSITE_SHIFT, projectId: null, address: 'Somewhere',
      startTime: '07:00', endTime: '14:00',
    });

    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.source).toBe('ROSTER');
    expect(r.startTime).toBe('07:00');
    expect(r.onsite).toEqual({ projectId: null, address: 'Somewhere' });
  });

  it('reports a rostered day off with no shift and no window', async () => {
    withEntry({ isDayOff: true, onsiteApprovalStatus: 'NONE', shift: null, startTime: null, endTime: null });

    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.isDayOff).toBe(true);
    expect(r.shift).toBeNull();
    expect(r.endTime).toBeNull();
  });

  it('keeps the standing shift when the entry only overrides the window', async () => {
    withEntry({
      isDayOff: false, onsiteApprovalStatus: 'NONE',
      shift: null, projectId: null, address: null,
      startTime: '11:00', endTime: '20:00',
    });

    const r = await service.getEffectiveShift(10, DATE, OFFICE as any);
    expect(r.shift).toMatchObject({ id: 1 });
    expect(r.startTime).toBe('11:00');
    expect(r.onsite).toBeNull();
  });

  it('looks the standing shift up itself when the caller does not supply one', async () => {
    prisma.employee.findUnique.mockResolvedValue({ shift: OFFICE });
    const r = await service.getEffectiveShift(10, DATE);
    expect(prisma.employee.findUnique).toHaveBeenCalled();
    expect(r.startTime).toBe('09:30');
  });
});
