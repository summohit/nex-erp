import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const companies = await prisma.company.findMany();
  for (const company of companies) {
    const templates = await prisma.onboardingTemplate.findMany({
      where: { companyId: company.id }
    });

    if (templates.length === 0) continue;

    const employees = await prisma.employee.findMany({
      where: {
        companyId: company.id,
        onboardingStatus: { in: ['PENDING', 'IN_PROGRESS'] }
      },
      include: {
        onboardingTasks: true
      }
    });

    let newTasks = 0;
    for (const emp of employees) {
      const existingTaskTitles = emp.onboardingTasks.map(t => t.title);
      const missingTemplates = templates.filter(t => !existingTaskTitles.includes(t.title));

      if (missingTemplates.length > 0) {
        await prisma.employeeOnboardingTask.createMany({
          data: missingTemplates.map(t => ({
            employeeId: emp.id,
            title: t.title,
            description: t.description
          }))
        });
        newTasks += missingTemplates.length;
      }
    }
    console.log(`Added ${newTasks} missing tasks to employees in company ${company.name}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
