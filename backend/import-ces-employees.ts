/**
 * Import scraped CES Tech / Workway employees into NEX ERP.
 *
 * Reads the scraper's nested JSON (scraper/out_hr/cestech-full.json) and, for each
 * employee, matches an existing User by email or creates one, upserts the Employee
 * with the scraped profile fields, recreates emergency contacts, and re-hosts every
 * document in ImageKit (storing the ImageKit URL on EmployeeDocument).
 *
 *   # dry run (writes nothing, prints a report)
 *   npx ts-node import-ces-employees.ts --file ../scraper/out_hr/cestech-full.json
 *
 *   # small trial, then the full run
 *   npx ts-node import-ces-employees.ts --file ../scraper/out_hr/cestech-full.json --limit 3 --commit
 *   npx ts-node import-ces-employees.ts --file ../scraper/out_hr/cestech-full.json --commit
 *
 * Flags:
 *   --file <path>     scraped JSON (required)
 *   --commit          actually write (default: dry run)
 *   --company <id>    target company (default: the only Company, else error)
 *   --limit <n>       import only the first n employees (for trials)
 *   --overwrite       overwrite existing Employee fields (default: fill blanks only)
 *   --skip-documents  import profile + contacts only, no ImageKit uploads
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------- args

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const OVERWRITE = process.argv.includes('--overwrite');
const SKIP_DOCS = process.argv.includes('--skip-documents');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')!, 10) : 0;
const COMPANY_ARG = getArg('company') ? parseInt(getArg('company')!, 10) : null;

const DEFAULT_PASSWORD = 'Welcome@123';
const IMAGEKIT_ENDPOINT = 'https://upload.imagekit.io/api/v1/files/upload';

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-employees.ts --file <path.json> [--commit] [--company <id>] [--limit <n>] [--overwrite] [--skip-documents]');
  process.exit(1);
}

// ---------------------------------------------------------------- types

interface ScrapedDoc { name: string; file_url: string; download_url?: string; file_type?: string; }
interface ScrapedContact { name?: string; email?: string; mobile?: string; relationship?: string; }
interface ScrapedEmployee {
  id: string;
  profile_url?: string;
  detail_accessible?: boolean;
  profile?: Record<string, string>;
  emergency_contacts?: ScrapedContact[];
  documents?: ScrapedDoc[];
}

// ---------------------------------------------------------------- helpers

function htmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function clean(v: any): string {
  if (v == null) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return ['--', '-', '—', ''].includes(s) ? '' : s;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = clean(full).split(' ').filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function stripTitle(name: string): string {
  return clean(name).replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim();
}

/** Parse "DD-MM-YYYY" or "YYYY-MM-DD" (the two shapes the scrape produces). */
function parseDate(raw: string): Date | null {
  const s = clean(raw);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);          // YYYY-MM-DD (list/ISO)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);              // DD-MM-YYYY (detail page)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

function normalizeGender(raw: string): string | null {
  const s = clean(raw).toLowerCase();
  if (s.startsWith('m')) return 'Male';
  if (s.startsWith('f')) return 'Female';
  return clean(raw) || null;
}

function employmentType(raw: string): string | null {
  const s = clean(raw);
  if (!s) return null;
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); // full_time -> Full Time
}

function employmentCategory(raw: string): string {
  return /trainee/i.test(raw) ? 'TRAINEE' : /contract|intern/i.test(raw) ? 'CONTRACT' : 'PERMANENT';
}

function documentType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('pan')) return 'PAN Card';
  // Aadhaar has many spellings: aadhaar, aadhar, adhaar, adhar, aadhar card...
  if (/a+dh(aa?)?r/.test(n)) return 'Aadhaar Card';
  if (n.includes('passport')) return 'Passport';
  return 'Other';
}

