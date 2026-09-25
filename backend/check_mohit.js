require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const mohit = await prisma.user.findFirst({
    where: { email: 'mohits@ces-pl.com' },
    include: { employee: true }
  });
  console.log("Mohit User ID:", mohit.id);
  console.log("Mohit Employee ID:", mohit.employee.id);
  
  const devEmp = await prisma.employee.findUnique({where: {id: 97}, include: {user: true}});
  console.log("Emp 97:", devEmp ? devEmp.user.email : 'not found');
}

main().then(() => {
  prisma.$disconnect();
  pool.end();
}).catch(console.error);
