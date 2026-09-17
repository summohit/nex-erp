/**
 * Import employee hourly cost rates from Workway profiles (§23).
 *
 *   npx ts-node import-ces-cost-rates.ts --file ../scraper/out_hr/profiles-2026-09-17.json
 *   npx ts-node import-ces-cost-rates.ts --file <same> --commit
 *
 * Dry run by default. It prints every rate it would set, and what it would
 * overwrite, and writes nothing until --commit.
 *
 * ── Why this matters ─────────────────────────────────────────────────────
 * §23 is "employee project cost": logged hours times an internal rate. The
 * rate column shipped with the Delivery module's second phase and nobody ever
 * filled it — all 96 employees sat at null, so every project reported an
 * employee cost of exactly zero and every hour came back as "unrated". The
 * Finance view was an empty column pretending to be a feature.
 *
 * ── Read this before trusting the numbers ────────────────────────────────
 * Workway calls the field "Hourly Rate" and uses it to show earnings against a
 * time log. Whether a given person's figure is an internal cost or a client
 * billing rate is a judgement this script cannot make — it copies what is
 * there. The spread is wide enough to be worth a look before committing, which
 * is what the dry run's distribution is for.
 *
 * Rates are pay-adjacent. Existing values are never silently replaced: a
 * changed rate is listed individually, and --overwrite is required to apply it.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const OVERWRITE = process.argv.includes('--overwrite');
const COMPANY_ID = Number(getArg('company') || 1);

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-cost-rates.ts --file <profiles.json> [--commit] [--overwrite]');
  process.exit(1);
}

/** "₹1,083.00", "1083", "--" → a number, or null when there is no rate. */
function parseRate(raw: unknown): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[₹,\s]/g, '').trim();
  if (!cleaned || cleaned === '--' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

async function main() {
  const profiles: any[] = JSON.parse(fs.readFileSync(FILE!, 'utf-8'));
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${profiles.length} profiles from ${path.basename(FILE!)}\n`);

  const employees = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: {
      id: true, firstName: true, lastName: true, hourlyCostRate: true,
      user: { select: { email: true } },
    },
  });
  const byEmail = new Map(
    employees
      .filter((e) => e.user?.email)
      .map((e) => [e.user!.email.trim().toLowerCase(), e]),
  );

  const toSet: { id: number; name: string; rate: number }[] = [];
  const toChange: { id: number; name: string; from: number; to: number }[] = [];
  const unchanged: string[] = [];
  const noRate: string[] = [];
  const noMatch: string[] = [];

  for (const p of profiles) {
    const email = String(p.email || '').trim().toLowerCase();
    const emp = email ? byEmail.get(email) : undefined;
    if (!emp) {
      if (email) noMatch.push(email);
      continue;
    }

    const name = `${emp.firstName} ${emp.lastName || ''}`.trim();
    const rate = parseRate(p.hourly_rate);
    if (rate == null) { noRate.push(name); continue; }

    if (emp.hourlyCostRate == null) toSet.push({ id: emp.id, name, rate });
    else if (Math.abs(emp.hourlyCostRate - rate) > 0.005) {
      toChange.push({ id: emp.id, name, from: emp.hourlyCostRate, to: rate });
    } else unchanged.push(name);
  }

  console.log('PLAN');
  console.log(`  rates to set (currently empty)  ${toSet.length}`);
  console.log(`  rates that would CHANGE         ${toChange.length}${OVERWRITE ? '' : '  (skipped without --overwrite)'}`);
  console.log(`  already correct                 ${unchanged.length}`);
  console.log(`  profile has no rate             ${noRate.length}`);
  console.log(`  no matching ERP employee        ${noMatch.length}`);

  if (toSet.length) {
    const rates = toSet.map((r) => r.rate).sort((a, b) => a - b);
    const median = rates[Math.floor(rates.length / 2)];
    console.log(
      `\n  spread: ${money(rates[0])} … ${money(rates[rates.length - 1])}, median ${money(median)}`,
    );
    console.log('\n  rates to set:');
    for (const r of [...toSet].sort((a, b) => b.rate - a.rate)) {
      console.log(`    ${money(r.rate).padStart(10)}/h   ${r.name}`);
    }
  }

  if (toChange.length) {
    console.log('\n  rates that differ from what is stored:');
    for (const c of toChange) {
      console.log(`    ${c.name}: ${money(c.from)} → ${money(c.to)}`);
    }
  }

  if (noMatch.length) {
    console.log('\n  profile emails with no ERP account:');
    for (const e of noMatch) console.log(`    ${e}`);
  }

  if (!COMMIT) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit.\n');
    await prisma.$disconnect();
    return;
  }

  let set = 0;
  for (const r of toSet) {
    await prisma.employee.update({ where: { id: r.id }, data: { hourlyCostRate: r.rate } });
    set++;
  }

  let changed = 0;
  if (OVERWRITE) {
    for (const c of toChange) {
      await prisma.employee.update({ where: { id: c.id }, data: { hourlyCostRate: c.to } });
      changed++;
    }
  }

  console.log(`\nset ${set} rate(s), changed ${changed}, left ${toChange.length - changed} existing rate(s) alone`);
  console.log('DONE.\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
