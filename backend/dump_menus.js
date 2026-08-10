const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const allMenus = await prisma.menu.findMany();
  console.log("All menus:");
  allMenus.forEach(m => console.log(m.id, m.title, m.parentId));

}

main().catch(console.error).finally(() => process.exit(0));
