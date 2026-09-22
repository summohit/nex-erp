/**
 * Links Workway's project clients into NEX as lead contacts.
 *
 * Workway stores a project's customer as a PERSON ("Amit Kharey") with the
 * company name only in the rendered HTML underneath it ("Arsalan"). NEX models
 * those separately: a LeadContact is the person, a Client is the company you
 * invoice, and a project records the contact it was opened against and resolves
 * the client from that contact's companyName -- exactly what the project form
 * does via CrmService.findOrCreateClientFromLeadContact.
 *
 * This reproduces that path rather than writing clientId directly, so an
 * imported project is indistinguishable from one created through the UI.
 *
 *   node scripts/import-workway-clients.js --dry-run
 *   node scripts/import-workway-clients.js
 *
 * Spelling is corrected on the way in for the pairs Workway holds twice
 * ("Diversifued"/"Diversified") -- see FIXES. Importing them verbatim would
 * create two customers for one company.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});
const DRY = process.argv.includes('--dry-run');
const COMPANY_ID = 1;
const RAW = path.join(__dirname, '..', '..', 'scraper', 'out_projects', 'projects-raw.json');

/** Workway typos that would otherwise become separate customers. */
const FIXES = new Map([
  ['diversifued', 'Diversified'],
  ['ve commerical', 'VE Commercial'],
]);

const strip = (v) => typeof v === 'string'
  ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
const decode = (v) => String(v ?? '')
  .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;| /g, ' ')
  .replace(/\s+/g, ' ').trim();
const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tidy = (s) => FIXES.get((s || '').trim().toLowerCase()) ?? (s || '').trim();

/** The company name Workway renders in a <p> beneath the contact's name. */
function companyOf(row) {
  const m = /<p[^>]*>([\s\S]*?)<\/p>/.exec(row.client_id || '');
  return m ? tidy(decode(strip(m[1]))) : '';
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(RAW, 'utf8')).data;
  console.log(`${DRY ? 'DRY RUN\n' : ''}`);

  const projects = await prisma.project.findMany({
    where: { companyId: COMPANY_ID, isSystem: false },
    select: { id: true, key: true, name: true, clientId: true, leadContactId: true },
  });
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const byName = new Map(projects.map((p) => [norm(p.name), p]));

  const contacts = await prisma.leadContact.findMany({
    where: { companyId: COMPANY_ID }, select: { id: true, name: true, companyName: true },
  });
  const contactKey = (n, c) => `${norm(n)}::${norm(c)}`;
  const contactIndex = new Map(contacts.map((c) => [contactKey(c.name, c.companyName), c.id]));
  // A contact with the right name and no company recorded is still that person.
  const contactByName = new Map(contacts.map((c) => [norm(c.name), c.id]));

  const clients = await prisma.client.findMany({
    where: { companyId: COMPANY_ID }, select: { id: true, name: true },
  });
  const clientIndex = new Map(clients.map((c) => [norm(c.name), c.id]));

  const work = [];
  for (const r of rows) {
    const person = decode(r.client_name || '').trim();
    if (!person || person === '-') continue;
    const company = companyOf(r);
    const code = strip(r.project_short_code);
    const name = decode(r.project) || strip(r.project_name);
    const proj = (code && byKey.get(code)) || byName.get(norm(name));
    if (!proj) continue;
    if (proj.leadContactId) continue;          // already linked; leave it alone
    work.push({ proj, person, company });
  }

  const newCompanies = [...new Set(work.map((w) => w.company).filter((c) => c && !clientIndex.has(norm(c))))];
  const newContacts = [...new Set(work
    .filter((w) => !contactIndex.has(contactKey(w.person, w.company)) && !contactByName.has(norm(w.person)))
    .map((w) => `${w.person} @ ${w.company || '(no company)'}`))];

  console.log(`projects to link       : ${work.length}`);
  console.log(`clients to create      : ${newCompanies.length}  ${newCompanies.join(', ')}`);
  console.log(`lead contacts to create: ${newContacts.length}`);
  for (const c of newContacts.slice(0, 12)) console.log(`   ${c}`);
  if (newContacts.length > 12) console.log(`   ... and ${newContacts.length - 12} more`);

  if (DRY) return;

  let linked = 0;
  for (const w of work) {
    // 1. the person
    let contactId = contactIndex.get(contactKey(w.person, w.company)) ?? contactByName.get(norm(w.person));
    if (!contactId) {
      const c = await prisma.leadContact.create({
        data: { companyId: COMPANY_ID, name: w.person, companyName: w.company || null },
        select: { id: true },
      });
      contactId = c.id;
      contactIndex.set(contactKey(w.person, w.company), contactId);
      contactByName.set(norm(w.person), contactId);
    }
    // 2. the company, by the same rule the project form uses: companyName, else
    //    the person's own name.
    const clientName = (w.company || w.person).trim();
    let clientId = clientIndex.get(norm(clientName));
    if (!clientId) {
      const cl = await prisma.client.create({
        data: { companyId: COMPANY_ID, name: clientName, status: 'LEAD', currency: 'INR' },
        select: { id: true },
      });
      clientId = cl.id;
      clientIndex.set(norm(clientName), clientId);
    }
    // 3. the project records both -- the contact chosen, and the client it resolves to
    await prisma.project.update({
      where: { id: w.proj.id }, data: { leadContactId: contactId, clientId },
    });
    linked++;
  }
  console.log(`\nlinked ${linked} projects`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
      .finally(() => prisma.$disconnect());
