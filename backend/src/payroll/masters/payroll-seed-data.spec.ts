import {
  RATE_VARIABLES, SEED_COMPONENTS, SEED_SALARY_GROUPS, SEED_STATUTORY_RATES, SEED_TAX_REGIMES,
} from './payroll-seed-data';

const FUNCTIONS = new Set(['MIN', 'MAX']);
const identifiers = (expr: string) => (expr.match(/[A-Z_][A-Z0-9_]*/g) || []).filter((t) => !FUNCTIONS.has(t));
const componentCodes = new Set(SEED_COMPONENTS.map((c) => c.code));
const rateCodes = new Set(SEED_STATUTORY_RATES.map((r) => r.code));

describe('payroll seed data', () => {
  it('has unique component codes', () => {
    expect(componentCodes.size).toBe(SEED_COMPONENTS.length);
  });

  it('keeps the employer share off the payslip but on the annexure and in CTC', () => {
    const employer = SEED_COMPONENTS.filter((c) => c.category === 'EMPLOYER_CONTRIBUTION');
    expect(employer.map((c) => c.code).sort()).toEqual(['EMPLOYER_ESI', 'EMPLOYER_PF']);
    for (const c of employer) {
      expect(c).toMatchObject({ showOnPayslip: false, showOnAnnexure: true, partOfCtc: true, partOfGross: false });
    }
  });

  it('keeps employee deductions out of CTC and gross', () => {
    for (const c of SEED_COMPONENTS.filter((c) => c.category === 'EMPLOYEE_DEDUCTION')) {
      expect(c).toMatchObject({ partOfCtc: false, partOfGross: false, showOnPayslip: true });
    }
  });

  it('points every rate variable at a seeded rate that has that field', () => {
    for (const [name, { code, field }] of Object.entries(RATE_VARIABLES)) {
      const rate = SEED_STATUTORY_RATES.find((r) => r.code === code);
      expect({ name, found: !!rate }).toEqual({ name, found: true });
      expect({ name, value: typeof rate![field] }).toEqual({ name, value: 'number' });
    }
  });

  describe.each(SEED_SALARY_GROUPS.map((g) => [g.code, g] as const))('group %s', (_code, group) => {
    it('uses only seeded components, each once', () => {
      const used = group.lines.map((l) => l.component);
      expect(used.filter((c) => !componentCodes.has(c))).toEqual([]);
      expect(new Set(used).size).toBe(used.length);
    });

    it('has exactly one balancing line', () => {
      expect(group.lines.filter((l) => l.calcType === 'BALANCING')).toHaveLength(1);
    });

    it('gives each line what its calc type needs', () => {
      for (const l of group.lines) {
        if (l.calcType === 'FIXED') expect({ c: l.component, amount: typeof l.amount }).toEqual({ c: l.component, amount: 'number' });
        if (l.calcType === 'FORMULA') expect({ c: l.component, formula: !!l.formula }).toEqual({ c: l.component, formula: true });
      }
    });

    it('only refers to CTC, rates, and components listed above the line', () => {
      const known = new Set(['CTC_MONTHLY', ...Object.keys(RATE_VARIABLES)]);
      for (const l of group.lines) {
        const refs = [...identifiers(l.formula || ''), ...identifiers(l.condition || '')];
        expect({ line: l.component, unknown: refs.filter((r) => !known.has(r)) }).toEqual({ line: l.component, unknown: [] });
        known.add(l.component);
      }
    });

    it('puts the employer share only on employee groups', () => {
      const hasEmployerShare = group.lines.some((l) => l.component.startsWith('EMPLOYER_'));
      expect(hasEmployerShare).toBe(group.payeeType === 'EMPLOYEE');
    });
  });

  it('seeds the rates the groups rely on', () => {
    for (const code of ['PF_EMPLOYEE', 'PF_EMPLOYER', 'ESI_EMPLOYEE', 'ESI_EMPLOYER', 'PT', 'BASIC_FLOOR']) {
      expect(rateCodes.has(code)).toBe(true);
    }
  });

  describe.each(SEED_TAX_REGIMES.map((t) => [t.code, t] as const))('tax regime %s', (_code, regime) => {
    it('has contiguous slabs from zero ending in an open top slab', () => {
      expect(regime.slabs[0].from).toBe(0);
      regime.slabs.slice(1).forEach((s, i) => expect(s.from).toBe(regime.slabs[i].to));
      expect(regime.slabs[regime.slabs.length - 1].to).toBeNull();
    });
  });

  it('defaults to exactly one regime', () => {
    expect(SEED_TAX_REGIMES.filter((t) => t.isDefault).map((t) => t.code)).toEqual(['NEW']);
  });
});
