const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const parent = await prisma.menu.findFirst({ where: { parentId: null, title: 'MAIN' } });
  if (!parent) {
    console.log("No MAIN parent found");
    return;
  }
  const clientsMenu = await prisma.menu.findFirst({ where: { title: 'Clients', parentId: parent.id } });
  if (!clientsMenu) {
    await prisma.menu.create({
      data: {
        title: 'Clients',
        icon: 'building', 
        route: '/clients',
        displayOrder: 6,
        parentId: parent.id,
        isActive: true
      }
    });
    console.log('Clients menu seeded successfully.');
  } else {
    console.log('Clients menu already exists.');
  }
}

main().catch(console.error).finally(() => process.exit(0));
