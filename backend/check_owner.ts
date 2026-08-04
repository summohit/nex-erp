import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: "postgresql://mohitsingh@127.0.0.1:5432/erp_db?schema=public"
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  const p = await prisma.project.findUnique({ where: { id: 1 }, include: { lead: { include: { user: true } } } });
  if (p && p.lead) {
    console.log('Owner of Project 1 is:', p.lead.firstName, p.lead.lastName, 'Email:', p.lead.user.email);
  } else {
    console.log('Project 1 has no owner.');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
