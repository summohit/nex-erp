import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'mohits@ces-pl.com';
  
  const user = await prisma.user.findUnique({
    where: { email },
    include: { employee: true }
  });

  if (!user) {
    console.error('User not found for email:', email);
    return;
  }
  
  // Since user.employee might not be directly included if not defined in User model explicitly,
  // Let's just query Employee directly using userId to be safe.
  const employee = await prisma.employee.findUnique({
    where: { userId: user.id }
  });

  if (!employee) {
    console.error('Employee not found for user ID:', user.id);
    return;
  }

  const employeeId = employee.id;
  console.log(`Found Employee ID: ${employeeId}`);

  const attendances = await prisma.attendance.findMany({
    where: {
      employeeId: employeeId,
      date: {
        gte: new Date('2026-09-20T00:00:00.000Z'),
        lt: new Date('2026-09-22T00:00:00.000Z')
      }
    }
  });

  console.log('Recent attendances:', attendances.map(a => ({ id: a.id, date: a.date })));
  
  const targetDate = attendances.find(a => a.date.toISOString().startsWith('2026-09-21'));
  
  if (!targetDate) {
    console.error('Attendance record not found for 2026-09-21.');
    return;
  }

  const updated = await prisma.attendance.update({
    where: { id: targetDate.id },
    data: {
      clockInLat: 28.4966,
      clockInLng: 77.4021,
      clockOutLat: 28.4966, // they just said "update lang and lattiue... for today date", updating both.
      clockOutLng: 77.4021
    }
  });

  console.log('Successfully updated attendance coordinates for 2026-09-21');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
