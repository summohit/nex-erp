import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PayProfilesService, assertPayrollEditor, assertPayrollViewer, isPayrollEditor, payeeKind } from './pay-profiles.service';
import { ctcFromLetter } from './pay-profiles.service';

describe('PayProfilesService helpers', () => {
  const svc = new PayProfilesService({} as any, {} as any) as any;

  describe('who may do what', () => {
    it('lets Finance and admins edit, but not HR', () => {
      expect(isPayrollEditor('FINANCE')).toBe(true);
      expect(isPayrollEditor('ADMIN')).toBe(true);
      expect(isPayrollEditor('SUPERADMIN')).toBe(true);
      expect(isPayrollEditor('SUPER_ADMIN')).toBe(true);
      expect(isPayrollEditor('HR')).toBe(false);
      expect(() => assertPayrollEditor('HR')).toThrow(ForbiddenException);
    });

    it('lets HR view but not an ordinary employee', () => {
      expect(() => assertPayrollViewer('HR')).not.toThrow();
      expect(() => assertPayrollViewer('EMPLOYEE')).toThrow(ForbiddenException);
    });
  });

  it('reads older payee spellings as the current ones', () => {
    expect(payeeKind('INTERN')).toBe('TRAINEE');
    expect(payeeKind('CONTRACTOR')).toBe('CONSULTANT');
    expect(payeeKind('EMPLOYEE')).toBe('EMPLOYEE');
    expect(payeeKind(undefined)).toBe('EMPLOYEE');
  });

  describe('proposing a salary group', () => {
    const groups = [
      { code: 'REGULAR', name: 'Regular', payeeType: 'EMPLOYEE' },
      { code: 'REGULAR_PF_CAPPED', name: 'Capped', payeeType: 'EMPLOYEE' },
      { code: 'TRAINEE', name: 'Trainee', payeeType: 'INTERN' },
      { code: 'CONSULTANT_TECH', name: 'Consultant', payeeType: 'CONSULTANT' },
    ];
    const pick = (e: any) => svc.proposeGroup({ designation: null, employmentType: null, ...e }, groups)?.code;

    it('puts consultants on a consultant group', () => expect(pick({ payType: 'CONSULTANT' })).toBe('CONSULTANT_TECH'));
    it('spots trainees by employment type or designation', () => {
      expect(pick({ payType: 'EMPLOYEE', employmentType: 'Trainee' })).toBe('TRAINEE');
      expect(pick({ payType: 'EMPLOYEE', designation: { name: 'Software Intern' } })).toBe('TRAINEE');
    });
    it('defaults employees to the capped-PF group', () => expect(pick({ payType: 'EMPLOYEE' })).toBe('REGULAR_PF_CAPPED'));
  });

  it('finds the CTC whose gross matches today\'s gross', () => {
    // A toy engine: gross is 95% of monthly CTC.
    const run = (annual: number) => ({ grossMonthly: Math.round((annual / 12) * 0.95 * 100) / 100 });
    const ctc = svc.solveCtc(run, 47500);
    expect(Math.abs(run(ctc).grossMonthly - 47500)).toBeLessThanOrEqual(1);
    expect(ctc).toBeCloseTo(600000, -2);
  });

  describe('statutory details', () => {
    it('accepts valid PAN, UAN and IFSC, upper-cased', () => {
      expect(svc.cleanStatutory({ panNumber: 'abcde1234f', uanNumber: '100200300400', ifscCode: 'hdfc0001234' }))
        .toEqual({ panNumber: 'ABCDE1234F', uanNumber: '100200300400', ifscCode: 'HDFC0001234' });
    });
    it('rejects malformed ones', () => {
      expect(() => svc.cleanStatutory({ panNumber: 'ABC123' })).toThrow(BadRequestException);
      expect(() => svc.cleanStatutory({ uanNumber: '12345' })).toThrow(BadRequestException);
      expect(() => svc.cleanStatutory({ ifscCode: 'HDFC1234' })).toThrow(BadRequestException);
    });
    it('clears a field sent as empty, and ignores fields not sent', () => {
      expect(svc.cleanStatutory({ panNumber: '' })).toEqual({ panNumber: null });
      expect(svc.cleanStatutory({})).toBeNull();
    });
  });

  describe('component overrides', () => {
    const group = {
      lines: [
        { component: { code: 'TRAVEL_ALLOWANCE' }, overrideAllowed: true },
        { component: { code: 'BASIC' }, overrideAllowed: false },
      ],
    };
    it('keeps allowed overrides', () => expect(svc.cleanOverrides({ TRAVEL_ALLOWANCE: 2000 }, group)).toEqual({ TRAVEL_ALLOWANCE: 2000 }));
    it('refuses a component that can\'t be overridden or isn\'t in the group', () => {
      expect(() => svc.cleanOverrides({ BASIC: 1 }, group)).toThrow(BadRequestException);
      expect(() => svc.cleanOverrides({ HRA: 1 }, group)).toThrow(BadRequestException);
    });
    it('treats an empty set as no overrides', () => expect(svc.cleanOverrides({ TRAVEL_ALLOWANCE: '' as any }, group)).toBeNull());
  });
});

describe('ctcFromLetter', () => {
  it('reads the CTC from a generated offer letter', () => {
    expect(ctcFromLetter('<p>Your Total emoluments are <b>INR 12,00,000 /- CTC</b>. based on</p>')).toBe(1200000);
    expect(ctcFromLetter('Your Total emoluments are&nbsp; INR 4,63,200 /- CTC .')).toBe(463200);
  });
  it('ignores letters without a plausible annual amount', () => {
    expect(ctcFromLetter('<p>Welcome aboard</p>')).toBeNull();
    expect(ctcFromLetter('INR 500 /- CTC')).toBeNull();
  });
});