// ImageKit upload — mirrors backend/src/upload/upload.controller.ts processUpload().
async function uploadToImageKit(buffer: Buffer, fileName: string, folder: string): Promise<string> {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) throw new Error('IMAGEKIT_PRIVATE_KEY not set in backend/.env');
  const form = new FormData();
  form.append('file', buffer.toString('base64'));
  form.append('fileName', fileName);
  form.append('folder', folder);
  const auth = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
  const res = await axios.post(IMAGEKIT_ENDPOINT, form, {
    headers: { ...form.getHeaders(), Authorization: auth },
    maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  return res.data.url as string;
}

// ---------------------------------------------------------------- report

const report = {
  usersCreated: 0, usersMatched: 0,
  employeesCreated: 0, employeesUpdated: 0, employeesFailed: 0,
  contactsCreated: 0,
  docsUploaded: 0, docsSkipped: 0, docsFailed: 0,
  managersLinked: 0, managersUnmatched: [] as string[],
  dobSkipped: 0,
  warnings: [] as string[],
};

// ---------------------------------------------------------------- main

async function main() {
  const filePath = path.resolve(FILE!);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ScrapedEmployee[];
  let employees = raw.filter(e => e.profile && clean(e.profile.email));
  if (LIMIT) employees = employees.slice(0, LIMIT);

  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${employees.length} employee(s) from ${path.basename(filePath)}\n`);

  // Resolve company
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  let companyId = COMPANY_ARG;
  if (!companyId) {
    if (companies.length === 1) companyId = companies[0].id;
    else {
      console.error('Multiple companies exist; pass --company <id>. Companies:');
      companies.forEach(c => console.error(`  ${c.id}: ${c.name}`));
      process.exit(1);
    }
  }
  const company = companies.find(c => c.id === companyId);
  if (!company) { console.error(`Company ${companyId} not found`); process.exit(1); }
  console.log(`Target company: ${company.id} — ${company.name}\n`);

  // Pre-fetch department / designation maps
  const departments = await prisma.department.findMany({ where: { companyId } });
  const designations = await prisma.designation.findMany({ where: { companyId } });
  const deptMap = new Map(departments.map(d => [d.name.toLowerCase(), d.id]));
  const desigMap = new Map(designations.map(d => [d.name.toLowerCase(), d.id]));

  const defaultPasswordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // employeeCode is unique per company. Pre-map which code belongs to whom so we
  // never try to assign a code already held by a different employee (the ERP has
  // pre-existing employees whose codes overlap the CES range).
  const existingEmps = await prisma.employee.findMany({
    where: { companyId, employeeCode: { not: null } },
    select: { employeeCode: true, user: { select: { email: true } } },
  });
  const codeOwner = new Map<string, string>();          // code -> email
  existingEmps.forEach(e => { if (e.employeeCode) codeOwner.set(e.employeeCode, e.user.email.toLowerCase()); });

  async function ensureDepartment(name: string): Promise<number | null> {
    const clean_ = htmlUnescape(clean(name));
    if (!clean_) return null;
    const key = clean_.toLowerCase();
    if (deptMap.has(key)) return deptMap.get(key)!;
    if (!COMMIT) { deptMap.set(key, -1); return -1; }
    const created = await prisma.department.create({ data: { name: clean_, companyId: companyId! } });
    deptMap.set(key, created.id);
    return created.id;
  }
  async function ensureDesignation(name: string, departmentId: number | null): Promise<number | null> {
    const clean_ = htmlUnescape(clean(name));
    if (!clean_) return null;
    const key = clean_.toLowerCase();
    if (desigMap.has(key)) return desigMap.get(key)!;
    if (!COMMIT) { desigMap.set(key, -1); return -1; }
    const created = await prisma.designation.create({
      data: { name: clean_, companyId: companyId!, departmentId: departmentId && departmentId > 0 ? departmentId : null },
    });
    desigMap.set(key, created.id);
    return created.id;
  }

  // Track email -> employeeId for the manager-linking pass.
  const emailToEmployeeId = new Map<string, number>();
  const nameToEmployeeId = new Map<string, number>();      // lowercased full name -> id
  const pendingManagers: { employeeId: number | null; managerName: string; email: string }[] = [];
  let synthCounter = 0;

  for (const emp of employees) {
    const p = emp.profile!;
    const email = clean(p.email).toLowerCase();
    try {
    const { firstName, lastName } = splitName(p.name);
    const fullName = clean(p.name).toLowerCase();

    const departmentId = await ensureDepartment(p.department);
    const designationId = await ensureDesignation(p.designation, departmentId);

    const dob = parseDate(p.date_of_birth);
    if (clean(p.date_of_birth) && !dob) report.dobSkipped++;

    // employeeCode must be unique in the company: only use it if it is free or
    // already ours; otherwise leave it blank and warn (a pre-existing ERP
    // employee holds it).
    let code: string | null = clean(p.employee_code) || null;
    if (code) {
      const owner = codeOwner.get(code);
      if (owner && owner !== email) {
        report.warnings.push(`employeeCode ${code} already used by ${owner}; left blank for ${email}`);
        code = null;
      }
    }

    // Fields we set on create / merge into existing.
    const profileFields: Record<string, any> = {
      firstName, lastName,
      phone: clean(p.mobile) || null,
      salutation: clean(p.salutation) || null,
      gender: normalizeGender(p.gender),
      address: clean(p.address) || null,
      workLocation: clean(p.business_address) || null,
      maritalStatus: clean(p.marital_status) || null,
      language: clean(p.language) || null,
      employmentType: employmentType(p.employment_type),
      employmentCategory: employmentCategory(p.employment_type),
      joiningDate: parseDate(p.joining_date),
      employeeCode: code,
      departmentId: departmentId && departmentId > 0 ? departmentId : (COMMIT ? departmentId : null),
      designationId: designationId && designationId > 0 ? designationId : (COMMIT ? designationId : null),
    };
    // dateOfBirth intentionally omitted unless we could parse a full date.
    if (dob) profileFields.dateOfBirth = dob;
    if (code) codeOwner.set(code, email);   // reserve so later rows can't reuse it

    // 1. Match or create the User + Employee
    const existingUser = await prisma.user.findUnique({
      where: { email }, include: { employee: true },
    });

    let employeeId: number | null = null;

    if (existingUser) {
      report.usersMatched++;
      if (existingUser.employee) {
        employeeId = existingUser.employee.id;
        const updates = mergeFields(existingUser.employee, profileFields);
        if (Object.keys(updates).length && COMMIT) {
          await prisma.employee.update({ where: { id: employeeId }, data: updates });
        }
        report.employeesUpdated++;
      } else if (COMMIT) {
        const e = await prisma.employee.create({
          data: { ...profileFields, companyId: companyId!, userId: existingUser.id, onboardingStatus: 'PENDING' } as Prisma.EmployeeUncheckedCreateInput,
        });
        employeeId = e.id;
        report.employeesCreated++;
      } else {
        report.employeesCreated++;
      }
    } else {
      report.usersCreated++;
      if (COMMIT) {
        const created = await prisma.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: { email, password: defaultPasswordHash, role: 'EMPLOYEE', companyId: companyId!, status: 'PENDING_VERIFICATION' },
          });
          const e = await tx.employee.create({
            data: { ...profileFields, companyId: companyId!, userId: u.id, onboardingStatus: 'PENDING' } as Prisma.EmployeeUncheckedCreateInput,
          });
          return e;
        });
        employeeId = created.id;
      }
      report.employeesCreated++;
    }

    // In a dry run created employees have no real id yet; use a synthetic one so
    // the name map is complete and the manager-linking report is meaningful.
    if (!employeeId && !COMMIT) employeeId = 900000000 + synthCounter++;
    if (employeeId) {
      emailToEmployeeId.set(email, employeeId);
      if (fullName) nameToEmployeeId.set(fullName, employeeId);
    }

    // Defer manager linking to the second pass.
    const mgr = stripTitle(p.reporting_to);
    if (mgr) pendingManagers.push({ employeeId, managerName: mgr, email });

    // 2. Emergency contacts — clear & recreate (idempotent)
    const contacts = (emp.emergency_contacts || []).filter(c => clean(c.mobile) && clean(c.name));
    if (contacts.length && COMMIT && employeeId) {
      await prisma.emergencyContact.deleteMany({ where: { employeeId } });
      for (const c of contacts) {
        await prisma.emergencyContact.create({
          data: {
            employeeId,
            name: clean(c.name),
            email: clean(c.email) || null,
            mobile: clean(c.mobile),
            relationship: clean(c.relationship) || 'Other',
          },
        });
        report.contactsCreated++;
      }
    } else {
      report.contactsCreated += contacts.length;
    }

    // 3. Documents -> ImageKit
    if (!SKIP_DOCS) {
      const docs = (emp.documents || []).filter(d => clean(d.file_url));
      const existingDocs = employeeId && COMMIT
        ? await prisma.employeeDocument.findMany({ where: { employeeId }, select: { fileName: true } })
        : [];
      const existingNames = new Set(existingDocs.map(d => d.fileName.toLowerCase()));

      for (const doc of docs) {
        const ext = path.extname(new URL(doc.file_url).pathname) || (doc.file_type ? `.${doc.file_type}` : '');
        const fileName = `${clean(doc.name) || 'document'}${ext}`;
        if (existingNames.has(fileName.toLowerCase())) { report.docsSkipped++; continue; }
        if (!COMMIT) { report.docsUploaded++; continue; }
        try {
          const resp = await axios.get<ArrayBuffer>(doc.file_url, { responseType: 'arraybuffer', timeout: 60000 });
          const buffer = Buffer.from(resp.data);
          const ikName = `${crypto.randomBytes(8).toString('hex')}${ext}`;
          const folder = `/employee_documents/${clean(p.employee_code) || emp.id}`;
          const url = await uploadToImageKit(buffer, ikName, folder);
          await prisma.employeeDocument.create({
            data: { employeeId: employeeId!, fileName, fileUrl: url, documentType: documentType(doc.name) },
          });
          existingNames.add(fileName.toLowerCase());
          report.docsUploaded++;
        } catch (err: any) {
          report.docsFailed++;
          report.warnings.push(`doc "${doc.name}" for ${email}: ${err.message}`);
        }
      }
    }

    console.log(`  ${emp.detail_accessible === false ? '[summary]' : '[full]   '} ${email.padEnd(34)} ${clean(p.name)}`);
    } catch (err: any) {
      report.employeesFailed++;
      report.warnings.push(`row ${email}: ${err.message}`);
      console.log(`  [FAILED]  ${email.padEnd(34)} ${err.message}`);
    }
  }

  // 4. Manager linking pass
  for (const pm of pendingManagers) {
    if (!pm.employeeId) continue;
    const targetId = nameToEmployeeId.get(pm.managerName.toLowerCase());
    if (!targetId) {
      if (!report.managersUnmatched.includes(pm.managerName)) report.managersUnmatched.push(pm.managerName);
      continue;
    }
    if (targetId === pm.employeeId) continue; // don't self-manage
    if (COMMIT) await prisma.employee.update({ where: { id: pm.employeeId }, data: { managerId: targetId } });
    report.managersLinked++;
  }

  printReport();
}

/** Return only the fields that are currently null/empty (unless --overwrite). */
function mergeFields(existing: any, incoming: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null) continue;
    const cur = existing[k];
    const isEmpty = cur == null || cur === '';
    if (OVERWRITE || isEmpty) {
      if (typeof v === 'number' && v < 0) continue; // dry-run sentinel dept/desig id
      out[k] = v;
    }
  }
  return out;
}

function printReport() {
  console.log('\n──────── report ────────');
  console.log(`Users:      ${report.usersCreated} to create, ${report.usersMatched} matched existing`);
  console.log(`Employees:  ${report.employeesCreated} to create, ${report.employeesUpdated} to update, ${report.employeesFailed} failed`);
  console.log(`Contacts:   ${report.contactsCreated}`);
  if (!SKIP_DOCS) console.log(`Documents:  ${report.docsUploaded} to upload, ${report.docsSkipped} already present, ${report.docsFailed} failed`);
  console.log(`Managers:   ${report.managersLinked} linked, ${report.managersUnmatched.length} names unmatched`);
  if (report.managersUnmatched.length) console.log(`            unmatched: ${report.managersUnmatched.join(', ')}`);
  console.log(`DOB skipped (day+month only, no year): ${report.dobSkipped}`);
  if (report.warnings.length) {
    console.log(`\nWarnings (${report.warnings.length}):`);
    report.warnings.slice(0, 30).forEach(w => console.log(`  - ${w}`));
    if (report.warnings.length > 30) console.log(`  ... and ${report.warnings.length - 30} more`);
  }
  console.log(COMMIT ? '\nDONE — changes committed.' : '\nDRY RUN — nothing written. Re-run with --commit to apply.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
