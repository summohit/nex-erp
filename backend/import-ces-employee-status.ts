/**
 * Mirror each CES Tech (Worksuite) employee's Active / Inactive status.
 *
 *   npx ts-node import-ces-employee-status.ts --file ../scraper/out_hr/employee-status.json
 *   npx ts-node import-ces-employee-status.ts --file ../scraper/out_hr/employee-status.json --commit
 *
 * Workway's Inactive maps to our User.status = SUSPENDED, which is already how
 * the ERP deactivates someone (employees.service delete() toggles that same
 * field). Unlike that toggle, this does NOT reassign subordinates — the org
 * chart is left exactly as it is.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const COMPANY_ID = parseInt(getArg('company') || '1', 10);

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-employee-status.ts --file <employee-status.json> [--commit]');
  process.exit(1);
}

async function main() {
  const rows: any[] = JSON.parse(fs.readFileSync(path.resolve(FILE!), 'utf-8'));
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${rows.length} employee status row(s)\n`);

  const emps = await prisma.employee.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, firstName: true, lastName: true, userId: true, user: { select: { email: true, status: true } } },
  });
  const byEmail = new Map(emps.map(e => [e.user.email.toLowerCase(), e]));

  const toSuspend: typeof emps = [];
  const toActivate: typeof emps = [];
  const unmatched: string[] = [];

  for (const r of rows) {
    const email = String(r.email || '').toLowerCase();
    const emp = email ? byEmail.get(email) : undefined;
    if (!emp) { unmatched.push(`${r.name} <${r.email}>`); continue; }

    const wantSuspended = /inactive/i.test(String(r.status || ''));
    const isSuspended = emp.user.status === 'SUSPENDED';
    if (wantSuspended && !isSuspended) toSuspend.push(emp);
    // Only reactivate someone we'd previously suspended; never touch a user
    // sitting in PENDING_VERIFICATION.
    if (!wantSuspended && isSuspended) toActivate.push(emp);
  }

  const name = (e: any) => `${e.firstName} ${e.lastName}`.trim();
  console.log(`  to mark Inactive (SUSPENDED): ${toSuspend.length}`);
  toSuspend.slice(0, 10).forEach(e => console.log(`     - ${name(e)}`));
  if (toSuspend.length > 10) console.log(`     … and ${toSuspend.length - 10} more`);
  console.log(`  to mark Active:               ${toActivate.length}`);
  toActivate.slice(0, 10).forEach(e => console.log(`     - ${name(e)}`));
  if (unmatched.length) {
    console.log(`  unmatched in ERP: ${unmatched.length}`);
    unmatched.slice(0, 5).forEach(u => console.log(`     - ${u}`));
  }

  if (COMMIT) {
    if (toSuspend.length) {
      await prisma.user.updateMany({
        where: { id: { in: toSuspend.map(e => e.userId) } }, data: { status: 'SUSPENDED' },
      });
    }
    if (toActivate.length) {
      await prisma.user.updateMany({
        where: { id: { in: toActivate.map(e => e.userId) } }, data: { status: 'ACTIVE' },
      });
    }
    const counts = await prisma.user.groupBy({
      by: ['status'], where: { companyId: COMPANY_ID }, _count: true,
    });
    console.log('\n  resulting user statuses:', counts.map((c: any) => `${c.status}=${c._count}`).join(', '));
  }

  console.log(COMMIT ? '\nDONE — committed.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
