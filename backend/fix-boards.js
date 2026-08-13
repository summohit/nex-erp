const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const projects = await prisma.project.findMany({
    include: { boards: true }
  });

  for (const project of projects) {
    if (project.boards.length === 0) {
      console.log(`Creating board for project ${project.id} (${project.name})`);
      await prisma.board.create({
        data: {
          name: 'Main Board',
          projectId: project.id,
          columns: {
            create: [
              { name: 'To Do', color: '#6b7280', position: 0, isSystem: true },
              { name: 'In Progress', color: '#3b82f6', position: 1, isSystem: true },
              { name: 'In Review', color: '#8b5cf6', position: 2, isSystem: true },
              { name: 'Done', color: '#22c55e', position: 3, isSystem: true },
              { name: 'Archived', color: '#9ca3af', position: 4, isSystem: true }
            ]
          }
        }
      });
      console.log(`Board created for project ${project.id}`);
    }
  }
  console.log('Done fixing boards.');
}

fix().catch(console.error).finally(() => prisma.$disconnect());
