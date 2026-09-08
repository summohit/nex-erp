import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const companies = await prisma.company.findMany();
  let deletedCount = 0;

  for (const company of companies) {
    const templates = await prisma.onboardingTemplate.findMany({
      where: { companyId: company.id }
    });
    const templateTitles = templates.map(t => t.title);

    const result = await prisma.employeeOnboardingTask.deleteMany({
      where: {
        employee: { companyId: company.id },
        isCompleted: false,
        title: { notIn: templateTitles }
      }
    });
    deletedCount += result.count;
  }
  
  console.log(`Deleted ${deletedCount} obsolete tasks.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
