const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  
  // Get all issues
  const res = await client.query('SELECT i.id, i.key as issue_key, p.key as project_key FROM "Issue" i JOIN "Project" p ON i."projectId" = p.id');
  let updatedCount = 0;
  
  for (const row of res.rows) {
    const issueKey = row.issue_key;
    const projectKey = row.project_key;
    
    // Find where the dash is
    const dashIdx = issueKey.lastIndexOf('-');
    if (dashIdx !== -1) {
      const issueNum = issueKey.substring(dashIdx + 1);
      const expectedKey = `${projectKey}-${issueNum}`;
      
      if (issueKey !== expectedKey) {
        await client.query('UPDATE "Issue" SET key = $1 WHERE id = $2', [expectedKey, row.id]);
        updatedCount++;
      }
    }
  }
  
  console.log(`Successfully updated ${updatedCount} issue keys to match new project keys.`);
  await client.end();
}
main().catch(console.error);
