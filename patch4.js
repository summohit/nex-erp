const fs = require('fs');

// Fix Prisma Schema
let schema = fs.readFileSync('backend/prisma/schema.prisma', 'utf8');

if (!schema.includes('convertedAt')) {
  schema = schema.replace(
    /convertedIssueId   Int\?      @unique/,
    "convertedIssueId   Int?      @unique\n  convertedAt        DateTime?"
  );
}

if (!schema.includes('hoursBefore')) {
  schema = schema.replace(
    /additionalHours  Float\?/,
    "additionalHours  Float?\n  hoursBefore      Float?\n  hoursAfter       Float?\n  budgetBefore     Float?\n  budgetAfter      Float?"
  );
}
fs.writeFileSync('backend/prisma/schema.prisma', schema);

// Fix NotificationsService create -> createNotification
let svc = fs.readFileSync('backend/src/projects/discussions/project-discussions.service.ts', 'utf8');
svc = svc.replaceAll('this.notifications.create(', 'this.notifications.createNotification(');
fs.writeFileSync('backend/src/projects/discussions/project-discussions.service.ts', svc);

// Fix tickets employeeId
let ts = fs.readFileSync('backend/src/projects/tickets/project-tickets.service.ts', 'utf8');
ts = ts.replace('raisedById: actorEmployeeId,', 'raisedById: actorEmployeeId as number,');
fs.writeFileSync('backend/src/projects/tickets/project-tickets.service.ts', ts);

// Fix budget request employeeId
let bs = fs.readFileSync('backend/src/projects/budget-requests/budget-requests.service.ts', 'utf8');
bs = bs.replace('requestedById: employeeId,', 'requestedById: employeeId as number,');
fs.writeFileSync('backend/src/projects/budget-requests/budget-requests.service.ts', bs);

console.log("Patches applied.");
