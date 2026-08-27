const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  const res = await client.query('SELECT count(*) FROM "Issue"');
  console.log('Total issues:', res.rows[0].count);
  await client.end();
}
main().catch(console.error);
