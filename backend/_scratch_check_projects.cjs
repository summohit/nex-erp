const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

(async () => {
  const users = await prisma.user.findMany({ include: { employee: true } });
  const projects = await prisma.project.findMany({ include: { members: true, lead: true } });

  console.log('--- Users & their Employee.id ---');
  for (const u of users) {
    console.log(`User id=${u.id} email=${u.email} -> employee.id=${u.employee?.id ?? 'NONE'}`);
  }

  console.log('\n--- Projects: leadId vs members ---');
  for (const p of projects) {
    console.log(`Project id=${p.id} name="${p.name}" leadId=${p.leadId} lead.userId=${p.lead?.userId} members=${p.members.map(m => `emp${m.employeeId}(${m.role})`).join(',')}`);
  }

  await prisma.$disconnect();
  await pool.end();
})().catch(async e => { console.error(e); await pool.end(); process.exit(1); });
