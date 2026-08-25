const fs = require('fs');
const path = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.html';

let content = fs.readFileSync(path, 'utf8');

// Rename "Created / Added By" to "Lead Brought By"
content = content.replace(
  /<span class="ldm-info-label">Created \/ Added By<\/span>/g,
  '<span class="ldm-info-label">Lead Brought By</span>'
);

fs.writeFileSync(path, content);
console.log('Patched labels');
