const xlsx = require('xlsx');
const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const workbook = xlsx.readFile('/Users/mohitsingh/Downloads/CES_Allprojects.xlsx');
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  const data = xlsx.utils.sheet_to_json(sheet, { range: 1 });
  
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  
  let updatedCount = 0;
  for (const row of data) {
    let code = row['Code'];
    let projectName = row['Project'];
    if (code && projectName) {
      code = String(code).trim();
      projectName = String(projectName).trim();
      
      const res = await client.query('SELECT id, key FROM "Project" WHERE "name" ILIKE $1', [projectName]);
      if (res.rows.length > 0) {
        const projectId = res.rows[0].id;
        const currentKey = res.rows[0].key;
        if (currentKey !== code) {
          console.log(`Updating '${projectName}' key from ${currentKey} to ${code}`);
          await client.query('UPDATE "Project" SET key = $1 WHERE id = $2', [code, projectId]);
          updatedCount++;
        }
      } else {
        console.log(`Warning: Project '${projectName}' not found in DB.`);
      }
    }
  }
  console.log(`Successfully updated ${updatedCount} projects.`);
  await client.end();
}

main().catch(console.error);
