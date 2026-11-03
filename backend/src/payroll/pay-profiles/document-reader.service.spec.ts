import { DocumentReaderService } from './document-reader.service';
import { detailState } from './pay-profiles.service';

describe('DocumentReaderService.extract — only well-formed values become suggestions', () => {
  const reader = new DocumentReaderService({} as any);

  it('takes a valid PAN, upper-cased, with the name as a note', () => {
    expect(reader.extract('PAN', { isPanCard: true, pan: 'abcde1234f', name: 'Ravi Kumar' }))
      .toEqual({ values: [{ field: 'PAN', value: 'ABCDE1234F' }], note: 'Name on card: Ravi Kumar' });
  });

  it('drops a PAN that is not in the PAN format, and anything that is not a PAN card', () => {
    expect(reader.extract('PAN', { isPanCard: true, pan: 'ABCDE12345' }).values).toEqual([]);
    expect(reader.extract('PAN', { isPanCard: false, pan: 'ABCDE1234F' }).values).toEqual([]);
  });

  it('takes a 12-digit UAN even with spaces, not a PF member id', () => {
    expect(reader.extract('UAN', { uan: '1002 0030 0400' }).values).toEqual([{ field: 'UAN', value: '100200300400' }]);
    expect(reader.extract('UAN', { uan: 'DLCPM00123450000012345' }).values).toEqual([]);
  });

  it('takes account number and IFSC, and the bank name only alongside them', () => {
    expect(reader.extract('BANK', { accountNumber: '50100 123456789', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' }).values).toEqual([
      { field: 'BANK_ACCOUNT', value: '50100123456789' },
      { field: 'IFSC', value: 'HDFC0001234' },
      { field: 'BANK_NAME', value: 'HDFC BANK' },
    ]);
    expect(reader.extract('BANK', { accountNumber: '12', ifsc: 'BAD', bankName: 'HDFC Bank' }).values).toEqual([]);
  });

  it('treats nulls as nothing found', () => {
    expect(reader.extract('UAN', { uan: null }).values).toEqual([]);
  });
});

describe('detailState', () => {
  it('ranks verified, suggested, typed, document-only, missing', () => {
    expect(detailState(true, new Date(), false, true)).toBe('VERIFIED');
    expect(detailState(true, null, true, true)).toBe('SUGGESTED');
    expect(detailState(true, null, false, true)).toBe('UNVERIFIED');
    expect(detailState(false, null, false, true)).toBe('DOCUMENT');
    expect(detailState(false, null, false, false)).toBe('MISSING');
  });
});
