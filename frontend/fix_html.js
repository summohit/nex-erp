const fs = require('fs');
const path = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.html';
let content = fs.readFileSync(path, 'utf8');

// Replace assignedTo. with assignedTo?.
content = content.replace(/assignedTo\./g, 'assignedTo?.');
// Replace addedBy. with addedBy?.
content = content.replace(/addedBy\./g, 'addedBy?.');

fs.writeFileSync(path, content);
console.log('Fixed leads.html');
