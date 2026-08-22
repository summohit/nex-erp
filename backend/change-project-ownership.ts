import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Usage:
//   npx ts-node change-project-ownership.ts --email info@ces-pl.com [--company <companyId>] [--commit]
//
// Sets Project.leadId to the Employee linked to the given user email, for all
// projects (optionally scoped to one companyId), and ensures that Employee is
// a ProjectMember with role ADMIN on each affected project.
//
// Runs as a dry run by default — pass --commit to actually write.

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const EMAIL = getArg('email');
const COMPANY_ID = getArg('company') ? parseInt(getArg('company')!, 10) : undefined;
const COMMIT = process.argv.includes('--commit');

if (!EMAIL) {
  console.error('Usage: npx ts-node change-project-ownership.ts --email <email> [--company <companyId>] [--commit]');
  process.exit(1);
}

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '.env');
  const m = fs.readFileSync(envPath, 'utf8').match(/DATABASE_URL="(.*)"/);
  if (!m) throw new Error('DATABASE_URL not found in .env');
  return m[1];
}

const pool = new Pool({
  connectionString: loadDatabaseUrl(),
  connectionTimeoutMillis: 15000,
});

async function main() {
  const userRes = await pool.query('SELECT id, email FROM "User" WHERE email = $1', [EMAIL]);
  if (userRes.rows.length === 0) {
    console.error(`No User found with email ${EMAIL}`);
    process.exit(1);
  }
  const userId = userRes.rows[0].id;

  const empRes = await pool.query(
    'SELECT id, "firstName", "lastName", "companyId" FROM "Employee" WHERE "userId" = $1',
    [userId]
  );
  if (empRes.rows.length === 0) {
    console.error(`User ${EMAIL} (id=${userId}) has no linked Employee record. Cannot set as project lead.`);
    process.exit(1);
  }
  const employee = empRes.rows[0];
  console.log(`Target: ${EMAIL} -> Employee id=${employee.id} (${employee.firstName} ${employee.lastName ?? ''}) companyId=${employee.companyId}`);

  const projParams: any[] = [];
  let projWhere = '';
  if (COMPANY_ID !== undefined) {
    projWhere = 'WHERE p."companyId" = $1';
    projParams.push(COMPANY_ID);
  }

  const projects = await pool.query(
    `SELECT p.id, p.name, p."leadId", p."companyId" FROM "Project" p ${projWhere} ORDER BY p.id`,
    projParams
  );

  console.log(`\nFound ${projects.rows.length} project(s)${COMPANY_ID !== undefined ? ` in companyId=${COMPANY_ID}` : ' across all companies'}.`);

  const crossCompany = projects.rows.filter((p) => p.companyId !== employee.companyId);
  if (crossCompany.length > 0) {
    console.log(`\nWARNING: ${crossCompany.length} project(s) belong to a different companyId than the target employee (${employee.companyId}):`);
    for (const p of crossCompany) console.log(`  - project id=${p.id} "${p.name}" companyId=${p.companyId}`);
  }

  console.log(`\nPlanned changes (${COMMIT ? 'COMMIT' : 'DRY RUN'}):`);
  for (const p of projects.rows) {
    console.log(`  project id=${p.id} "${p.name}": leadId ${p.leadId} -> ${employee.id}`);
  }

  if (!COMMIT) {
    console.log('\nDry run only. Re-run with --commit to apply.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of projects.rows) {
      await client.query('UPDATE "Project" SET "leadId" = $1 WHERE id = $2', [employee.id, p.id]);

      const existingMember = await client.query(
        'SELECT id, role FROM "ProjectMember" WHERE "projectId" = $1 AND "employeeId" = $2',
        [p.id, employee.id]
      );
      if (existingMember.rows.length === 0) {
        await client.query(
          'INSERT INTO "ProjectMember" ("projectId", "employeeId", role, "joinedAt") VALUES ($1, $2, $3, now())',
          [p.id, employee.id, 'ADMIN']
        );
      } else if (existingMember.rows[0].role !== 'ADMIN') {
        await client.query('UPDATE "ProjectMember" SET role = $1 WHERE id = $2', ['ADMIN', existingMember.rows[0].id]);
      }
    }
    await client.query('COMMIT');
    console.log(`\nCommitted: ${projects.rows.length} project(s) reassigned to ${EMAIL}.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error, rolled back:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
