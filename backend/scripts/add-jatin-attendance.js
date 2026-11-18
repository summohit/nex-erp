const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istInstant = (dayStr, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = dayStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, m) - IST_OFFSET_MS);
};

// Office coordinates for Noida Sector-135 (Head Office)
const OFFICE_LAT = 28.496447;
const OFFICE_LNG = 77.40216;

async function main() {
  const employee = await prisma.employee.findFirst({
    where: {
      OR: [
        { firstName: { contains: 'jatin', mode: 'insensitive' } },
        { user: { email: { contains: 'jatin', mode: 'insensitive' } } }
      ]
    },
    include: {
      user: true,
      branch: true,
      shift: true,
    }
  });

  if (!employee) {
    throw new Error('Employee Jatin not found');
  }

  console.log(`Found Employee: ${employee.firstName} ${employee.lastName} (ID: ${employee.id}, Code: ${employee.employeeCode})`);
  console.log(`User ID: ${employee.userId}, Email: ${employee.user?.email}`);
  console.log(`Branch: ${employee.branch?.name} (${employee.branch?.latitude}, ${employee.branch?.longitude})`);

  // 1. Resolve open previous session from 2026-11-07
  const prevDate = new Date('2026-11-07T00:00:00.000Z');
  const prevRecord = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: prevDate,
      }
    },
    include: { logs: true }
  });

  if (prevRecord && !prevRecord.clockOut) {
    console.log(`\nResolving stuck/unclosed previous session from 2026-11-07 (ID: ${prevRecord.id})...`);
    // Shift 10 ended at 13:00 IST (07:30 UTC)
    const prevClockOutTime = new Date('2026-11-07T07:30:00.000Z');

    if (prevRecord.logs && prevRecord.logs.length > 0) {
      for (const log of prevRecord.logs) {
        if (!log.clockOut) {
          await prisma.attendanceLog.update({
            where: { id: log.id },
            data: {
              clockOut: prevClockOutTime,
              clockOutLat: log.clockInLat || OFFICE_LAT,
              clockOutLng: log.clockInLng || OFFICE_LNG,
              autoClockedOut: false,
            }
          });
          console.log(`  Updated log ID ${log.id} clockOut to ${prevClockOutTime.toISOString()}`);
        }
      }
    }

    await prisma.attendance.update({
      where: { id: prevRecord.id },
      data: {
        clockOut: prevClockOutTime,
        clockOutLat: prevRecord.clockInLat || OFFICE_LAT,
        clockOutLng: prevRecord.clockInLng || OFFICE_LNG,
        missedClockOut: false,
        clockOutReason: 'Diwali shift completion',
        clockOutApproval: 'APPROVED',
        autoClockedOut: false,
      }
    });
    console.log(`  Closed 2026-11-07 attendance record successfully.`);
  }

  // 2. Add attendance for Today (2026-11-10) at around 09:42 IST
  const todayStr = '2026-11-10';
  const todayDateKey = new Date(`${todayStr}T00:00:00.000Z`);
  const targetTime = '09:42';
  const clockInInstant = istInstant(todayStr, targetTime); // 04:12:00.000Z

  console.log(`\nAdding login for ${todayStr} at ${targetTime} IST (${clockInInstant.toISOString()})...`);

  const existingToday = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: todayDateKey,
      }
    },
    include: { logs: true }
  });

  if (existingToday) {
    console.log(`Found existing record for today (ID: ${existingToday.id}). Updating...`);
    const updated = await prisma.attendance.update({
      where: { id: existingToday.id },
      data: {
        clockIn: clockInInstant,
        status: 'PRESENT',
        isLate: true,
        isEarlyLeave: false,
        clockInOutside: false,
        clockInLat: OFFICE_LAT,
        clockInLng: OFFICE_LNG,
        shiftId: employee.shiftId || 1,
        missedClockOut: false,
        autoClockedOut: false,
      }
    });

    if (existingToday.logs && existingToday.logs.length > 0) {
      const activeLog = existingToday.logs.find(l => !l.clockOut) || existingToday.logs[0];
      await prisma.attendanceLog.update({
        where: { id: activeLog.id },
        data: {
          clockIn: clockInInstant,
          clockInLat: OFFICE_LAT,
          clockInLng: OFFICE_LNG,
        }
      });
      console.log(`Updated log ID ${activeLog.id}`);
    } else {
      const newLog = await prisma.attendanceLog.create({
        data: {
          attendanceId: existingToday.id,
          clockIn: clockInInstant,
          clockInLat: OFFICE_LAT,
          clockInLng: OFFICE_LNG,
        }
      });
      console.log(`Created new log ID ${newLog.id}`);
    }
  } else {
    console.log(`Creating new attendance record for today...`);
    const created = await prisma.attendance.create({
      data: {
        employeeId: employee.id,
        date: todayDateKey,
        clockIn: clockInInstant,
        status: 'PRESENT',
        isLate: true,
        isEarlyLeave: false,
        shiftId: employee.shiftId || 1,
        isOnsite: false,
        clockInOutside: false,
        clockInLat: OFFICE_LAT,
        clockInLng: OFFICE_LNG,
        missedClockOut: false,
        autoClockedOut: false,
      }
    });

    const newLog = await prisma.attendanceLog.create({
      data: {
        attendanceId: created.id,
        clockIn: clockInInstant,
        clockInLat: OFFICE_LAT,
        clockInLng: OFFICE_LNG,
      }
    });

    console.log(`Created Attendance ID: ${created.id}`);
    console.log(`Created AttendanceLog ID: ${newLog.id}`);
  }

  // 3. Verify
  const verified = await prisma.attendance.findUnique({
    where: {
      employeeId_date: {
        employeeId: employee.id,
        date: todayDateKey,
      }
    },
    include: { logs: true, shift: true, employee: { include: { branch: true } } }
  });

  console.log('\n--- VERIFICATION RESULT ---');
  console.log(JSON.stringify(verified, null, 2));
}

main()
  .catch((err) => {
    console.error('Execution failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
