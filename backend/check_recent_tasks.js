require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const issues = await prisma.issue.findMany({
    where: { projectId: 95 },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { project: true, reporter: true }
  });
  console.log(issues.map(i => ({
    id: i.id,
    title: i.title,
    reporterId: i.reporterId,
    reporterName: i.reporter?.firstName
  })));
  
  // also check Mohit's permissions and project roles
  const mohit = await prisma.user.findFirst({
    where: { email: 'mohits@ces-pl.com' },
    include: { employee: true }
  });
  
  if (mohit && mohit.employee) {
      console.log("Mohit's Employee ID:", mohit.employee.id);
      console.log("Role:", mohit.role);
      
      const member = await prisma.projectMember.findFirst({
        where: { projectId: 95, employeeId: mohit.employee.id }
      });
      console.log("Mohit's Project 95 membership:", member);
  }
}

main().then(() => {
  prisma.$disconnect();
  pool.end();
}).catch(console.error);
