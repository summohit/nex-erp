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

-- CreateIndex
CREATE INDEX "ProjectDiscussion_projectId_idx" ON "ProjectDiscussion"("projectId");
CREATE INDEX "ProjectDiscussion_authorId_idx" ON "ProjectDiscussion"("authorId");
CREATE INDEX "ProjectDiscussionComment_discussionId_idx" ON "ProjectDiscussionComment"("discussionId");
CREATE INDEX "ProjectDiscussionComment_authorId_idx" ON "ProjectDiscussionComment"("authorId");

-- AddForeignKey
ALTER TABLE "ProjectDiscussion" ADD CONSTRAINT "ProjectDiscussion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDiscussion" ADD CONSTRAINT "ProjectDiscussion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDiscussionComment" ADD CONSTRAINT "ProjectDiscussionComment_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "ProjectDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDiscussionComment" ADD CONSTRAINT "ProjectDiscussionComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectDiscussionAttachment" ADD CONSTRAINT "ProjectDiscussionAttachment_discussionId_fkey" FOREIGN KEY ("discussionId") REFERENCES "ProjectDiscussion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectDiscussionAttachment" ADD CONSTRAINT "ProjectDiscussionAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
