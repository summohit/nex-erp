import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: "postgresql://mohitsingh@127.0.0.1:5432/erp_db?schema=public"
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  // Find User by email
  const user = await prisma.user.findUnique({
    where: { email: 'mohits@ces-pl.com' },
    include: { employee: true }
  });

  if (!user || !user.employee) {
    console.log('User or Employee not found for mohits@ces-pl.com');
    await prisma.$disconnect();
    return;
  }

  const employeeId = user.employee.id;

  // Add ProjectMember if not exists and make ADMIN
  await prisma.projectMember.upsert({
    where: {
      projectId_employeeId: {
        projectId: 1,
        employeeId: employeeId
      }
    },
    update: {
      role: 'ADMIN'
    },
    create: {
      projectId: 1,
      employeeId: employeeId,
      role: 'ADMIN'
    }
  });

  // Make user the lead of Project 1
  await prisma.project.update({
    where: { id: 1 },
    data: {
      leadId: employeeId
    }
  });

  console.log('Successfully restored mohits@ces-pl.com as Owner of project 1');

  await prisma.$disconnect();
}

main().catch(console.error);
