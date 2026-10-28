/**
 * Seeds the payroll engine masters (statutory rates, components, salary
 * groups, tax regimes) for one company from Finance's workbook — see
 * src/payroll/masters/payroll-seed-data.ts. Phase 1, Task 1.2.
 *
 *   npx ts-node prisma/seed-payroll-masters.ts --company 1            # preview only
 *   npx ts-node prisma/seed-payroll-masters.ts --company 1 --apply    # write
 *
 * Only creates what is missing. Anything that already exists is left exactly
 * as it is — Finance's edits in the UI always win over this file — so it is
 * safe to run again. Every row created is written to PayrollAuditLog.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import {
  SEED_COMPONENTS, SEED_EFFECTIVE_FROM, SEED_FINANCIAL_YEAR, SEED_SALARY_GROUPS,
  SEED_SOURCE, SEED_STATUTORY_RATES, SEED_TAX_REGIMES,
} from '../src/payroll/masters/payroll-seed-data';

dotenv.config();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const companyArg = args[args.indexOf('--company') + 1];
const companyId = args.includes('--company') ? Number(companyArg) : NaN;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const effectiveFrom = new Date(`${SEED_EFFECTIVE_FROM}T00:00:00.000Z`);
const REASON = `Seeded from ${SEED_SOURCE}`;
const summary: string[] = [];

async function audit(entity: string, entityId: number, after: unknown) {
  await prisma.payrollAuditLog.create({
    data: { companyId, entity, entityId, action: 'CREATE', after: after as any, reason: REASON },
  });
}

/** Run `create` only when `existing` found nothing, and only with --apply. */
async function ensure<T extends { id: number }>(
  label: string, entity: string, existing: T | null, create: () => Promise<T>,
): Promise<T | null> {
  if (existing) { summary.push(`  = ${label} (exists, left alone)`); return existing; }
  if (!apply) { summary.push(`  + ${label} (would create)`); return null; }
  const row = await create();
  await audit(entity, row.id, row);
  summary.push(`  + ${label} (created #${row.id})`);
  return row;
}

async function seedRates() {
  summary.push('Statutory rates');
  for (const r of SEED_STATUTORY_RATES) {
    // stateCode may be null, which a compound unique cannot match on — look it up.
    const existing = await prisma.payrollStatutoryRate.findFirst({
      where: { companyId, code: r.code, stateCode: r.stateCode, effectiveFrom },
    });
    await ensure(`${r.code}${r.stateCode ? ` [${r.stateCode}]` : ''}`, 'PayrollStatutoryRate', existing, () =>
      prisma.payrollStatutoryRate.create({
        data: {
          companyId, code: r.code, stateCode: r.stateCode, ratePct: r.ratePct ?? null,
          wageCeiling: r.wageCeiling ?? null, eligibilityLimit: r.eligibilityLimit ?? null,
          fixedAmount: r.fixedAmount ?? null, notes: r.notes, effectiveFrom,
        },
      }));
  }
}

async function seedComponents(): Promise<Map<string, number>> {
  summary.push('Components');
  const ids = new Map<string, number>();
  for (const c of SEED_COMPONENTS) {
    const existing = await prisma.payrollComponent.findUnique({ where: { companyId_code: { companyId, code: c.code } } });
    const row = await ensure(c.code, 'PayrollComponent', existing, () =>
      prisma.payrollComponent.create({ data: { ...c, companyId, isSystem: true } }));
    if (row) ids.set(c.code, row.id);
  }
  return ids;
}

async function seedGroups(componentIds: Map<string, number>) {
  summary.push('Salary groups');
  for (const g of SEED_SALARY_GROUPS) {
    // Any version of the group counts: Finance may already have moved it on.
    const existing = await prisma.payrollSalaryGroup.findFirst({ where: { companyId, code: g.code }, orderBy: { version: 'desc' } });
    await ensure(`${g.code} v1 — ${g.lines.length} lines (sheet "${g.sheet}")`, 'PayrollSalaryGroup', existing, () =>
      prisma.payrollSalaryGroup.create({
        data: {
          companyId, code: g.code, version: 1, name: g.name, description: g.description,
          payeeType: g.payeeType, flatTdsPct: g.flatTdsPct ?? null, gstApplicable: g.gstApplicable ?? false,
          effectiveFrom,
          lines: {
            create: g.lines.map((l, i) => {
              const componentId = componentIds.get(l.component);
              if (!componentId) throw new Error(`${g.code}: component ${l.component} is not seeded`);
              return {
                componentId, calcType: l.calcType, amount: l.amount ?? null, formula: l.formula ?? null,
                condition: l.condition ?? null, overrideAllowed: l.overrideAllowed ?? false, displayOrder: (i + 1) * 10,
              };
            }),
          },
        },
      }));
  }
}

async function seedTaxRegimes() {
  summary.push(`Tax regimes (FY ${SEED_FINANCIAL_YEAR})`);
  for (const t of SEED_TAX_REGIMES) {
    const existing = await prisma.payrollTaxRegime.findUnique({
      where: { companyId_code_financialYear: { companyId, code: t.code, financialYear: SEED_FINANCIAL_YEAR } },
    });
    await ensure(`${t.code} — ${t.slabs.length} slabs, ${t.sections.length} sections`, 'PayrollTaxRegime', existing, () =>
      prisma.payrollTaxRegime.create({
        data: {
          companyId, code: t.code, financialYear: SEED_FINANCIAL_YEAR, name: t.name,
          standardDeduction: t.standardDeduction, rebateIncomeLimit: t.rebateIncomeLimit,
          rebateMaxAmount: t.rebateMaxAmount, cessPct: t.cessPct, surcharge: t.surcharge, isDefault: t.isDefault,
          slabs: { create: t.slabs.map((s, i) => ({ fromAmount: s.from, toAmount: s.to, ratePct: s.ratePct, position: i + 1 })) },
          sections: {
            create: t.sections.map((s, i) => ({
              code: s.code, name: s.name, maxLimit: s.maxLimit, proofRequired: s.proofRequired ?? true, position: i + 1,
            })),
          },
        },
      }));
  }
}

async function main() {
  const host = (process.env.DATABASE_URL || '').replace(/.*@/, '').replace(/\?.*/, '');
  if (!Number.isInteger(companyId) || companyId <= 0) {
    const companies = await prisma.company.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } });
    console.log(`Pass --company <id>. Companies on ${host}:`);
    companies.forEach((c) => console.log(`  ${c.id}  ${c.name}`));
    process.exitCode = 1;
    return;
  }
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  if (!company) throw new Error(`No company ${companyId} on ${host}`);

  console.log(`${apply ? 'APPLYING' : 'PREVIEW (add --apply to write)'} — company ${companyId} "${company.name}" on ${host}\n`);
  await seedRates();
  const componentIds = await seedComponents();
  // Groups need component ids, which a preview on an empty company does not have.
  if (apply || componentIds.size === SEED_COMPONENTS.length) await seedGroups(componentIds);
  else summary.push('Salary groups', ...SEED_SALARY_GROUPS.map((g) => `  + ${g.code} v1 (would create)`));
  await seedTaxRegimes();
  console.log(summary.join('\n'));
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
