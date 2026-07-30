import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  host: '/tmp',
  port: 5432,
  user: 'mohitsingh',
  database: 'erp_db'
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const company = await prisma.company.findFirst();
  if (!company) {
    console.error('No company found. Please create a company first.');
    return;
  }

  // Clear existing leave types to avoid duplicates if run multiple times
  await prisma.leaveType.deleteMany({ where: { companyId: company.id } });

  const leaveTypes = [
    {
      name: 'Privilege Leave',
      description: 'Planned vacations or long personal breaks.',
      defaultDays: 15,
      isPaid: true,
      carryForward: true,
      carryForwardLimit: 30,
      companyId: company.id,
    },
    {
      name: 'Casual Leave',
      description: 'Short, unplanned personal matters or emergencies.',
      defaultDays: 7,
      isPaid: true,
      carryForward: false,
      carryForwardLimit: 0,
      companyId: company.id,
    },
    {
      name: 'Sick Leave',
      description: 'Recovery from illness or injury.',
      defaultDays: 10,
      isPaid: true,
      carryForward: true,
      carryForwardLimit: 20,
      companyId: company.id,
    },
    {
      name: 'Maternity Leave',
      description: 'Statutory leave for childbirth and care for a newborn.',
      defaultDays: 182, // roughly 26 weeks
      isPaid: true,
      carryForward: false,
      carryForwardLimit: 0,
      companyId: company.id,
    },
    {
      name: 'Paternity Leave',
      description: 'Time off for new fathers.',
      defaultDays: 5,
      isPaid: true,
      carryForward: false,
      carryForwardLimit: 0,
      companyId: company.id,
    },
    {
      name: 'Bereavement Leave',
      description: 'Time off to mourn the loss of an immediate family member.',
      defaultDays: 3,
      isPaid: true,
      carryForward: false,
      carryForwardLimit: 0,
      companyId: company.id,
    },
    {
      name: 'Marriage Leave',
      description: 'Special leave granted for an employee\'s own wedding.',
      defaultDays: 5,
      isPaid: true,
      carryForward: false,
      carryForwardLimit: 0,
      companyId: company.id,
    },
    {
      name: 'Compensatory Off',
      description: 'Leave granted in lieu of working on a weekend or public holiday.',
      defaultDays: 0,
      isPaid: true,
      carryForward: true,
      carryForwardLimit: 5,
      companyId: company.id,
    },
    {
      name: 'Loss of Pay',
      description: 'Unpaid leave taken when all other leave balances are exhausted.',
      defaultDays: 0,
      isPaid: false,
      carryForward: false,
      carryForwardLimit: 0,
      companyId: company.id,
    }
  ];

  console.log(`Seeding leave types for company ${company.name}...`);
  for (const lt of leaveTypes) {
    await prisma.leaveType.create({ data: lt });
  }
  console.log('Seeded 9 core leave types successfully!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
