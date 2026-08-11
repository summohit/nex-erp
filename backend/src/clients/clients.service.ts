import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: number, createClientDto: any) {
    const { contacts, ...clientData } = createClientDto;
    
    return this.prisma.client.create({
      data: {
        ...clientData,
        companyId,
        contacts: contacts && contacts.length > 0 ? {
          create: contacts
        } : undefined
      },
      include: {
        contacts: true
      }
    });
  }

  async findAll(companyId: number, status?: string) {
    return this.prisma.client.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: {
        contacts: {
          where: { isPrimary: true },
          take: 1
        },
        _count: {
          select: { projects: true }
        }
      },
      orderBy: { name: 'asc' }
    });
  }

  async findOne(companyId: number, id: number) {
    const client = await this.prisma.client.findFirst({
      where: { id, companyId },
      include: {
        contacts: true,
        projects: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true
          }
        }
      }
    });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }
    return client;
  }

  async update(companyId: number, id: number, updateClientDto: any) {
    // We check existence and company ownership first
    const client = await this.findOne(companyId, id);
    
    return this.prisma.client.update({
      where: { id: client.id },
      data: updateClientDto,
    });
  }

  async archive(companyId: number, id: number) {
    const client = await this.findOne(companyId, id);
    return this.prisma.client.update({
      where: { id: client.id },
      data: { status: 'ARCHIVED' },
    });
  }

  async restore(companyId: number, id: number) {
    const client = await this.findOne(companyId, id);
    return this.prisma.client.update({
      where: { id: client.id },
      data: { status: 'ACTIVE' },
    });
  }

  async remove(companyId: number, id: number) {
    const client = await this.findOne(companyId, id);

    const projectCount = await this.prisma.project.count({ where: { clientId: client.id } });
    if (projectCount > 0) {
      throw new BadRequestException('Cannot delete a client with linked projects. Archive the client instead.');
    }

    return this.prisma.client.delete({
      where: { id: client.id },
    });
  }
}
