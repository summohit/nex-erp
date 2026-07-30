import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log('Users:', users.map(u => ({ id: u.id, email: u.email, companyId: u.companyId })));
  
  const depts = await prisma.department.findMany();
  console.log('Departments:', depts.map(d => ({ id: d.id, name: d.name, companyId: d.companyId })));
  
  const cos = await prisma.company.findMany();
  console.log('Companies:', cos.map(c => ({ id: c.id, name: c.name })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
