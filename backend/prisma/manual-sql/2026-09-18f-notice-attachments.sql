-- Notice attachments. Additive: one new table.
BEGIN;
-- CreateTable
CREATE TABLE "NoticeAttachment" (
    "id" SERIAL NOT NULL,
    "noticeId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeAttachment_noticeId_idx" ON "NoticeAttachment"("noticeId");

-- AddForeignKey
ALTER TABLE "NoticeAttachment" ADD CONSTRAINT "NoticeAttachment_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
