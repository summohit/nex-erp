const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.findMany({
    where: {
      id: { in: [24, 26] }
    }
  });
  
  // also check employees?
  const employees = await prisma.employee.findMany({
    where: {
      userId: { in: [24, 26] }
    }
  }).catch(() => []);
  
  console.log(JSON.stringify({ users, employees }, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
