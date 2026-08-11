import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  console.log('Users:', users.map(u => ({id: u.id, email: u.email, role: u.role, companyId: u.companyId})));

  try {
    const branch = await prisma.branch.create({
      data: {
        name: 'HQ',
        address: '',
        startTime: '09:00',
        endTime: '18:00',
        latitude: undefined,
        longitude: undefined,
        weeklyOffs: '0',
        companyId: 1
      }
    });
    console.log('Branch created successfully:', branch);
  } catch (e) {
    console.error('Error creating branch:', e);
  }
  
  await prisma.$disconnect();
}
main();
