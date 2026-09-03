import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as fs from 'fs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp'
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const companyId = 1; // Assuming default company ID 1 for this import

  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } }
  });

  const getEmployeeId = (nameStr: string | null) => {
    if (!nameStr) return null;
    const lower = nameStr.toLowerCase();
    for (const emp of employees) {
      if (lower.includes(emp.firstName.toLowerCase()) || lower.includes(emp.lastName.toLowerCase())) {
        return emp.id;
      }
    }
    return null;
  };

  const cleanText = (val: any): string | null => {
    if (!val || val === '--') return null;
    return String(val).replace(/\s+/g, ' ').trim();
  };

  const cleanCurrency = (val: any) => {
    if (!val || val === '--') return 0;
    const num = Number(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
  };
  
  console.log('Importing Lead Contacts...');
  const contactsData = JSON.parse(fs.readFileSync('/Users/mohitsingh/.gemini/antigravity/scratch/leads.json', 'utf-8'));

  let contactsAdded = 0;
  for (const row of contactsData) {
    const rawName = cleanText(row['Name']);
    if (!rawName) continue;
    
    const nameParts = rawName.split(' ');
    const name = nameParts.slice(0, 3).join(' ');
    const companyName = nameParts.length > 3 ? nameParts.slice(3).join(' ') : null;

    const email = cleanText(row['Lead Email']);
    const mobile = cleanText(row['Lead Mobile']);
    const addedById = getEmployeeId(cleanText(row['Added By']));

    try {
      await prisma.leadContact.create({
        data: {
          name,
          email,
          mobile,
          companyName,
          addedById,
          companyId
        }
      });
      contactsAdded++;
    } catch (e) {
      console.warn('Failed to insert contact:', email, e.message);
    }
  }
  console.log(`Imported ${contactsAdded} Lead Contacts.`);

  console.log('Importing Deals (Leads)...');
  const dealsData = JSON.parse(fs.readFileSync('/Users/mohitsingh/.gemini/antigravity/scratch/deals.json', 'utf-8'));

  let dealsAdded = 0;
  for (const row of dealsData) {
    const title = cleanText(row['Deal Name']);
    if (!title) continue;

    const rawLeadName = cleanText(row['Lead Name']);
    const contactName = rawLeadName ? rawLeadName.split(' ').slice(0, 3).join(' ') : null;
    const companyName = rawLeadName && rawLeadName.split(' ').length > 3 ? rawLeadName.split(' ').slice(3).join(' ') : null;

    const email = cleanText(row['Lead Email']);
    const phone = cleanText(row['Lead Mobile']);
    const value = cleanCurrency(row['Value']);
    const statusRaw = cleanText(row['Deal Stage']);
    
    let status = 'NEW';
    if (statusRaw === 'Generated' || statusRaw === 'Initial Contact') status = 'NEW';
    else if (statusRaw === 'Schedule Appointment' || statusRaw === 'Proposal Sent') status = 'PROPOSAL';
    else if (statusRaw === 'Win') status = 'WON';
    else if (statusRaw === 'Lost') status = 'LOST';

    const assignedToId = getEmployeeId(cleanText(row['Deal Watcher']) || cleanText(row['Agent']));

    try {
      await prisma.lead.create({
        data: {
          title,
          contactName,
          companyName,
          email,
          phone,
          value,
          currency: 'INR',
          status,
          assignedToId,
          companyId
        }
      });
      dealsAdded++;
    } catch (e) {
      console.warn('Failed to insert deal:', title, e.message);
    }
  }
  console.log(`Imported ${dealsAdded} Deals.`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
