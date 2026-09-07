/**
 * Import CES Tech employee profile photos into NEX ERP avatarUrl.
 *
 * Reads the Workway roster (scraper/out_hr/roster.json, which carries each
 * employee's email + CloudFront image_url), skips Workway's default placeholder
 * (gravatar.png), downloads each real photo, uploads it to ImageKit, and sets
 * Employee.avatarUrl. Matches employees by email; idempotent (skips anyone who
 * already has an ImageKit avatar unless --overwrite).
 *
 *   npx ts-node import-ces-avatars.ts --file ../scraper/out_hr/roster.json           # dry run
 *   npx ts-node import-ces-avatars.ts --file ../scraper/out_hr/roster.json --commit
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';

dotenv.config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}
const FILE = getArg('file') || '../scraper/out_hr/roster.json';
const COMMIT = process.argv.includes('--commit');
const OVERWRITE = process.argv.includes('--overwrite');
const COMPANY_ARG = getArg('company') ? parseInt(getArg('company')!, 10) : null;
const IMAGEKIT_ENDPOINT = 'https://upload.imagekit.io/api/v1/files/upload';

async function uploadToImageKit(buffer: Buffer, fileName: string, folder: string): Promise<string> {
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!privateKey) throw new Error('IMAGEKIT_PRIVATE_KEY not set');
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

const isDefault = (url: string) => /gravatar\.png$|\/default|placeholder/i.test(url);

async function main() {
  const rows = JSON.parse(fs.readFileSync(path.resolve(FILE), 'utf-8')) as any[];
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${rows.length} roster row(s)\n`);

  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const companyId = COMPANY_ARG || (companies.length === 1 ? companies[0].id : null);
  if (!companyId) { console.error('Pass --company <id>'); process.exit(1); }

  let uploaded = 0, skippedDefault = 0, skippedExisting = 0, unmatched = 0, failed = 0;

  for (const r of rows) {
    const email = String(r.email || '').toLowerCase().trim();
    const imageUrl = String(r.image_url || '').trim();
    if (!email || !imageUrl) continue;
    if (isDefault(imageUrl)) { skippedDefault++; continue; }

    const emp = await prisma.employee.findFirst({
      where: { companyId, user: { email } }, select: { id: true, avatarUrl: true, firstName: true },
    });
    if (!emp) { unmatched++; console.log(`  [no match] ${email}`); continue; }
    if (emp.avatarUrl && emp.avatarUrl.includes('ik.imagekit.io') && !OVERWRITE) { skippedExisting++; continue; }

    if (!COMMIT) { uploaded++; console.log(`  [would set] ${email}`); continue; }
    try {
      const resp = await axios.get<ArrayBuffer>(imageUrl, {
        responseType: 'arraybuffer', timeout: 60000, headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const ext = path.extname(new URL(imageUrl).pathname) || '.png';
      const url = await uploadToImageKit(Buffer.from(resp.data), `${crypto.randomBytes(8).toString('hex')}${ext}`, '/employee_avatars');
      await prisma.employee.update({ where: { id: emp.id }, data: { avatarUrl: url } });
      uploaded++;
      console.log(`  [set] ${email.padEnd(34)} ${url}`);
    } catch (err: any) {
      failed++;
      console.log(`  [FAIL] ${email}: ${err.message}`);
    }
  }

  console.log('\n──────── report ────────');
  console.log(`avatars ${COMMIT ? 'set' : 'to set'}: ${uploaded}`);
  console.log(`skipped (default gravatar): ${skippedDefault}`);
  console.log(`skipped (already have ImageKit avatar): ${skippedExisting}`);
  console.log(`unmatched emails: ${unmatched}`);
  console.log(`failed: ${failed}`);
  console.log(COMMIT ? '\nDONE.' : '\nDRY RUN — re-run with --commit.');
}

main()
  .catch(e => { console.error('FATAL:', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
