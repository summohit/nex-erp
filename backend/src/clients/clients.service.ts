import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  private async ensureUniqueClientName(companyId: number, name: string, excludeId?: number) {
    if (!name) return;
    const existing = await this.prisma.client.findFirst({
      where: {
        companyId,
        name,
        ...(excludeId ? { id: { not: excludeId } } : {})
      },
      select: { id: true }
    });
    if (existing) {
      throw new ConflictException('A client with this name already exists.');
    }
  }

  private isUniqueViolation(err: any): boolean {
    return err?.code === 'P2002';
  }

  private rethrowUniqueViolation(err: any): never {
    if (this.isUniqueViolation(err)) {
      throw new ConflictException('A client with this name already exists.');
    }
    throw err;
  }

  private sanitizeWebsite(website: string | undefined): string | undefined {
    if (!website) return website;
    const url = website.trim();
    if (!url) return undefined;
    const scheme = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase();
    if (scheme && scheme !== 'http' && scheme !== 'https') {
      throw new BadRequestException('Website URL must use http:// or https://');
    }
    return url;
  }

  private sanitizeClientData(data: any): any {
    const { website, name, ...rest } = data;
    
    let sanitizedName = name;
    if (typeof name === 'string') {
      sanitizedName = name.trim().replace(/\s+/g, ' ');
      if (sanitizedName === '') {
        throw new BadRequestException('Client name cannot be empty or just spaces');
      }
    }

    return {
      ...rest,
      ...(sanitizedName !== undefined ? { name: sanitizedName } : {}),
      ...(website !== undefined ? { website: this.sanitizeWebsite(website) } : {})
    };
  }

  async create(companyId: number, createClientDto: any) {
    const { contacts, ...clientData } = this.sanitizeClientData(createClientDto);
    await this.ensureUniqueClientName(companyId, clientData.name);

    try {
      return await this.prisma.client.create({
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
    } catch (err) {
      this.rethrowUniqueViolation(err);
    }
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
    const data = this.sanitizeClientData(updateClientDto);

    if (data.name) {
      await this.ensureUniqueClientName(companyId, data.name, id);
    }

    try {
      return await this.prisma.client.update({
        where: { id: client.id },
        data,
      });
    } catch (err) {
      this.rethrowUniqueViolation(err);
    }
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

  async addContact(companyId: number, clientId: number, contactData: any) {
    const client = await this.findOne(companyId, clientId);
    return this.prisma.clientContact.create({
      data: {
        ...contactData,
        clientId: client.id,
      },
    });
  }

  async updateContact(companyId: number, clientId: number, contactId: number, contactData: any) {
    await this.findOne(companyId, clientId); // Verify ownership
    const contact = await this.prisma.clientContact.findFirst({
      where: { id: contactId, clientId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found for this client`);
    }
    return this.prisma.clientContact.update({
      where: { id: contactId },
      data: contactData,
    });
  }

  async deleteContact(companyId: number, clientId: number, contactId: number) {
    await this.findOne(companyId, clientId); // Verify ownership
    const contact = await this.prisma.clientContact.findFirst({
      where: { id: contactId, clientId },
    });
    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found for this client`);
    }
    return this.prisma.clientContact.delete({
      where: { id: contactId },
    });
  }
}
