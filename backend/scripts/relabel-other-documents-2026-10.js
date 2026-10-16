/**
 * One-time: give documents uploaded as "Other" (or a too-broad type) their
 * proper type from the file name, so people who already uploaded are not
 * asked again by the profile reminder (16 Oct 2026).
 *
 *   node scripts/relabel-other-documents-2026-10.js            # dry run, writes nothing
 *   node scripts/relabel-other-documents-2026-10.js --apply    # writes
 *
 * Only "Other", "Passport" (photos filed there), and "Educational
 * Certificate" (10th/12th/degree filed there) are looked at. A name that
 * matches no rule, or more than one type, is left alone and listed.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
const APPLY = process.argv.includes('--apply');

// Checked against the file name without its extension, lower-cased.
const RULES = [
  ['Passport Size Photo', /passport[\s._-]*size|\bphoto(graph)?\b|\bpp[\s._-]*size/],
  ['Resume / CV', /\bcv\b|resume|bio[\s._-]*data/],
  ['Aadhaar Card', /aa?dh?aa?r|adhar/],
  ['PAN Card', /\bpan\b|pan[\s._-]*card/],
  ['10th Marksheet', /\b10[\s._-]*th\b|\btenth\b|\bx(th)?\b[\s._-]*(mark|class)|matric|\bssc\b|high[\s._-]*school/],
  ['12th Marksheet', /\b12[\s._-]*th\b|\btwelfth\b|\bxii\b|intermediate|\bhsc\b|senior[\s._-]*secondary/],
  ['Post-Graduation Degree', /post[\s._-]*grad|\bmasters?\b|\bmba\b|\bmca\b|\bm[\s._-]?tech\b|\bm[\s._-]?sc\b|\bm[\s._-]?com\b/],
  ['Graduation Degree', /\bgraduat|\bdegree\b|\bb[\s._-]?tech\b|\bbca\b|\bb[\s._-]?sc\b|\bb[\s._-]?com\b|\bbba\b|\bb[\s._-]?e\b|diploma|dipolma|bachelor/],
  ['Bank Proof / Cancelled Cheque', /cheque|\bcheck\b|passbook|bank|account[\s._-]*details/],
  ['Reference Person', /referen|referee/],
  ['UAN', /\buan\b|\bepf\b|\bpf[\s._-]*(no|number)/],
  ['Relieving / Experience Letter', /relieving|experi[ae]nce|\bexp[\s._-]*letter/],
  ['Payslips', /pay[\s._-]*slip|salary[\s._-]*slip|\bsalary\b/],
  ['Driving License / Voter ID', /driving|licen[cs]e|\bdl\b|voter/],
  ['Passport', /passport/],
];

function guess(fileName) {
  const base = String(fileName || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[_]+/g, ' ');
  const hits = RULES.filter(([, re]) => re.test(base)).map(([type]) => type);
  // "Passport size photo" also matches "Passport"; post-grad also says "degree".
  const drop = new Set();
  if (hits.includes('Passport Size Photo')) drop.add('Passport');
  if (hits.includes('Post-Graduation Degree')) drop.add('Graduation Degree');
  const uniq = [...new Set(hits.filter((h) => !drop.has(h)))];
  return uniq.length === 1 ? { type: uniq[0] } : { type: null, ambiguous: uniq };
}

(async () => {
  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  const docs = await prisma.employeeDocument.findMany({
    where: { documentType: { in: ['Other', 'Passport', 'Educational Certificate'] } },
    select: {
      id: true, fileName: true, documentType: true,
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ employeeId: 'asc' }, { id: 'asc' }],
  });

  const changes = [];
  const left = [];
  for (const d of docs) {
    const g = guess(d.fileName);
    if (!g.type) {
      if (d.documentType === 'Other') left.push({ d, why: g.ambiguous?.length ? `could be ${g.ambiguous.join(' / ')}` : 'no match' });
      continue;
    }
    if (g.type === d.documentType) continue;
    // A real passport stays a passport; only a photo filed as Passport moves.
    if (d.documentType === 'Passport' && g.type !== 'Passport Size Photo') continue;
    // An education file only moves to an education type.
    if (d.documentType === 'Educational Certificate'
      && !['10th Marksheet', '12th Marksheet', 'Graduation Degree', 'Post-Graduation Degree'].includes(g.type)) continue;
    changes.push({ d, to: g.type });
  }

  const byType = {};
  for (const c of changes) byType[c.to] = (byType[c.to] || 0) + 1;
  console.log(`Will re-label ${changes.length} of ${docs.length} documents:`);
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  → ${t}`);
  console.log('\nExamples:');
  for (const c of changes.slice(0, 25)) {
    console.log(`  #${c.d.id} ${c.d.employee.firstName} ${c.d.employee.lastName || ''}: "${c.d.fileName}"  ${c.d.documentType} → ${c.to}`);
  }
  console.log(`\nLeft as "Other" (${left.length}), people re-upload these under the right type:`);
  for (const l of left.slice(0, 25)) console.log(`  #${l.d.id} "${l.d.fileName}" — ${l.why}`);
  if (left.length > 25) console.log(`  … and ${left.length - 25} more`);

  if (!APPLY) { console.log('\nRe-run with --apply to write.'); return; }
  for (const c of changes) {
    await prisma.employeeDocument.update({ where: { id: c.d.id }, data: { documentType: c.to } });
  }
  console.log(`\nRe-labelled ${changes.length} documents.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
