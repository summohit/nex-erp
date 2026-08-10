import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MenusService {
  constructor(private prisma: PrismaService) {}

  async getSidebarMenus(companyId: number, userId: number, roleName: string) {
    // 1. Fetch all active menus (system global + company specific)
    const menus = await this.prisma.menu.findMany({
      where: {
        isActive: true,
        OR: [
          { companyId: null },
          { companyId: companyId }
        ]
      },
      include: {
        children: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
          include: {
            children: {
              where: { isActive: true },
              orderBy: { displayOrder: 'asc' }
            }
          }
        }
      },
      orderBy: { displayOrder: 'asc' }
    });

    // 2. Filter top-level sections
    const tree = menus.filter(m => m.parentId === null);
    
    // 3. Format it to match the JSON structure expected by frontend
    return tree.map(section => ({
      title: section.title,
      items: section.children.map(item => ({
        id: item.route ? item.route.replace('/', '') : item.title.toLowerCase().replace(/ /g, '-'),
        title: item.title,
        icon: item.icon,
        route: item.route,
        subItems: item.children.length > 0 ? item.children.map(sub => ({
          id: sub.route ? sub.route.replace('/', '') : sub.title.toLowerCase().replace(/ /g, '-'),
          title: sub.title,
          route: sub.route,
          external: sub.openInNewTab
        })) : undefined
      }))
    }));
  }
}
