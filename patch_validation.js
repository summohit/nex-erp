const fs = require('fs');
const path = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.ts';

let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /const isTab1Valid = this\.newLeadData\.title\.trim\(\) && this\.newLeadData\.companyName\.trim\(\);\s*const isTab2Valid = this\.newLeadData\.email\.trim\(\) && this\.newLeadData\.phone\.trim\(\);\s*if \(!isTab1Valid\) \{\s*this\.activeTab = 1;\s*return;\s*\}\s*if \(!isTab2Valid\) \{\s*this\.activeTab = 2;\s*return;\s*\}/,
  `// Validation: Title, Company Name, Email, and Phone are required
    const isTab1Valid = this.newLeadData.title.trim() && this.newLeadData.companyName.trim() && this.newLeadData.email.trim() && this.newLeadData.phone.trim();
    
    if (!isTab1Valid) {
      this.activeTab = 1;
      return;
    }`
);

fs.writeFileSync(path, content);
console.log('Patched leads.ts validation');
