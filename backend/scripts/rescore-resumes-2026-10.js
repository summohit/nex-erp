/**
 * Re-score every resume that was scored against invented text.
 *
 * pdftotext (poppler-utils) was never installed on the production server, so
 * from 6 Aug to 14 Oct 2026 PdfService fell back to a made-up resume and every
 * "% Match" and AI assessment was computed from that, not from the candidate.
 *
 *   node scripts/rescore-resumes-2026-10.js            # dry run, writes nothing
 *   node scripts/rescore-resumes-2026-10.js --apply    # resets the scores
 *
 * --apply clears aiScore / aiSummary and sets isAiScored back to false for every
 * application that has a resume and was scored. The fake "% Match" disappears
 * at once; AiScoringCron then re-scores 5 applications every 2 minutes, newest
 * first, against the real PDF (one Groq call each). Run it only after the
 * backend with the fixed PdfService is deployed, or the cron would score them
 * against invented text all over again.
 *
 * Nothing about the candidate or their application is changed — only the three
 * AI scoring fields. Re-running is safe: already-reset rows are not counted.
 */
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const APPLY = process.argv.includes('--apply');
const WHERE = { isAiScored: true, resumeUrl: { not: null } };
const PER_RUN = 5;        // AiScoringCron batch size
const RUN_MINUTES = 2;    // AiScoringCron interval

(async () => {
  const total = await prisma.jobApplication.count({ where: WHERE });
  const withScore = await prisma.jobApplication.count({ where: { ...WHERE, aiScore: { not: null } } });
  const range = await prisma.jobApplication.aggregate({ where: WHERE, _min: { id: true }, _max: { id: true } });
  const sample = await prisma.jobApplication.findMany({
    where: WHERE, orderBy: { id: 'desc' }, take: 5,
    select: { id: true, fullName: true, aiScore: true, job: { select: { title: true } } },
  });

  console.log(`${APPLY ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  applications to re-score : ${total}  (ids ${range._min.id ?? '-'}–${range._max.id ?? '-'})`);
  console.log(`  showing a "% Match" now  : ${withScore}`);
  console.log('  newest, re-scored first  :');
  for (const a of sample) console.log(`    #${a.id}  ${a.fullName}  — ${a.job?.title ?? '?'}  (now ${a.aiScore ?? '-'}%)`);

  const hours = (total / PER_RUN) * RUN_MINUTES / 60;
  console.log(`\n  re-scoring time          : about ${hours.toFixed(1)} hours at ${PER_RUN} every ${RUN_MINUTES} min`);
  console.log(`  Groq calls               : about ${total}`);

  if (!APPLY) { console.log('\nRe-run with --apply to reset them.'); return; }

  const { count } = await prisma.jobApplication.updateMany({
    where: WHERE,
    data: { isAiScored: false, aiScore: null, aiSummary: null },
  });
  console.log(`\nDone. ${count} application(s) reset; the scoring cron will work through them, newest first.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
