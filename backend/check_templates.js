require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const defaults = await prisma.taskType.findMany({
    where: { companyId: 1 }
  });
  console.log("TaskTypes:", defaults.map(d => d.name));
  
  const phases = await prisma.projectPhase.findMany({
    where: { companyId: 1 }
  });
  console.log("Phases:", phases.map(d => d.name));
}

main().then(() => {
  prisma.$disconnect();
  pool.end();
}).catch(console.error);
