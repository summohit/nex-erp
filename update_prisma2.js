const fs = require('fs');
let schema = fs.readFileSync('backend/prisma/schema.prisma', 'utf8');

const newModels = `

// ═══════════════════════════════════════════
// PROJECT DISCUSSIONS
// ═══════════════════════════════════════════

model ProjectDiscussion {
  id          Int      @id @default(autoincrement())
  title       String
  content     String   @db.Text
  projectId   Int
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  authorId    Int
  author      Employee @relation("DiscussionAuthor", fields: [authorId], references: [id])
  
  comments    ProjectDiscussionComment[]
  attachments ProjectDiscussionAttachment[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([projectId])
  @@index([authorId])
}

model ProjectDiscussionComment {
  id           Int               @id @default(autoincrement())
  content      String            @db.Text
  discussionId Int
  discussion   ProjectDiscussion @relation(fields: [discussionId], references: [id], onDelete: Cascade)
  authorId     Int
  author       Employee          @relation("DiscussionCommentAuthor", fields: [authorId], references: [id])

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([discussionId])
  @@index([authorId])
}

model ProjectDiscussionAttachment {
  id           Int               @id @default(autoincrement())
  fileName     String
  fileUrl      String
  fileSize     Int?
  discussionId Int
  discussion   ProjectDiscussion @relation(fields: [discussionId], references: [id], onDelete: Cascade)
  uploadedById Int
  uploadedBy   Employee          @relation("DiscussionAttachmentUploader", fields: [uploadedById], references: [id])
  
  createdAt    DateTime @default(now())
}
`;

if (!schema.includes('ProjectDiscussion {')) {
  schema += newModels;

  // Insert relations into Project
  schema = schema.replace(
    /(model Project \{[\s\S]*?)(  @@unique\(\[companyId, key\]\))/m,
    (match, p1, p2) => {
      return p1 + "  discussions            ProjectDiscussion[]\n\n" + p2;
    }
  );

  // Insert relations into Employee
  schema = schema.replace(
    /(model Employee \{[\s\S]*?)(  @@unique\(\[companyId, employeeCode\]\))/m,
    (match, p1, p2) => {
      return p1 + "  discussionsAuthored         ProjectDiscussion[]         @relation(\"DiscussionAuthor\")\n  discussionComments          ProjectDiscussionComment[]  @relation(\"DiscussionCommentAuthor\")\n  discussionAttachments       ProjectDiscussionAttachment[] @relation(\"DiscussionAttachmentUploader\")\n\n" + p2;
    }
  );

  fs.writeFileSync('backend/prisma/schema.prisma', schema);
  console.log("Updated schema.prisma");
} else {
  console.log("schema.prisma already updated");
}
