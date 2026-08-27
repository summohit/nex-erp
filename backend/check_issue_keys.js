const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  const res = await client.query('SELECT i.key as issue_key, p.key as project_key FROM "Issue" i JOIN "Project" p ON i."projectId" = p.id LIMIT 5');
  console.table(res.rows);
  await client.end();
}
main().catch(console.error);
