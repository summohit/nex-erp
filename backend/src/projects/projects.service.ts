import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async createProject(companyId: number, leadId: number, data: { name: string, description?: string, color?: string, icon?: string }) {
    // Generate base key from name
    const words = data.name.split(' ').filter(w => w.length > 0);
    let baseKey = '';
    if (words.length >= 2) {
      baseKey = (words[0].substring(0, 2) + words[1][0]).toUpperCase();
    } else {
      baseKey = data.name.substring(0, 3).toUpperCase();
    }
    
    // Ensure key uniqueness per company
    let finalKey = baseKey;
    let counter = 1;
    while (true) {
      const existing = await this.prisma.project.findUnique({
        where: { key_companyId: { key: finalKey, companyId } }
      });
      if (!existing) break;
      finalKey = `${baseKey}${counter}`;
      counter++;
    }

    // Create project, member, and default board
    const project = await this.prisma.project.create({
      data: {
        name: data.name,
        key: finalKey,
        description: data.description,
        color: data.color || '#2563eb',
        icon: data.icon || 'folder',
        companyId,
        leadId,
        members: {
          create: {
            employeeId: leadId,
            role: 'ADMIN'
          }
        },
        boards: {
          create: {
            name: 'Main Board',
            columns: {
              create: [
                { name: 'To Do', color: '#6b7280', position: 0 },
                { name: 'In Progress', color: '#3b82f6', position: 1 },
                { name: 'In Review', color: '#8b5cf6', position: 2 },
                { name: 'Done', color: '#22c55e', position: 3 },
              ]
            }
          }
        }
      }
    });

    return project;
  }

  async getProjects(companyId: number) {
    return this.prisma.project.findMany({
      where: { companyId },
      include: {
        _count: {
          select: { members: true, issues: true }
        },
        lead: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true }
        }
      }
    });
  }

  async getProjectDetails(companyId: number, projectId: number) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, companyId },
      include: {
        members: {
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true }
            }
          }
        },
        boards: {
          include: {
            columns: {
              orderBy: { position: 'asc' }
            }
          }
        }
      }
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }
}
