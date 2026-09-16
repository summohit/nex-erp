import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { CrmService } from './crm.service';

/**
 * §4: the project form picks a LEAD CONTACT, and the server turns it into the
 * Client the project is saved against.
 *
 * The distinction that matters is between the two callers. The CRM's Convert
 * button is an explicit "make this a client" and must complain if one already
 * exists; the project form's implicit conversion must quietly attach to it,
 * because opening a second project for the same customer is ordinary.
 */
const CONTACT = {
  id: 7,
  name: 'Priya Sharma',
  companyName: 'Acme Ltd',
  email: 'priya@acme.example',
  phone: '9000000000',
  mobile: null,
  website: 'acme.example',
  address: '1 Road',
  city: 'Gurgaon',
  state: 'HR',
  postalCode: '122001',
  country: 'India',
};

function makeService(over: any = {}) {
  const prisma: any = {
    leadContact: { findFirst: jest.fn().mockResolvedValue(CONTACT) },
    client: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 99, ...data })),
    },
    ...over,
  };
  return { service: new CrmService(prisma, {} as any, {} as any), prisma };
}

describe('findOrCreateClientFromLeadContact', () => {
  it('creates a client named after the contact company', async () => {
    const { service, prisma } = makeService();

    const client = await service.findOrCreateClientFromLeadContact(1, 7);

    expect(client.id).toBe(99);
    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Acme Ltd', status: 'LEAD' }) }),
    );
  });

  // The behaviour the project form depends on.
  it('returns the existing client instead of creating a second one', async () => {
    const { service, prisma } = makeService();
    prisma.client.findFirst.mockResolvedValue({ id: 42, name: 'Acme Ltd' });

    const client = await service.findOrCreateClientFromLeadContact(1, 7);

    expect(client.id).toBe(42);
    expect(prisma.client.create).not.toHaveBeenCalled();
  });

  it('falls back to the person name when there is no company', async () => {
    const { service, prisma } = makeService();
    prisma.leadContact.findFirst.mockResolvedValue({ ...CONTACT, companyName: null });

    await service.findOrCreateClientFromLeadContact(1, 7);

    expect(prisma.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Priya Sharma' }) }),
    );
  });

  it('carries the contact across as the client primary contact', async () => {
    const { service, prisma } = makeService();

    await service.findOrCreateClientFromLeadContact(1, 7);

    const data = prisma.client.create.mock.calls[0][0].data;
    expect(data.contacts.create[0]).toEqual(
      expect.objectContaining({ firstName: 'Priya', lastName: 'Sharma', email: 'priya@acme.example', isPrimary: true }),
    );
  });

  it('creates no contact row when there is no email to put on it', async () => {
    const { service, prisma } = makeService();
    prisma.leadContact.findFirst.mockResolvedValue({ ...CONTACT, email: null });

    await service.findOrCreateClientFromLeadContact(1, 7);

    expect(prisma.client.create.mock.calls[0][0].data.contacts).toBeUndefined();
  });

  it('refuses a contact with neither a company nor a name', async () => {
    const { service, prisma } = makeService();
    prisma.leadContact.findFirst.mockResolvedValue({ ...CONTACT, companyName: '  ', name: '' });

    await expect(service.findOrCreateClientFromLeadContact(1, 7)).rejects.toThrow(BadRequestException);
  });

  it('404s for a contact in another company', async () => {
    const { service, prisma } = makeService();
    prisma.leadContact.findFirst.mockResolvedValue(null);

    await expect(service.findOrCreateClientFromLeadContact(1, 7)).rejects.toThrow(NotFoundException);
  });
});

describe('convertLeadContactToClient still conflicts', () => {
  // The CRM button is explicit. Silently handing back an existing client would
  // look like it had done nothing at all.
  it('rejects when a client of that name already exists', async () => {
    const { service, prisma } = makeService();
    prisma.client.findFirst.mockResolvedValue({ id: 42, name: 'Acme Ltd' });

    await expect(service.convertLeadContactToClient(1, 7)).rejects.toThrow(ConflictException);
  });
});

describe('getLeadContactOptions', () => {
  // Not scoped to contacts the viewer added, unlike the CRM board's own list:
  // a project manager must be able to say who a project is for.
  it('returns identity only, unscoped within the company', async () => {
    const { service, prisma } = makeService({
      leadContact: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    });

    await service.getLeadContactOptions(1);

    const args = prisma.leadContact.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ companyId: 1 });
    expect(Object.keys(args.select).sort()).toEqual(
      ['companyName', 'contactCode', 'email', 'id', 'name'],
    );
  });
});
