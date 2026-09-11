import { SystemSettingsService } from './system-settings.service';

/**
 * updateSettings is an explicit allow-list in three places — the controller
 * body, this service, and the client's save payload. A field missing from any
 * one of them is silently dropped, which is exactly how quotationTerms appeared
 * to save and then reverted.
 *
 * These tests cover the half that lives here: a field that IS sent must persist,
 * and a PUT that omits it must leave the stored value alone rather than wiping
 * it to null.
 */
describe('SystemSettingsService.updateSettings', () => {
  const COMPANY = 1;
  let prisma: any;
  let service: SystemSettingsService;

  beforeEach(() => {
    prisma = { systemSetting: { upsert: jest.fn(async ({ update }: any) => update) } };
    service = new SystemSettingsService(prisma);
  });

  const updateArg = () => prisma.systemSetting.upsert.mock.calls[0][0].update;

  it('persists quotation terms that are sent', async () => {
    const terms = '1. Validity.\n2. Payment Terms.';
    await service.updateSettings(COMPANY, { quotationTerms: terms });
    expect(updateArg().quotationTerms).toBe(terms);
  });

  // The bug this guards: a save that omits the field must not blank it.
  it('leaves stored terms untouched when the field is omitted', async () => {
    await service.updateSettings(COMPANY, { shiftRosterVisibleToEmployees: true });
    expect(updateArg()).not.toHaveProperty('quotationTerms');
  });

  // Explicit null is how the UI says "go back to the built-in defaults", and it
  // has to be distinguishable from "not sent".
  it('accepts an explicit null as a reset to the built-in defaults', async () => {
    await service.updateSettings(COMPANY, { quotationTerms: null });
    expect(updateArg()).toHaveProperty('quotationTerms', null);
  });

  it('applies the same omission rule to the other guarded fields', async () => {
    await service.updateSettings(COMPANY, { quotationTerms: 'x' });
    expect(updateArg()).not.toHaveProperty('twoFactorRequired');
    expect(updateArg()).not.toHaveProperty('defaultTicketAssigneeId');
  });

  it('persists the quotation signatory name and signature image', async () => {
    await service.updateSettings(COMPANY, {
      quotationSignatoryName: 'N-Expert Solutions Private Limited',
      quotationSignatureUrl: 'https://ik.imagekit.io/x/sign.png',
    });
    expect(updateArg().quotationSignatoryName).toBe('N-Expert Solutions Private Limited');
    expect(updateArg().quotationSignatureUrl).toBe('https://ik.imagekit.io/x/sign.png');
  });

  it('clears the signature when an explicit null is sent', async () => {
    await service.updateSettings(COMPANY, { quotationSignatureUrl: null });
    expect(updateArg()).toHaveProperty('quotationSignatureUrl', null);
  });

  it('leaves the signatory alone when the fields are omitted', async () => {
    await service.updateSettings(COMPANY, { quotationTerms: 'x' });
    expect(updateArg()).not.toHaveProperty('quotationSignatoryName');
    expect(updateArg()).not.toHaveProperty('quotationSignatureUrl');
  });
});
