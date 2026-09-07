/**
 * Move legacy JobApplication statuses onto the 9-stage recruitment pipeline
 * (APPLIED, PHONE_SCREENING, INTERVIEW, NEGOTIATION, OFFERED, HIRED, ONBOARDED,
 * ON_HOLD, REJECTED). Only touches the retired values; the rest already match.
 *
 *   npx ts-node migrate-application-stages.ts            # dry run
 *   npx ts-node migrate-application-stages.ts --commit
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const COMMIT = process.argv.includes('--commit');

// Retired -> new stage. REVIEWING/SHORTLISTED sit between applying and
// interviewing, so they land on PHONE_SCREENING.
const MAP: Record<string, string> = {
  NEW: 'APPLIED',
  REVIEWING: 'PHONE_SCREENING',
  SHORTLISTED: 'PHONE_SCREENING',
  INTERVIEWING: 'INTERVIEW',
};

(async () => {
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — legacy application stages\n`);
  for (const [from, to] of Object.entries(MAP)) {
    const n = await prisma.jobApplication.count({ where: { companyId: 1, status: from } });
    if (!n) continue;
    console.log(`  ${from} -> ${to}: ${n}`);
    if (COMMIT) {
      await prisma.jobApplication.updateMany({
        where: { companyId: 1, status: from }, data: { status: to },
      });
    }
  }
  const g: any = await prisma.jobApplication.groupBy({ by: ['status'], where: { companyId: 1 }, _count: true });
  console.log('\nresulting pipeline:');
  const order = ['APPLIED','PHONE_SCREENING','INTERVIEW','NEGOTIATION','OFFERED','HIRED','ONBOARDED','ON_HOLD','REJECTED'];
  g.sort((a: any, b: any) => order.indexOf(a.status) - order.indexOf(b.status));
  g.forEach((x: any) => console.log(`  ${x.status.padEnd(16)} ${x._count}`));
  console.log(COMMIT ? '\nDONE.' : '\nDRY RUN — re-run with --commit.');
  await prisma.$disconnect(); await pool.end();
})();
