const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find the parent menu (e.g. "MAIN MENU")
  const parent = await prisma.menu.findFirst({ where: { parentId: null, title: 'MAIN MENU' } });
  
  if (parent) {
    // Check if Performance already exists
    const existing = await prisma.menu.findFirst({ where: { title: 'Performance', parentId: parent.id } });
    if (!existing) {
      await prisma.menu.create({
        data: {
          title: 'Performance',
          icon: 'target',
          route: '/performance',
          displayOrder: 4,
          parentId: parent.id,
          isActive: true
        }
      });
      console.log('Performance menu added!');
    } else {
      console.log('Performance menu already exists.');
    }
  } else {
    console.log('MAIN MENU section not found!');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
