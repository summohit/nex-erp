require('dotenv').config({ path: __dirname + '/.env' });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const notifs = await prisma.notification.findMany({
    where: { 
      OR: [
        { linkUrl: { contains: '/projects/95' } },
        { message: { contains: 'CES/0926' } }, // the key pattern I saw in the screenshot for project 95
        { title: { contains: 'assigned' } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  console.log(notifs);
}

main().then(() => {
  prisma.$disconnect();
  pool.end();
}).catch(console.error);
