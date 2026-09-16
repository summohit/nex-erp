import { ProjectsService } from './projects.service';

/**
 * The project form sends a LEAD CONTACT, and the server turns it into the
 * Client the project is saved against. The case worth pinning down is the
 * "Internal Project (No Client)" option, which must land as a genuine null
 * rather than silently keeping whatever client was there before.
 */
function makeService() {
  const prisma: any = {};
  const crm: any = {
    findOrCreateClientFromLeadContact: jest.fn().mockResolvedValue({ id: 42, name: 'Prasar Bharti' }),
  };
  const service = new ProjectsService(prisma, crm);
  return { service, crm };
}

const resolve = (service: any, data: any) => service['resolveClientId'](1, data);

describe('Internal Project (No Client)', () => {
  it('resolves to null, so the project is saved with no client', async () => {
    const { service, crm } = makeService();

    // Exactly what the form sends after picking "Internal Project (No Client)".
    await expect(resolve(service, { leadContactId: null })).resolves.toBeNull();
    expect(crm.findOrCreateClientFromLeadContact).not.toHaveBeenCalled();
  });

  // On edit this is the difference between "clear the client" and "leave it
  // alone". Undefined must not be read as a request to clear.
  it('leaves the client untouched when the payload mentions neither field', async () => {
    const { service } = makeService();
    await expect(resolve(service, { name: 'Renamed project' })).resolves.toBeUndefined();
  });
});

describe('picking a contact', () => {
  it('resolves to the client that contact maps to', async () => {
    const { service, crm } = makeService();

    await expect(resolve(service, { leadContactId: 7 })).resolves.toBe(42);
    expect(crm.findOrCreateClientFromLeadContact).toHaveBeenCalledWith(1, 7);
  });

  it('accepts the id as a string, as a form sends it', async () => {
    const { service, crm } = makeService();

    await expect(resolve(service, { leadContactId: '7' })).resolves.toBe(42);
    expect(crm.findOrCreateClientFromLeadContact).toHaveBeenCalledWith(1, 7);
  });
});

describe('clientId still works when sent directly', () => {
  // Imports and the AI onboarding flow pass a client, not a contact.
  it('honours an explicit clientId', async () => {
    const { service } = makeService();
    await expect(resolve(service, { clientId: 9 })).resolves.toBe(9);
  });

  it('treats an explicit empty clientId as clearing it', async () => {
    const { service } = makeService();
    await expect(resolve(service, { clientId: null })).resolves.toBeNull();
  });

  // A contact wins: it is the field the form actually presents.
  it('prefers the lead contact when both are sent', async () => {
    const { service } = makeService();
    await expect(resolve(service, { leadContactId: 7, clientId: 9 })).resolves.toBe(42);
  });
});
