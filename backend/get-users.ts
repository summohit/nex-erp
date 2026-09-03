import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const employees = await prisma.employee.findMany({
    select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } }
  });
  console.log("Employees:");
  for (const emp of employees) {
    if (emp.firstName.toLowerCase().includes('rudra') || emp.firstName.toLowerCase().includes('riyaz') || emp.lastName.toLowerCase().includes('siddique')) {
        console.log(`ID: ${emp.id}, Name: ${emp.firstName} ${emp.lastName}`);
    }
  }
}
main().finally(() => { prisma.$disconnect(); pool.end(); });
