import { DEFAULT_TEMPLATE, gradeFor, splitGross } from './salary-template';

const amount = (lines: ReturnType<typeof splitGross>, line: string) =>
  lines.find((l) => l.line === line)!.amount;
const earnings = (lines: ReturnType<typeof splitGross>) =>
  lines.filter((l) => l.type === 'EARNING').reduce((t, l) => t + l.amount, 0);

describe('salary template — splitting a gross', () => {
  it('splits ₹40,000: Basic 50%, HRA 40% of Basic, Special the balance', () => {
    const lines = splitGross(40000, DEFAULT_TEMPLATE);
    expect(amount(lines, 'BASIC')).toBe(20000);
    expect(amount(lines, 'HRA')).toBe(8000);
    expect(amount(lines, 'CONVEYANCE')).toBe(1600);
    expect(amount(lines, 'MEDICAL')).toBe(1250);
    expect(amount(lines, 'SPECIAL')).toBe(9150);
    expect(earnings(lines)).toBe(40000);
  });

  it('caps PF at 12% of ₹15,000 and charges no ESI above ₹21,000', () => {
    const lines = splitGross(40000, DEFAULT_TEMPLATE);
    expect(amount(lines, 'PF')).toBe(1800);
    expect(amount(lines, 'ESI')).toBe(0);
    expect(amount(lines, 'PT')).toBe(200);
  });

  it('charges ESI at or below ₹21,000, rounded up', () => {
    const lines = splitGross(14000, DEFAULT_TEMPLATE);
    expect(amount(lines, 'ESI')).toBe(105);
    expect(amount(lines, 'PF')).toBe(840); // 12% of 7,000 Basic
  });

  it('works PF on the full Basic when there is no cap', () => {
    const lines = splitGross(40000, { ...DEFAULT_TEMPLATE, pfWageCap: null });
    expect(amount(lines, 'PF')).toBe(2400);
  });

  it('trims the fixed allowances rather than letting Special go negative', () => {
    const lines = splitGross(4000, DEFAULT_TEMPLATE);
    expect(amount(lines, 'SPECIAL')).toBe(0);
    expect(earnings(lines)).toBe(4000);
  });

  it.each([7000, 17500, 28000, 43000, 266666.67, 1037500])('earnings always add up to the gross (₹%s)', (g) => {
    expect(Math.round(earnings(splitGross(g, DEFAULT_TEMPLATE)) * 100) / 100).toBe(g);
  });
});

describe('salary template — grades', () => {
  const grades = [
    { id: 1, name: 'G1', minGross: 0, maxGross: 15000 },
    { id: 2, name: 'G2', minGross: 15001, maxGross: 30000 },
    { id: 3, name: 'G3', minGross: 30001, maxGross: 60000 },
    { id: 4, name: 'G4', minGross: 60001, maxGross: 150000 },
    { id: 5, name: 'G5', minGross: 150001, maxGross: null },
  ];

  it.each([
    [7000, 'G1'], [15000, 'G1'], [15001, 'G2'], [28000, 'G2'],
    [43000, 'G3'], [87500, 'G4'], [150000, 'G4'], [266666.67, 'G5'],
  ])('₹%s is %s', (gross, name) => {
    expect(gradeFor(gross as number, grades)?.name).toBe(name);
  });

  it('has no grade without a salary', () => {
    expect(gradeFor(0, grades)).toBeNull();
  });
});
