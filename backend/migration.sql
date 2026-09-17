-- CreateTable
CREATE TABLE "ProjectDiscussion" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDiscussion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDiscussionComment" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "discussionId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDiscussionComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDiscussionAttachment" (
    "id" SERIAL NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "discussionId" INTEGER NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectDiscussionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTicket" (
    "id" SERIAL NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "projectId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "raisedById" INTEGER NOT NULL,
    "proposedAssigneeId" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "estimatedHours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "convertedIssueId" INTEGER,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgetRequest" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "additionalHours" DOUBLE PRECISION,
    "hoursBefore" DOUBLE PRECISION,
    "hoursAfter" DOUBLE PRECISION,
    "budgetBefore" DOUBLE PRECISION,
    "budgetAfter" DOUBLE PRECISION,
    "additionalBudget" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudgetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDiscussion_projectId_idx" ON "ProjectDiscussion"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDiscussion_authorId_idx" ON "ProjectDiscussion"("authorId");

-- CreateIndex
CREATE INDEX "ProjectDiscussionComment_discussionId_idx" ON "ProjectDiscussionComment"("discussionId");

-- CreateIndex
CREATE INDEX "ProjectDiscussionComment_authorId_idx" ON "ProjectDiscussionComment"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTicket_ticketNumber_key" ON "ProjectTicket"("ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTicket_convertedIssueId_key" ON "ProjectTicket"("convertedIssueId");

-- CreateIndex
CREATE INDEX "ProjectTicket_companyId_idx" ON "ProjectTicket"("companyId");

-- CreateIndex
CREATE INDEX "ProjectTicket_projectId_idx" ON "ProjectTicket"("projectId");

-- CreateIndex
CREATE INDEX "ProjectBudgetRequest_companyId_idx" ON "ProjectBudgetRequest"("companyId");

-- CreateIndex
CREATE INDEX "ProjectBudgetRequest_projectId_idx" ON "ProjectBudgetRequest"("projectId");

-- AddForeignKey
ALTER TABLE "ProjectDiscussion" ADD CONSTRAINT "ProjectDiscussion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDiscussion" ADD CONSTRAINT "ProjectDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDiscussionComment" ADD CONSTRAINT "ProjectDiscussionComment_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "ProjectDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDiscussionComment" ADD CONSTRAINT "ProjectDiscussionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDiscussionAttachment" ADD CONSTRAINT "ProjectDiscussionAttachment_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "ProjectDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDiscussionAttachment" ADD CONSTRAINT "ProjectDiscussionAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTicket" ADD CONSTRAINT "ProjectTicket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTicket" ADD CONSTRAINT "ProjectTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTicket" ADD CONSTRAINT "ProjectTicket_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTicket" ADD CONSTRAINT "ProjectTicket_proposedAssigneeId_fkey" FOREIGN KEY ("proposedAssigneeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTicket" ADD CONSTRAINT "ProjectTicket_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTicket" ADD CONSTRAINT "ProjectTicket_convertedIssueId_fkey" FOREIGN KEY ("convertedIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetRequest" ADD CONSTRAINT "ProjectBudgetRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetRequest" ADD CONSTRAINT "ProjectBudgetRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetRequest" ADD CONSTRAINT "ProjectBudgetRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgetRequest" ADD CONSTRAINT "ProjectBudgetRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

