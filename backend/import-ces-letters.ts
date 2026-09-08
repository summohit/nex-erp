/**
 * Import CES Tech (Worksuite) letter templates and issued letters.
 *
 *   npx ts-node import-ces-letters.ts --file ../scraper/out_hr/letters.json            # dry run
 *   npx ts-node import-ces-letters.ts --file ../scraper/out_hr/letters.json --commit
 *
 * Templates keep Worksuite's ##MERGE_TAG## bodies verbatim — our renderer speaks
 * the same syntax, so nothing needs rewriting. Issued letters carry the body as
 * it was rendered at the time, which is exactly the snapshot we want to preserve.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function getArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const FILE = getArg('file');
const COMMIT = process.argv.includes('--commit');
const COMPANY_ID = parseInt(getArg('company') || '1', 10);
const SKIP_ISSUED = process.argv.includes('--templates-only');

if (!FILE) {
  console.error('Usage: npx ts-node import-ces-letters.ts --file <letters.json> [--commit] [--templates-only]');
  process.exit(1);
}

function parseDate(s: any): Date | null {
  if (!s) return null;
  // Worksuite writes dd-mm-yyyy, which Date() reads as month-first.
  const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  const d = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Resolve ##MERGE_TAGS## against the employee, mirroring LettersService. */
