const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  const res = await client.query('SELECT e.id, e."firstName", e."lastName", e."avatarUrl", u.email, d.name as designation FROM "Employee" e JOIN "User" u ON e."userId" = u.id LEFT JOIN "Designation" d ON e."designationId" = d.id WHERE e."firstName" IN (\'Piyushi\', \'Akshara\', \'Yash\')');
  console.table(res.rows);
  await client.end();
}
main().catch(console.error);
