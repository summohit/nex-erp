import { oldDeductionPiece, oldPay } from './payroll-compare.service';

const line = (name: string, type: 'EARNING' | 'DEDUCTION', amount: number) => ({ amount, component: { name, type } });

describe('oldPay — the current monthly run, itemised', () => {
  it('adds PF, PT and 10% TDS above ₹50k when the set-up has no such lines', () => {
    const b = oldPay([line('Basic Salary', 'EARNING', 50000), line('Special Allowance', 'EARNING', 50000)])!;
    expect(b.gross).toBe(100000);
    expect(b.pf).toBe(6000); // 12% of Basic
    expect(b.esi).toBe(0); // gross above ₹21,000
    expect(b.pt).toBe(200);
    expect(b.tds).toBe(5000); // 10% of (1,00,000 − 50,000)
    expect(b.net).toBe(100000 - 6000 - 200 - 5000);
  });

  it('uses the set-up\'s own deduction lines instead of the built-in ones', () => {
    const b = oldPay([line('Basic Salary', 'EARNING', 10000), line('HRA', 'EARNING', 6000), line('Provident Fund (PF)', 'DEDUCTION', 1200)])!;
    expect(b.pf).toBe(1200);
    expect(b.esi).toBe(Math.round(16000 * 0.0075)); // gross ≤ ₹21,000
    expect(b.pt).toBe(200);
    expect(b.tds).toBe(0);
  });

  it('treats a set-up with no earnings as no salary', () => {
    expect(oldPay([])).toBeNull();
  });
});

describe('oldDeductionPiece', () => {
  it('sorts free-text deduction names into PF / ESI / PT / TDS / other', () => {
    expect(oldDeductionPiece('Provident Fund (PF)')).toBe('pf');
    expect(oldDeductionPiece('Employee State Insurance (ESI)')).toBe('esi');
    expect(oldDeductionPiece('Professional Tax')).toBe('pt');
    expect(oldDeductionPiece('TDS 2% (Technical Consultant)')).toBe('tds');
    expect(oldDeductionPiece('Canteen')).toBe('other');
  });
});
