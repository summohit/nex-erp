require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const p = await prisma.project.findUnique({
    where: { id: 95 },
    include: { lead: true }
  });
  console.log("Lead:", p.lead);
  
  const members = await prisma.projectMember.findMany({
    where: { projectId: 95 },
    include: { employee: true }
  });
  console.log("Members:", members.map(m => m.employee.firstName + ' (' + m.role + ')'));
}

main().then(() => {
  prisma.$disconnect();
  pool.end();
}).catch(console.error);
