const fs = require('fs');
const path = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.html';

let content = fs.readFileSync(path, 'utf8');

// Replace "Phone Number" with "WhatsApp / Phone Number" in the Contact Details section
content = content.replace(
  /<div class="ldm-info-label">Phone Number<\/div>/g,
  '<div class="ldm-info-label">WhatsApp / Phone Number</div>'
);

// We should also replace the label for Contact Person -> Primary Contact Information (Name)
// Let's just leave Contact Person as it is or change it to Primary Contact Name
content = content.replace(
  /<div class="ldm-info-label">Contact Person<\/div>/g,
  '<div class="ldm-info-label">Primary Contact Name</div>'
);

fs.writeFileSync(path, content);
console.log('Patched detail modal labels');
