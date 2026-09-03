import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const application = await prisma.jobApplication.findUnique({
    where: { id: 644 }
  });
  
  console.log("App:", application?.fullName, application?.phone);
}
main().catch(console.error).finally(() => prisma.$disconnect());
