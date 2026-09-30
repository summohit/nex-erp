/**
 * The standard Indian split of a monthly gross, and the grade a gross falls in.
 *
 * Pure: no database, so the arithmetic that sets people's pay can be tested on
 * its own. PayrollService maps the lines onto the company's components.
 */

export interface SalaryTemplateRules {
  basicPct: number; // % of gross
  hraPctOfBasic: number; // % of Basic
  conveyance: number; // fixed, monthly
  medical: number; // fixed, monthly
  pfPct: number; // % of (capped) Basic
  pfWageCap: number | null; // PF is worked on Basic up to this
  esiPct: number; // % of gross
  esiGrossLimit: number; // ESI applies at or below this gross
  professionalTax: number; // monthly
}

export const DEFAULT_TEMPLATE: SalaryTemplateRules = {
  basicPct: 50,
  hraPctOfBasic: 40,
  conveyance: 1600,
  medical: 1250,
  pfPct: 12,
  pfWageCap: 15000,
  esiPct: 0.75,
  esiGrossLimit: 21000,
  professionalTax: 200,
};

/** Which line of the split this is -- matched to a SalaryComponent by name. */
export type TemplateLine =
  | 'BASIC' | 'HRA' | 'CONVEYANCE' | 'MEDICAL' | 'SPECIAL'
  | 'PF' | 'ESI' | 'PT';

export interface TemplateSplitLine {
  line: TemplateLine;
  type: 'EARNING' | 'DEDUCTION';
  amount: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Split a monthly gross.
 *
 * Earnings always add up to exactly the gross: Special Allowance is the
 * balance. When the fixed allowances would push past the gross (a very small
 * salary), they are trimmed rather than Special going negative.
 */
export function splitGross(gross: number, rules: SalaryTemplateRules): TemplateSplitLine[] {
  const g = Math.max(0, round(gross));
  const basic = round((g * rules.basicPct) / 100);
  const hra = round((basic * rules.hraPctOfBasic) / 100);

  let left = round(g - basic - hra);
  const conveyance = Math.min(rules.conveyance, Math.max(0, left));
  left = round(left - conveyance);
  const medical = Math.min(rules.medical, Math.max(0, left));
  const special = Math.max(0, round(left - medical));

  const pfBase = rules.pfWageCap == null ? basic : Math.min(basic, rules.pfWageCap);
  const pf = round((pfBase * rules.pfPct) / 100);
  const esi = g > 0 && g <= rules.esiGrossLimit ? Math.ceil((g * rules.esiPct) / 100) : 0;

  const lines: TemplateSplitLine[] = [
    { line: 'BASIC', type: 'EARNING', amount: basic },
    { line: 'HRA', type: 'EARNING', amount: hra },
    { line: 'CONVEYANCE', type: 'EARNING', amount: conveyance },
    { line: 'MEDICAL', type: 'EARNING', amount: medical },
    { line: 'SPECIAL', type: 'EARNING', amount: special },
    { line: 'PF', type: 'DEDUCTION', amount: pf },
    { line: 'ESI', type: 'DEDUCTION', amount: esi },
    { line: 'PT', type: 'DEDUCTION', amount: g > 0 ? rules.professionalTax : 0 },
  ];
  return lines;
}

/** Component names each line may already exist under, most specific first. */
export const LINE_COMPONENT_NAMES: Record<TemplateLine, { create: string; aliases: string[] }> = {
  BASIC: { create: 'Basic Salary', aliases: ['basic salary', 'basic'] },
  HRA: { create: 'House Rent Allowance (HRA)', aliases: ['house rent allowance (hra)', 'hra', 'house rent allowance'] },
  CONVEYANCE: { create: 'Conveyance Allowance', aliases: ['conveyance allowance', 'travel allowance', 'conveyance'] },
  MEDICAL: { create: 'Medical Allowance', aliases: ['medical allowance', 'medical'] },
  SPECIAL: { create: 'Special Allowance', aliases: ['special allowance'] },
  PF: { create: 'Provident Fund (PF)', aliases: ['provident fund (pf)', 'pf', 'provident fund'] },
  ESI: { create: 'Employee State Insurance (ESI)', aliases: ['employee state insurance (esi)', 'esi'] },
  PT: { create: 'Professional Tax', aliases: ['professional tax', 'pt'] },
};

export interface GradeBand {
  id: number;
  name: string;
  label?: string | null;
  minGross: number;
  maxGross: number | null;
}

/** The band a gross falls in, or null when none covers it. */
export function gradeFor(gross: number, grades: GradeBand[]): GradeBand | null {
  if (!(gross > 0)) return null;
  return grades.find((g) => gross >= g.minGross && (g.maxGross == null || gross <= g.maxGross)) ?? null;
}
