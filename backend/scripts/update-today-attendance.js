const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istInstant = (dayStr, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MS);
};

const DAY = '2026-11-06';
const dateKey = new Date(`${DAY}T00:00:00.000Z`);

// Office coords for Noida Sector-135 Head Office
const OFFICE_LAT = 28.496447;
const OFFICE_LNG = 77.40216;

const TARGETS = [
  {
    employeeId: 44,
    name: 'Vipul Aggarwal',
    email: 'vipula@ces-pl.com',
    targetTime: '09:38',
  },
  {
    employeeId: 24,
    name: 'Mohit Singh',
    email: 'mohits@ces-pl.com',
    targetTime: '09:34',
  },
];

async function main() {
  console.log(`Setting attendance for today (${DAY}):`);

  for (const target of TARGETS) {
    const clockInTime = istInstant(DAY, target.targetTime);
    console.log(`\n--- Processing ${target.name} (${target.email}) ---`);
    console.log(`Target clock-in: ${target.targetTime} IST -> ${clockInTime.toISOString()}`);

    // Check existing
    const existing = await prisma.attendance.findUnique({
      where: {
        employeeId_date: {
          employeeId: target.employeeId,
          date: dateKey,
        },
      },
      include: { logs: true },
    });

    if (existing) {
      console.log(`Found existing record ID ${existing.id}: current clockIn = ${existing.clockIn?.toISOString()}, status = ${existing.status}, isLate = ${existing.isLate}`);
      
      const updated = await prisma.attendance.update({
        where: { id: existing.id },
        data: {
          clockIn: clockInTime,
          status: 'PRESENT',
          isLate: true,
          clockInOutside: false,
          clockInLat: existing.clockInLat || OFFICE_LAT,
          clockInLng: existing.clockInLng || OFFICE_LNG,
          shiftId: existing.shiftId || 1,
        },
      });

      if (existing.logs && existing.logs.length > 0) {
        // update the earliest log
        const earliestLog = [...existing.logs].sort((a, b) => a.clockIn - b.clockIn)[0];
        await prisma.attendanceLog.update({
          where: { id: earliestLog.id },
          data: {
            clockIn: clockInTime,
            clockInLat: earliestLog.clockInLat || OFFICE_LAT,
            clockInLng: earliestLog.clockInLng || OFFICE_LNG,
          },
        });
        console.log(`Updated existing log ID ${earliestLog.id} clockIn to ${clockInTime.toISOString()}`);
      } else {
        const newLog = await prisma.attendanceLog.create({
          data: {
            attendanceId: existing.id,
            clockIn: clockInTime,
            clockInLat: OFFICE_LAT,
            clockInLng: OFFICE_LNG,
          },
        });
        console.log(`Created new open log ID ${newLog.id}`);
      }
      console.log(`Updated Attendance record: ID ${updated.id}, clockIn = ${updated.clockIn.toISOString()}, status = ${updated.status}, isLate = ${updated.isLate}`);
    } else {
      console.log(`No existing record found. Creating new attendance record...`);
      const created = await prisma.attendance.create({
        data: {
          employeeId: target.employeeId,
          date: dateKey,
          clockIn: clockInTime,
          status: 'PRESENT',
          isLate: true,
          isEarlyLeave: false,
          shiftId: 1,
          isOnsite: false,
          clockInOutside: false,
          clockInLat: OFFICE_LAT,
          clockInLng: OFFICE_LNG,
        },
      });

      const newLog = await prisma.attendanceLog.create({
        data: {
          attendanceId: created.id,
          clockIn: clockInTime,
          clockInLat: OFFICE_LAT,
          clockInLng: OFFICE_LNG,
        },
      });

      console.log(`Created Attendance ID ${created.id} with Log ID ${newLog.id}: clockIn = ${created.clockIn.toISOString()}, status = ${created.status}, isLate = ${created.isLate}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('Error updating attendance:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
