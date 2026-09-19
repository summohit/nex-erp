/**
 * Imports the appreciations exported from Workway into the NEX Appreciation
 * module. Reads scripts/workway-appreciations.json — review that file first,
 * it is the whole payload in readable form.
 *
 * Re-runnable: every step checks for what it would create before creating it,
 * so a second run reports "exists" rather than producing duplicate awards.
 *
 *   node scripts/import-workway-appreciations.js --company 1 --dry-run
 *   node scripts/import-workway-appreciations.js --company 1
 *
 * Photos are pulled off Workway's CDN and re-uploaded to ImageKit rather than
 * hot-linked: the moment the Workway subscription lapses, linked images become
 * broken images in NEX. ImageKit is where every other upload in this product
 * lives (see UploadController) — needs IMAGEKIT_PRIVATE_KEY in .env.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Prisma 7 needs a driver adapter, same as PrismaService does in the app.
// DATABASE_URL comes from backend/.env, which Nest normally loads for us.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const COMPANY_ID = Number(args[args.indexOf('--company') + 1]) || 1;

const IMAGEKIT_FOLDER = '/appreciation';

const log = (...a) => console.log(...a);

/**
 * Pull the photo off Workway's CDN and put it on ImageKit, the same way
 * UploadController does. Returns the URL to store, or null if it could not be
 * re-hosted — a missing photo is not worth failing the import over, since the
 * citation text is the part that matters.
 */
async function rehostPhoto(sourceUrl) {
  if (DRY_RUN) {
    log(`    would re-host ${sourceUrl}`);
    return '(dry run)';
  }

  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('    WARNING: IMAGEKIT_PRIVATE_KEY not set; importing without the photo');
    return null;
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) {
    console.warn(`    WARNING: photo fetch failed (${res.status}); importing without it`);
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(new URL(sourceUrl).pathname) || '.jpg';
  const filename = crypto.randomBytes(16).toString('hex') + ext;

  const form = new FormData();
  form.append('file', buffer.toString('base64'));
  form.append('fileName', filename);
  form.append('folder', IMAGEKIT_FOLDER);

  const upload = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(privateKey + ':').toString('base64') },
    body: form,
  });
  if (!upload.ok) {
    console.warn(`    WARNING: ImageKit upload failed (${upload.status}); importing without the photo`);
    return null;
  }
  const { url } = await upload.json();
  log(`    re-hosted to ImageKit`);
  return url;
}

async function main() {
  const payload = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'workway-appreciations.json'), 'utf8'),
  );

  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID } });
  if (!company) throw new Error(`Company ${COMPANY_ID} not found`);
  log(`Importing into company ${COMPANY_ID} (${company.name})${DRY_RUN ? ' — DRY RUN' : ''}\n`);

  // --- Award types -------------------------------------------------------
  const awardTypeByTitle = new Map();
  for (const t of payload.awardTypes) {
    const existing = await prisma.awardType.findFirst({
      where: { companyId: COMPANY_ID, title: t.title },
    });
    if (existing) {
      log(`award type "${t.title}" exists (id ${existing.id})`);
      awardTypeByTitle.set(t.title, existing);
      continue;
    }
    if (DRY_RUN) {
      log(`award type "${t.title}" WOULD BE CREATED`);
      awardTypeByTitle.set(t.title, { id: -1 });
      continue;
    }
    const created = await prisma.awardType.create({
      data: { ...t, companyId: COMPANY_ID, status: true },
    });
    log(`award type "${t.title}" created (id ${created.id})`);
    awardTypeByTitle.set(t.title, created);
  }

  // --- Appreciations -----------------------------------------------------
  let created = 0, skipped = 0;
  for (const row of payload.appreciations) {
    const label = `${row.employee.firstName} ${row.employee.lastName} — ${row.awardTitle}`;
    log(`\n${label}`);

    // Matched by name: Workway's employee ids mean nothing in this database.
    // Refuses on ambiguity rather than guessing which namesake was meant.
    const matches = await prisma.employee.findMany({
      where: {
        companyId: COMPANY_ID,
        firstName: { equals: row.employee.firstName, mode: 'insensitive' },
        lastName: { equals: row.employee.lastName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (matches.length !== 1) {
      console.error(`    SKIPPED: ${matches.length} employees match that name`);
      skipped++;
      continue;
    }
    const employeeId = matches[0].id;
    const awardType = awardTypeByTitle.get(row.awardTitle);
    const givenDate = new Date(`${row.givenDate}T00:00:00.000Z`);

    const duplicate = await prisma.appreciation.findFirst({
      where: { companyId: COMPANY_ID, employeeId, awardTypeId: awardType.id, givenDate },
    });
    if (duplicate) {
      log(`    already imported (id ${duplicate.id})`);
      skipped++;
      continue;
    }

    const photoUrl = await rehostPhoto(row.sourceImageUrl);

    if (DRY_RUN) {
      log(`    WOULD CREATE (employee ${employeeId}, ${row.givenDate})`);
      created++;
      continue;
    }
    const appreciation = await prisma.appreciation.create({
      data: {
        companyId: COMPANY_ID,
        employeeId,
        awardTypeId: awardType.id,
        givenDate,
        summary: row.summary,
        photoUrl,
      },
    });
    log(`    created (id ${appreciation.id})`);
    created++;
  }

  log(`\n${DRY_RUN ? 'Would create' : 'Created'}: ${created}   Skipped: ${skipped}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
