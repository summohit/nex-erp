import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Add type column to BoardColumn
    await client.query(`
      ALTER TABLE "BoardColumn" 
      ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'TODO';
    `);

    // Add rejectionReason column to Issue
    await client.query(`
      ALTER TABLE "Issue" 
      ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
    `);

    await client.query('COMMIT');
    console.log("Migration applied successfully!");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Migration failed", e);
  } finally {
    client.release();
    pool.end();
  }
}

main();
