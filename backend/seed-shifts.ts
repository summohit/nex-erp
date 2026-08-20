import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error('No company found. Please ensure there is a company in the DB.');
    return;
  }

  const shifts = [
    { name: 'Morning Shift', startTime: '09:00', endTime: '18:00', bufferTimeMinutes: 15 },
    { name: 'Evening Shift', startTime: '14:00', endTime: '23:00', bufferTimeMinutes: 15 },
    { name: 'Night Shift', startTime: '22:00', endTime: '07:00', bufferTimeMinutes: 15 },
    { name: 'Half Day Shift', startTime: '09:00', endTime: '13:00', bufferTimeMinutes: 10 },
  ];

  for (const shift of shifts) {
    await prisma.shift.create({
      data: {
        ...shift,
        companyId: company.id
      }
    });
    console.log(`Created shift: ${shift.name}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
