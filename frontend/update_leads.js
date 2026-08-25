const fs = require('fs');

// 1. Update CSS modal height and currency input styling
let cssPath = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.css';
let css = fs.readFileSync(cssPath, 'utf8');

css = css.replace(/min-height:\s*560px;/g, 'min-height: 700px;');

css = css.replace(/\.currency-input {\n  flex: 1;/g, 
`.currency-input {
  flex: 1;
  background-color: #fff;
  transition: all 0.2s;
  box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);`);

css = css.replace(/\.currency-symbol-addon {/g,
`.currency-symbol-addon {
  background: #f8fafc;
  color: #64748b;
  font-size: 15px;
  font-weight: 600;
  border-color: #cbd5e1;`);

fs.writeFileSync(cssPath, css);

// 2. Update HTML to show Department name
let htmlPath = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.html';
let html = fs.readFileSync(htmlPath, 'utf8');

// For getFilteredEmployees() and getFilteredBroughtByEmployees()
html = html.replace(/<span class="owner-designation" \*ngIf="emp\.designation\?\.name">\{\{emp\.designation\?\.name\}\}<\/span>/g, 
`<span class="owner-designation" *ngIf="emp.designation?.name">
  {{emp.designation?.name}}
  <span *ngIf="emp.department?.name" style="opacity: 0.75; font-size: 0.95em;">({{emp.department?.name}})</span>
</span>`);

// Ensure expected value doesn't go below 0 on the UI side by adding oninput fallback
html = html.replace(/<input([^>]+?)\[\(\ngModel\)\]="newLeadData\.value"([^>]+?)>/g, 
`<input$1[(ngModel)]="newLeadData.value"$2 oninput="this.value = Math.max(0, this.value || 0)">`);

fs.writeFileSync(htmlPath, html);
console.log('UI Updated');
