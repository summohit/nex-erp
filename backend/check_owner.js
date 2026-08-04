const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.project.findUnique({ where: { id: 1 }, include: { lead: { include: { user: true } } } });
  if (p && p.lead) {
    console.log('Owner of Project 1 is:', p.lead.firstName, p.lead.lastName, 'Email:', p.lead.user.email);
  } else {
    console.log('Project 1 has no owner.');
  }
}
main().finally(() => prisma.$disconnect());
