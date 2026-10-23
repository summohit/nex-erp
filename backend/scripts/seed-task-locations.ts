/**
 * Seed a company's task locations with India's states, union territories and
 * their principal cities — the same list the Add Location form suggests from.
 *
 *   npx ts-node --transpile-only scripts/seed-task-locations.ts <companyId>
 *
 * Only adds. Names that already exist (at the same level, under the same
 * parent, ignoring case) are skipped, so it is safe to run again. Runs in one
 * transaction: it all lands, or nothing does.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { INDIA_LOCATIONS } from '../../frontend/src/app/shared/components/task-locations/india-locations';

async function main() {
  const companyId = Number(process.argv[2]);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error('Usage: seed-task-locations.ts <companyId>');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const company = await db.query('SELECT name FROM "Company" WHERE id = $1', [companyId]);
    if (!company.rowCount) throw new Error(`No company ${companyId}`);
    console.log(`Company ${companyId}: ${company.rows[0].name}`);

    // Existing rows, keyed by parent and lower-cased name, so re-runs skip them.
    const existing = await db.query('SELECT id, name, "parentId" FROM "TaskLocation" WHERE "companyId" = $1', [companyId]);
    const key = (parentId: number | null, name: string) => `${parentId ?? 0}:${name.toLowerCase()}`;
    const ids = new Map<string, number>(existing.rows.map((r) => [key(r.parentId, r.name), r.id]));

    let states = 0;
    let cities = 0;
    const insert = async (name: string, level: string, parentId: number | null, position: number) => {
      const found = ids.get(key(parentId, name));
      if (found) return { id: found, created: false };
      const row = await db.query(
        `INSERT INTO "TaskLocation" (name, level, "parentId", "isActive", position, "companyId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, true, $4, $5, now(), now()) RETURNING id`,
        [name, level, parentId, position, companyId]);
      ids.set(key(parentId, name), row.rows[0].id);
      return { id: row.rows[0].id as number, created: true };
    };

    const names = Object.keys(INDIA_LOCATIONS).sort((a, b) => a.localeCompare(b));
    for (const [i, stateName] of names.entries()) {
      const state = await insert(stateName, 'STATE', null, i);
      if (state.created) states++;
      for (const [j, city] of INDIA_LOCATIONS[stateName].entries()) {
        if ((await insert(city, 'CITY', state.id, j)).created) cities++;
      }
    }

    await db.query('COMMIT');
    console.log(`Added ${states} states/UTs and ${cities} cities`);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
