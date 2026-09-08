import * as dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const employees = await prisma.employee.findMany({
    include: { onboardingTasks: true }
  });

  let updated = 0;
  for (const emp of employees) {
    const allTasks = emp.onboardingTasks;
    const completedTasksCount = allTasks.filter(t => t.isCompleted).length;
    let newStatus = 'PENDING';

    if (completedTasksCount === allTasks.length && allTasks.length > 0) {
      newStatus = 'COMPLETED';
    } else if (completedTasksCount > 0) {
      newStatus = 'IN_PROGRESS';
    }

    if (newStatus !== emp.onboardingStatus) {
      await prisma.employee.update({
        where: { id: emp.id },
        data: { onboardingStatus: newStatus }
      });
      updated++;
    }
  }
  
  console.log(`Updated ${updated} employees' statuses.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
