import { CrmService } from './crm.service';

/**
 * Replaces the generated boilerplate, which supplied no providers and could
 * never compile.
 *
 * The one thing worth pinning here is the shape of the lead-detail include:
 * `quotations: true` returns the quotation scalars and none of its relations,
 * which is why reopening a proposal to edit it came up with an empty line-items
 * table. The proposal form reads lead.quotations[].items, so that include is
 * part of the contract, not an optimisation.
 */
describe('CrmService.getLeadById', () => {
  const COMPANY = 1;
  const ADMIN = { role: 'SUPERADMIN' as const, employeeId: null };

  let prisma: any;
  let service: CrmService;

  beforeEach(() => {
    prisma = { lead: { findFirst: jest.fn(async () => ({ id: 7, addedById: null, assignedToId: null })) } };
    service = new CrmService(prisma, {} as any, {} as any);
  });

  const include = () => prisma.lead.findFirst.mock.calls[0][0].include;

  it('loads each quotation with its line items and attachments', async () => {
    await service.getLeadById(COMPANY, 7, ADMIN);
    expect(include().quotations.include.items).toEqual({ orderBy: { id: 'asc' } });
    expect(include().quotations.include.attachments).toBe(true);
  });

  it('scopes the lookup to the caller\'s company', async () => {
    await service.getLeadById(COMPANY, 7, ADMIN);
    expect(prisma.lead.findFirst.mock.calls[0][0].where).toEqual({ id: 7, companyId: COMPANY });
  });

  it('reports a lead from another company as missing, not as forbidden', async () => {
    prisma.lead.findFirst.mockResolvedValueOnce(null);
    await expect(service.getLeadById(COMPANY, 7, ADMIN)).rejects.toThrow('Lead not found');
  });
});

/**
 * Format only, by design: presence of an email is a form rule (see
 * leads.ts), because a lead created without one still spawns its contact and
 * twelve contacts predate the rule entirely. What the API refuses is a value
 * that is present and malformed.
 */
describe('CrmService — lead contact email and phone formats', () => {
  const COMPANY = 1;
  let prisma: any;
  let service: CrmService;

  beforeEach(() => {
    prisma = {
      employee: { findFirst: jest.fn(async () => null) },
      leadContact: {
        findFirst: jest.fn(async () => ({ id: 3, companyId: COMPANY })),
        update: jest.fn(async (args: any) => ({ id: 3, name: 'Contact', ...args.data })),
      },
      // Touched after the write: the contact is the source of truth for the
      // contact fields on every deal it brought in.
      lead: { updateMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
    };
    service = new CrmService(prisma, {} as any, {} as any);
  });

  const update = (data: any) => service.updateLeadContact(COMPANY, 3, data);

  it.each([
    ['john@example.com'],
    ['first.last+tag@sub.example.co.uk'],
  ])('accepts %s', async (email) => {
    await expect(update({ email })).resolves.toBeDefined();
  });

  it.each([
    ['plainstring'],
    ['no-at-sign.com'],
    ['two@@example.com'],
    ['spaces in@example.com'],
    ['missing@tld'],
  ])('rejects %s', async (email) => {
    await expect(update({ email })).rejects.toThrow(/not a valid email/);
  });

  // People paste numbers with punctuation; that must not be a fight.
  it.each([
    ['9810891437'],
    ['+91 98108-91437'],
    ['(011) 4155 5555'],
  ])('accepts the phone %s', async (phone) => {
    await expect(update({ phone })).resolves.toBeDefined();
  });

  it.each([
    ['12345'],
    ['98108914371234567'],
    ['call me'],
  ])('rejects the phone %s', async (phone) => {
    await expect(update({ phone })).rejects.toThrow(/10 to 15 digits/);
  });

  it('checks every phone field, not just the first', async () => {
    await expect(update({ mobile: '123' })).rejects.toThrow(/Primary phone number/);
    await expect(update({ officePhoneNumber: '123' })).rejects.toThrow(/Secondary phone number/);
  });

  // Blank is how the form says "not supplied" and must stay writable, or the
  // twelve contacts with no email become uneditable.
  it('accepts blank values', async () => {
    await expect(update({ email: '', phone: '', mobile: null })).resolves.toBeDefined();
  });
});

