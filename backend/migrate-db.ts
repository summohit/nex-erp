import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres.glvdfvqnnrcyhoupdhgz:ut55HZRQMX5I1Xnh@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const columns = [
      { name: 'totalCost', type: 'DOUBLE PRECISION' },
      { name: 'costCurrency', type: 'TEXT' },
      { name: 'costBreakdown', type: 'JSONB' },
      { name: 'costTotalMismatch', type: 'BOOLEAN' },
      { name: 'estimatedRevenue', type: 'DOUBLE PRECISION' },
      { name: 'estimatedMarginPct', type: 'DOUBLE PRECISION' },
      { name: 'marginDisplay', type: 'TEXT' },
      { name: 'readinessScore', type: 'INTEGER' },
      { name: 'healthStatus', type: 'TEXT' },
      { name: 'healthBreakdown', type: 'JSONB' },
      { name: 'validationWarnings', type: 'JSONB' },
      { name: 'isReadyForKickoff', type: 'BOOLEAN' },
      { name: 'kickoffBlockers', type: 'JSONB' }
    ];

    for (const col of columns) {
      console.log(`Adding column ${col.name}...`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "ProjectAnalysisRun" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type};`);
    }
    
    console.log('Migration successful!');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
