import { applyLossOfPay } from './payroll-dry-run.service';

describe('applyLossOfPay', () => {
  const earnings = [
    { code: 'BASIC', name: 'Basic', monthly: 20000, reduceForLop: true },
    { code: 'TRAVEL_ALLOWANCE', name: 'Travel', monthly: 1600, reduceForLop: false },
  ];

  it('cuts only components marked "reduce for loss of pay", by absent ÷ working days', () => {
    const r = applyLossOfPay(earnings, 20, 2); // 10% absent
    expect(r.lines.find((l) => l.code === 'BASIC')!.paid).toBe(18000);
    expect(r.lines.find((l) => l.code === 'TRAVEL_ALLOWANCE')!.paid).toBe(1600);
    expect(r.lossOfPay).toBe(2000);
  });

  it('pays in full with no absences, and never cuts below zero', () => {
    expect(applyLossOfPay(earnings, 20, 0).lossOfPay).toBe(0);
    expect(applyLossOfPay(earnings, 20, 30).lines.find((l) => l.code === 'BASIC')!.paid).toBe(0);
  });
});
