import { AttendanceService } from './attendance.service';

/**
 * A field visit's window (when someone may be on site) must not become the
 * hours they are scored against (16 Oct 2026: a 9:28–18:39 day on a 07:00–21:00
 * visit was saved as a "left early" half day).
 */
describe('AttendanceService.workingWindow', () => {
  const ww = (e: any) => (Object.create(AttendanceService.prototype) as any).workingWindow(e);
  const shift = { startTime: '09:30', endTime: '18:30' };

  it('holds an on-site day to the overlap of shift and visit window', () => {
    expect(ww({ onsite: { projectId: 1 }, shift, startTime: '07:00', endTime: '21:00' }))
      .toMatchObject({ startTime: '09:30', endTime: '18:30' });
  });

  it('uses a narrower visit window when it is inside the shift', () => {
    expect(ww({ onsite: { projectId: 1 }, shift, startTime: '11:00', endTime: '16:00' }))
      .toMatchObject({ startTime: '11:00', endTime: '16:00' });
  });

  it('leaves an ordinary office day alone', () => {
    const e = { onsite: null, shift, startTime: '09:30', endTime: '18:30' };
    expect(ww(e)).toBe(e);
  });

  it('leaves overnight shifts alone', () => {
    const e = { onsite: { projectId: 1 }, shift: { startTime: '22:00', endTime: '06:00' }, startTime: '07:00', endTime: '21:00' };
    expect(ww(e)).toBe(e);
  });
});