function renderBody(body: string, emp: any, company: any, issuedAt: Date | null, signer?: any): string {
  if (!body || !emp) return body;
  const values: Record<string, string> = {
    '##EMPLOYEE_NAME##': [emp.firstName, emp.lastName].filter(Boolean).join(' '),
    '##EMPLOYEE_ID##': emp.employeeCode || '',
    '##EMPLOYEE_DESIGNATION##': emp.designation?.name || '',
    '##EMPLOYEE_DEPARTMENT##': emp.department?.name || '',
    '##EMPLOYEE_ADDRESS##': emp.address || '',
    '##EMPLOYEE_EMAIL##': emp.user?.email || '',
    '##EMPLOYEE_MOBILE##': emp.phone || '',
    '##EMPLOYEE_JOINING_DATE##': fmtDate(emp.joiningDate),
    '##COMPANY_NAME##': company?.name || '',
    '##CONTACT_ADDRESS##': company?.address || '',
    // Historic letters date from when they were issued, not today.
    '##CURRENT_DATE##': fmtDate(issuedAt),
    // Worksuite's creator_id is whoever issued the letter — the signatory.
    '##SIGNATORY##': signer ? [signer.firstName, signer.lastName].filter(Boolean).join(' ') : '',
    '##SIGNATORY_DESIGNATION##': signer?.designation?.name || '',
    '##SIGNATORY_DEPARTMENT##': signer?.department?.name || '',
  };
  let out = body;
  for (const tag of Object.keys(values).sort((a, b) => b.length - a.length)) {
    out = out.split(tag).join(values[tag]);
  }
  return out;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.resolve(FILE!), 'utf-8'));
  const templates: any[] = data.templates || [];
  const issued: any[] = data.letters || [];
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${templates.length} template(s), ${issued.length} issued letter(s)\n`);

  // ── templates ──────────────────────────────────────────────────────────
  const existing = await prisma.letterTemplate.findMany({ where: { companyId: COMPANY_ID } });
  const byTitle = new Map(existing.map(t => [t.title.trim().toLowerCase(), t]));
  const idByWorkwayId = new Map<string, number>();
  let created = 0, updated = 0;

  for (const [i, t] of templates.entries()) {
    const title = String(t.title || '').trim();
    if (!title) continue;
    const body = String(t.description || '');
    const hit = byTitle.get(title.toLowerCase());
    if (hit) {
      if (COMMIT) await prisma.letterTemplate.update({
        where: { id: hit.id }, data: { body, displayOrder: i },
      });
      idByWorkwayId.set(String(t.id), hit.id);
      updated++;
    } else {
      let id = -1;
      if (COMMIT) {
        id = (await prisma.letterTemplate.create({
          data: { companyId: COMPANY_ID, title, body, displayOrder: i },
        })).id;
      }
      idByWorkwayId.set(String(t.id), id);
      created++;
    }
    const tags = (body.match(/##[A-Z_]+##/g) || []).length;
    console.log(`  ${hit ? 'update' : 'create'} ${title.padEnd(46)} ${body.length} chars, ${tags} merge tag(s)`);
  }

  // ── issued letters ─────────────────────────────────────────────────────
  let letterRows = 0;
  let ambiguousCount = 0;
  const unmatched: string[] = [];
  if (!SKIP_ISSUED) {
    const bridge = JSON.parse(fs.readFileSync(
      path.resolve(path.dirname(FILE!), 'cestech-full.json'), 'utf-8'));
    const wwIdToEmail = new Map<string, string>();
    for (const e of bridge) {
      const em = (e.profile?.email || '').toLowerCase();
      if (e.id && em) wwIdToEmail.set(String(e.id), em);
    }
    const emps = await prisma.employee.findMany({
      where: { companyId: COMPANY_ID },
      select: {
        id: true, firstName: true, lastName: true, employeeCode: true,
        address: true, phone: true, joiningDate: true,
        user: { select: { email: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    const empById = new Map(emps.map(e => [e.id, e]));
    const company = await prisma.company.findUnique({ where: { id: COMPANY_ID } });

    const byEmail = new Map(emps.map(e => [e.user.email.toLowerCase(), e.id]));
    // creator_id is a Workway user id; bridge it to our employee the same way.
    const signerFor = (creatorId: any) => {
      const em = wwIdToEmail.get(String(creatorId ?? ''));
      const id = em ? byEmail.get(em) : undefined;
      return id ? empById.get(id) : undefined;
    };
    // Name is the fallback key; ambiguous names are skipped rather than guessed.
    const byName = new Map<string, number | null>();
    for (const e of emps) {
      const key = `${e.firstName} ${e.lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
      byName.set(key, byName.has(key) ? null : e.id);
    }

    const rows: any[] = [];
    const ambiguous: string[] = [];
    for (const l of issued) {
      // Prefer the real Workway user id; fall back to the displayed name.
      const email = wwIdToEmail.get(String(l.user_real_id ?? ''));
      let employeeId = email ? byEmail.get(email) : undefined;
      if (!employeeId) {
        const key = String(l.employee_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const hit = key ? byName.get(key) : undefined;
        if (hit === null) { ambiguous.push(l.employee_name); continue; }
        employeeId = hit ?? undefined;
      }
      if (!employeeId) { unmatched.push(String(l.employee_name || l.user_id)); continue; }
      const templateId = idByWorkwayId.get(String(l.template_real_id ?? l.template_id));
      rows.push({
        companyId: COMPANY_ID,
        employeeId,
        templateId: templateId && templateId > 0 ? templateId : null,
        // `name` is usually blank; the template title is the meaningful label.
        title: String(l.name || l.template_id || 'Letter').trim(),
        // Worksuite stores the body with tags intact and substitutes at view
        // time. We resolve them here so the stored letter is a real snapshot.
        body: renderBody(String(l.description || ''), empById.get(employeeId), company,
                         parseDate(l.created_at), signerFor(l.creator_id)),
        marginTop: parseFloat(l.top) || 20,
        marginBottom: parseFloat(l.bottom) || 20,
        marginLeft: parseFloat(l.left) || 20,
        marginRight: parseFloat(l.right) || 20,
        createdAt: parseDate(l.created_at) || new Date(),
      });
    }
    letterRows = rows.length;
    ambiguousCount = ambiguous.length;

    if (COMMIT && rows.length) {
      // Idempotent: this importer owns every letter it created for these staff.
      await prisma.generatedLetter.deleteMany({
        where: { companyId: COMPANY_ID, employeeId: { in: [...new Set(rows.map(r => r.employeeId))] } },
      });
      for (let i = 0; i < rows.length; i += 200) {
        await prisma.generatedLetter.createMany({ data: rows.slice(i, i + 200) });
      }
    }
  }

  console.log('\n──────── report ────────');
  console.log(`Templates:      ${created} created, ${updated} updated`);
  console.log(`Issued letters: ${SKIP_ISSUED ? 'skipped' : letterRows}`);
  if (typeof ambiguousCount !== 'undefined' && ambiguousCount) {
    console.log(`  skipped, duplicate employee name: ${ambiguousCount}`);
  }
  if (unmatched.length) {
    console.log(`  skipped, no matching employee: ${unmatched.length} — ${[...new Set(unmatched)].slice(0, 6).join(', ')}`);
  }
  console.log(COMMIT ? '\nDONE — committed.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
