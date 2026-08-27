const { Client } = require('pg');
const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  await client.connect();
  const res = await client.query('SELECT id, name, key, "createdAt", "startDate" FROM "Project" ORDER BY "createdAt" ASC');
  console.table(res.rows);
  await client.end();
}
main().catch(console.error);
