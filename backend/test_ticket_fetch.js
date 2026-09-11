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
  const ticket = await prisma.ticket.findFirst({
    where: { id: 3 }, // I'll just get ticket ID 3 as an example or any ticket with activities
    include: {
      activities: true
    }
  });
  
  if (!ticket) return console.log("No ticket found");

  const assigneeIdsToFetch = new Set();
  for (const act of ticket.activities) {
    if (act.action === 'ASSIGNEEID_CHANGED') {
      if (act.oldValue) assigneeIdsToFetch.add(Number(act.oldValue));
      if (act.newValue) assigneeIdsToFetch.add(Number(act.newValue));
    }
  }
  
  if (assigneeIdsToFetch.size > 0) {
    const emps = await prisma.employee.findMany({
      where: { id: { in: Array.from(assigneeIdsToFetch) }, companyId: ticket.companyId },
      select: { id: true, firstName: true, lastName: true }
    });
    const empMap = new Map(emps.map(e => [e.id, `${e.firstName} ${e.lastName}`]));
    
    for (const act of ticket.activities) {
      if (act.action === 'ASSIGNEEID_CHANGED') {
        act.action = 'ASSIGNEE_CHANGED';
        
        if (act.oldValue && empMap.has(Number(act.oldValue))) {
          act.oldValue = empMap.get(Number(act.oldValue));
        } else if (act.oldValue && act.oldValue !== 'null') {
          act.oldValue = `User ${act.oldValue}`;
        } else {
          act.oldValue = 'Unassigned';
        }
        
        if (act.newValue && empMap.has(Number(act.newValue))) {
          act.newValue = empMap.get(Number(act.newValue));
        } else if (act.newValue && act.newValue !== 'null') {
          act.newValue = `User ${act.newValue}`;
        } else {
          act.newValue = 'Unassigned';
        }
      }
    }
  }
  console.log(JSON.stringify(ticket.activities.filter(a => a.action === 'ASSIGNEE_CHANGED'), null, 2));
}

main().finally(() => {
  prisma.$disconnect();
  pool.end();
});
