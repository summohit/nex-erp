import { ProfileCompletenessService } from './profile-completeness.service';
import { REQUIRED_DOCUMENTS, PREVIOUS_EMPLOYMENT_DOCUMENTS } from './profile-documents';

const docs = (types: readonly string[]) => types.map((documentType) => ({ documentType }));
const full = {
  id: 1, firstName: 'A', lastName: 'B', employeeCode: 'E1',
  phone: '9999999999', gender: 'Male', dateOfBirth: new Date('1995-01-01'), address: 'Noida',
  employmentType: 'Full Time', firstJob: false,
  user: { email: 'a@ces-pl.com', status: 'ACTIVE' }, designation: { name: 'Engineer' }, department: { name: 'Delivery' },
  manager: null, emergencyContacts: [{ id: 1 }],
  documents: docs([...REQUIRED_DOCUMENTS, ...PREVIOUS_EMPLOYMENT_DOCUMENTS]),
};
function service(emp: any) {
  const prisma: any = { employee: { findFirst: jest.fn(async () => emp), findMany: jest.fn(async () => [emp]), updateMany: jest.fn() }, systemSetting: { findUnique: jest.fn(async () => null) } };
  return new ProfileCompletenessService(prisma);
}

describe('profile completeness', () => {
  it('is complete with every document, details and an emergency contact', async () => {
    expect(await service(full).mine(1, 1)).toMatchObject({ complete: true, missing: [] });
  });

  it('lists what is missing, documents uploaded as Other do not count', async () => {
    const c = await service({ ...full, documents: [...docs(['PAN Card']), { documentType: 'Other' }] }).mine(1, 1);
    expect(c!.complete).toBe(false);
    expect(c!.missing.map((m) => m.key)).toContain('Aadhaar Card');
    expect(c!.missing.map((m) => m.key)).not.toContain('PAN Card');
    expect(c!.uploadedAsOther).toBe(1);
  });

  it('asks interns and first-jobbers for no previous-employment documents', async () => {
    const base = { ...full, documents: docs(REQUIRED_DOCUMENTS) };
    expect((await service({ ...base, employmentType: 'Internship' }).mine(1, 1))!.complete).toBe(true);
    expect((await service({ ...base, firstJob: true }).mine(1, 1))!.complete).toBe(true);
    expect((await service(base).mine(1, 1))!.missing.map((m) => m.key)).toEqual(['UAN', 'Relieving / Experience Letter', 'Payslips']);
  });

  it('needs personal details and an emergency contact', async () => {
    const c = await service({ ...full, address: '', emergencyContacts: [] }).mine(1, 1);
    expect(c!.missing.map((m) => m.key)).toEqual(['personal-details', 'emergency-contact']);
  });

  it('never reminds the exempt accounts', async () => {
    const c = await service({ ...full, documents: [], user: { email: 'HR@ces-pl.com' } }).mine(1, 1);
    expect(c).toMatchObject({ exempt: true, complete: true, missing: [] });
  });
});
