const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const companies = await prisma.company.findMany();
  
  const departmentsData = [
    { name: 'Engineering', roles: ['Software Engineer', 'QA Engineer', 'Engineering Manager'] },
    { name: 'Sales', roles: ['Sales Representative', 'Account Executive', 'Sales Director'] },
    { name: 'Marketing', roles: ['Marketing Specialist', 'Content Writer', 'Marketing Manager'] },
    { name: 'Human Resources', roles: ['HR Generalist', 'Recruiter', 'HR Manager'] },
    { name: 'Finance', roles: ['Financial Analyst', 'Accountant', 'Finance Director'] },
    { name: 'Operations', roles: ['Operations Coordinator', 'Operations Manager'] },
    { name: 'Product', roles: ['Product Manager', 'UX Designer'] },
    { name: 'Executive', roles: ['CEO', 'CTO', 'COO'] }
  ];

  for (const company of companies) {
    // Check if departments already exist
    const existing = await prisma.department.findFirst({ where: { companyId: company.id } });
    if (existing) continue;

    for (const dept of departmentsData) {
      const createdDept = await prisma.department.create({
        data: { name: dept.name, companyId: company.id }
      });
      
      await prisma.designation.createMany({
        data: dept.roles.map(role => ({
          name: role,
          departmentId: createdDept.id,
          companyId: company.id
        }))
      });
    }
    console.log(`Seeded company: ${company.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); });
