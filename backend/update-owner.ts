import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const fromId = 6; // Rudradev
  const toId = 38; // Riyaz Siddique

  const leadsUpdated = await prisma.lead.updateMany({
    where: { assignedToId: fromId },
    data: { assignedToId: toId }
  });

  const contactsUpdated = await prisma.leadContact.updateMany({
    where: { addedById: fromId },
    data: { addedById: toId }
  });

  const leadsAddedByUpdated = await prisma.lead.updateMany({
    where: { addedById: fromId },
    data: { addedById: toId }
  });

  console.log(`Updated ${leadsUpdated.count} Leads assignedToId.`);
  console.log(`Updated ${leadsAddedByUpdated.count} Leads addedById.`);
  console.log(`Updated ${contactsUpdated.count} LeadContacts addedById.`);
}
main().finally(() => { prisma.$disconnect(); pool.end(); });
