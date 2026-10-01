import * as xlsx from 'xlsx';
import { TaskTransferService, TEMPLATE_COLUMNS } from './task-transfer.service';

const fileOf = (rows: any[][]) => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([[...TEMPLATE_COLUMNS, 'Task ID'], ...rows]), 'task');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

describe('TaskTransferService preview', () => {
  const prisma: any = {
    project: { findMany: jest.fn().mockResolvedValue([{
      id: 7, name: 'Honda Plant', key: 'CES/0625/069', leadId: 1,
      members: [
        { employeeId: 1, role: 'PROJECT_MANAGER' },
        { employeeId: 2, role: 'MEMBER' },
        { employeeId: 3, role: 'TECHNICAL_ARCHITECT' },
      ],
    }]) },
    projectPhase: {
      findMany: jest.fn().mockResolvedValue([{ id: 11, name: 'Implementation' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    employee: { findMany: jest.fn().mockResolvedValue([
      { id: 1, firstName: 'Gaurav', lastName: 'Nogia', employeeCode: '20001', user: { email: 'gaurav@x.com' } },
      { id: 2, firstName: 'Ashish', lastName: 'Sharma', employeeCode: '20002', user: { email: 'ashish@x.com' } },
      { id: 3, firstName: 'Tara', lastName: 'Arch', employeeCode: '20003', user: { email: 'tara@x.com' } },
      { id: 9, firstName: 'Out', lastName: 'Sider', employeeCode: '20009', user: { email: 'out@x.com' } },
    ]) },
    issue: { findMany: jest.fn().mockResolvedValue([{ id: 500, projectId: 7 }]) },
  };
  const svc = new TaskTransferService(prisma, {} as any);
  const row = (o: Partial<Record<string, any>>) =>
    [...TEMPLATE_COLUMNS, 'Task ID'].map((c) => o[c] ?? '');

  it('accepts a valid new row', async () => {
    const r = await svc.preview(1, fileOf([row({
      'S.No': 1, 'Project Code': 'CES/0625/069', 'Task Name': 'Rack install', Phase: 'Implementation',
      'Assign Hours': 6, 'Assign to': 'ashish@x.com', 'SME / Govern': 'tara@x.com',
      'Start Date': '05/10/2026', 'End Date': '07/10/2026',
    })]));
    expect(r.rows[0]).toMatchObject({ ok: true, action: 'CREATE' });
  });

  it('flags someone who is not on the project', async () => {
    const r = await svc.preview(1, fileOf([row({
      'Project Code': 'CES/0625/069', 'Task Name': 'X', Phase: 'Implementation', 'Assign to': 'out@x.com',
    })]));
    expect(r.rows[0].ok).toBe(false);
    expect(r.rows[0].errors.join()).toMatch(/not on this project/);
  });

  it('flags an SME who is not the PM or Technical Architect', async () => {
    const r = await svc.preview(1, fileOf([row({
      'Project Code': 'CES/0625/069', 'Task Name': 'X', Phase: 'Implementation', 'SME / Govern': 'ashish@x.com',
    })]));
    expect(r.rows[0].errors.join()).toMatch(/PM or Technical Architect/);
  });

  it('flags an unknown project, unknown phase and a bad date', async () => {
    const r = await svc.preview(1, fileOf([row({
      'Project Code': 'NOPE', 'Task Name': 'X', Phase: 'Dreaming', 'Start Date': '31/31/2026',
    })]));
    const e = r.rows[0].errors.join(' | ');
    expect(e).toMatch(/Unknown project/);
    expect(e).toMatch(/Unknown phase/);
    expect(e).toMatch(/not a date/);
  });

  it('turns a row with an existing Task ID into an update', async () => {
    const r = await svc.preview(1, fileOf([row({
      'Project Code': 'CES/0625/069', 'Task Name': 'Renamed', 'Task ID': 500,
    })]));
    expect(r.rows[0]).toMatchObject({ ok: true, action: 'UPDATE' });
  });

  it('reads headers with stray spaces like the original template', async () => {
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([
      ['S.No', 'Project Name ', 'Project Code ', 'Task Name', 'Task Description ', 'Phase'],
      [1, 'Honda Plant', 'CES/0625/069', 'Survey', 'Walk the site', 'Implementation'],
    ]), 'task');
    const r = await svc.preview(1, xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(r.rows[0]).toMatchObject({ ok: true, title: 'Survey' });
  });
});
