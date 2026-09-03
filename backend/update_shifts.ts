import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const generalShift = await prisma.shift.findFirst({
    where: { name: { contains: 'General', mode: 'insensitive' } }
  });
  if (generalShift) {
    await prisma.shift.update({
      where: { id: generalShift.id },
      data: {
        startTime: '09:30:00',
        endTime: '18:30:00'
      }
    });
    console.log('General shift updated');
  }

  const nightShift = await prisma.shift.findFirst({
    where: { name: { contains: 'Night', mode: 'insensitive' } }
  });
  if (nightShift) {
    await prisma.shift.update({
      where: { id: nightShift.id },
      data: {
        startTime: '21:00:00',
        endTime: '06:00:00'
      }
    });
    console.log('Night shift updated');
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
