const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const data = {
    resumeLines: [
      {
        type: 'Experience',
        title: 'Software Engineer',
        organization: 'Google',
        startDate: '2020-01-01',
        endDate: '2023-01-01',
        description: 'Worked on search'
      }
    ]
  };

  try {
    const res = await prisma.employee.update({
      where: { id: 1 },
      data: {
        resumeLines: data.resumeLines ? {
          deleteMany: {},
          create: data.resumeLines.map(r => ({
            type: r.type,
            title: r.title,
            organization: r.organization,
            startDate: r.startDate,
            endDate: r.endDate,
            description: r.description,
            attachmentUrl: r.attachmentUrl
          }))
        } : undefined
      }
    });
    console.log("Success");
  } catch (err) {
    console.error("Prisma error:", err);
  }
}
main().finally(() => prisma.$disconnect());
