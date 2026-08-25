const fs = require('fs');
const path = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.ts';

let content = fs.readFileSync(path, 'utf8');

// Update getFilteredEmployees
content = content.replace(
  /getFilteredEmployees\(\): any\[\] \{[\s\S]*?return this\.employees\.filter\(e =>\s*`\$\{e\.firstName\} \$\{e\.lastName\}`\.toLowerCase\(\)\.includes\(q\) \|\|\s*e\.designation\?\.name\?\.toLowerCase\(\)\.includes\(q\) \|\|\s*e\.department\?\.name\?\.toLowerCase\(\)\.includes\(q\)\s*\);\s*\}/,
  `getFilteredEmployees(): any[] {
    // Filter to only show people in the "finance" department as per user request
    let reps = this.employees.filter(e => e.department?.name?.toLowerCase().includes('finance'));
    
    if (this.ownerSearchQuery.trim()) {
      const q = this.ownerSearchQuery.toLowerCase();
      reps = reps.filter(e => 
        \`\${e.firstName} \${e.lastName}\`.toLowerCase().includes(q) ||
        e.designation?.name?.toLowerCase().includes(q)
      );
    }
    return reps;
  }`
);

fs.writeFileSync(path, content);
console.log('Patched leads.ts');
