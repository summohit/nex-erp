const fs = require('fs');
let schema = fs.readFileSync('backend/prisma/schema.prisma', 'utf8');
const missingModels = `

model ProjectTicket {
  id                 Int       @id @default(autoincrement())
  ticketNumber       String    @unique
  title              String
  description        String?   @db.Text
  projectId          Int
  project            Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  companyId          Int
  company            Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  raisedById         Int
  raisedBy           Employee  @relation("TicketRaisedBy", fields: [raisedById], references: [id])
  proposedAssigneeId Int?
  proposedAssignee   Employee? @relation("TicketProposedAssignee", fields: [proposedAssigneeId], references: [id])
  priority           String    @default("MEDIUM")
  startDate          DateTime?
  dueDate            DateTime?
  estimatedHours     Float?
  status             String    @default("REQUESTED") // REQUESTED, APPROVED, REJECTED
  
  reviewedById       Int?
  reviewedBy         Employee? @relation("TicketReviewedBy", fields: [reviewedById], references: [id])
  reviewedAt         DateTime?
  rejectionReason    String?   @db.Text
  convertedIssueId   Int?      @unique
  convertedIssue     Issue?    @relation(fields: [convertedIssueId], references: [id])

  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  @@index([companyId])
  @@index([projectId])
}

model ProjectBudgetRequest {
  id               Int       @id @default(autoincrement())
  projectId        Int
  project          Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  companyId        Int
  company          Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  requestedById    Int
  requestedBy      Employee  @relation("BudgetRequestedBy", fields: [requestedById], references: [id])
  
  additionalHours  Float?
  additionalBudget Float?
  reason           String    @db.Text
  attachmentUrl    String?
  attachmentName   String?
  
  status           String    @default("REQUESTED")
  reviewedById     Int?
  reviewedBy       Employee? @relation("BudgetReviewedBy", fields: [reviewedById], references: [id])
  reviewedAt       DateTime?
  rejectionReason  String?   @db.Text

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([companyId])
  @@index([projectId])
}
`;
if (!schema.includes('model ProjectTicket {')) {
  schema += missingModels;
  schema = schema.replace(
    /(model Project \{[\s\S]*?)(  @@unique\(\[key, companyId\]\))/m,
    (match, p1, p2) => p1 + "  projectTickets ProjectTicket[]\n  budgetRequests ProjectBudgetRequest[]\n\n" + p2
  );
  schema = schema.replace(
    /(model Employee \{[\s\S]*?)(  @@unique\(\[companyId, employeeCode\]\))/m,
    (match, p1, p2) => p1 + "  projectTicketsRaised ProjectTicket[] @relation(\"TicketRaisedBy\")\n  projectTicketsProposed ProjectTicket[] @relation(\"TicketProposedAssignee\")\n  projectTicketsReviewed ProjectTicket[] @relation(\"TicketReviewedBy\")\n  budgetRequests ProjectBudgetRequest[] @relation(\"BudgetRequestedBy\")\n  budgetRequestsReviewed ProjectBudgetRequest[] @relation(\"BudgetReviewedBy\")\n\n" + p2
  );
  fs.writeFileSync('backend/prisma/schema.prisma', schema);
  console.log("Restored missing models");
} else {
  console.log("Already restored");
}
