import { Injectable, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

import { PermissionsService } from '../permissions/permissions.service';

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private permissions: PermissionsService
  ) {}

  async findAll(companyId: number) {
    return this.prisma.employee.findMany({
      where: { companyId },
      include: {
        user: { select: { email: true, role: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getOrgChart(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        managerId: true,
        designation: { select: { name: true } },
        department: { select: { name: true } }
      }
    });

    return employees;
  }

  async create(companyId: number, data: any) {
    // 1. Check if user already exists
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // 2. Hash default password
    const hashedPassword = await bcrypt.hash('Welcome@123', 10);

    // 3. Determine Role from Department
    let assignedRole = data.role || 'EMPLOYEE';
    if (data.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
      if (dept && dept.defaultRole) {
        assignedRole = dept.defaultRole;
      }
    }

    // 4. Create User and Employee in one transaction
    return this.prisma.$transaction(async (prisma) => {
      const newUser = await prisma.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          role: assignedRole,
          companyId: companyId
        }
      });

      const newEmployee = await prisma.employee.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          departmentId: data.departmentId || null,
          designationId: data.designationId || null,
          branchId: data.branchId || null,
          managerId: data.managerId || null,
          shiftId: data.shiftId ? (typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId) : null,
          companyId: companyId,
          userId: newUser.id,
          onboardingStatus: 'PENDING'
        },
        include: {
          user: { select: { email: true, role: true } },
          department: true,
          designation: true,
          branch: true,
          shift: true,
          manager: {
            select: { id: true, firstName: true, lastName: true }
          }
        }
      });

      // Auto-assign Onboarding Tasks
      const templates = await prisma.onboardingTemplate.findMany({ where: { companyId } });
      if (templates.length > 0) {
        await prisma.employeeOnboardingTask.createMany({
          data: templates.map(t => ({
            employeeId: newEmployee.id,
            title: t.title,
            description: t.description
          }))
        });
      }

      return newEmployee;
    });
  }

  async update(id: number, companyId: number, data: any) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const updateData: any = {};
    if (data.firstName) updateData.firstName = data.firstName;
    if (data.lastName) updateData.lastName = data.lastName;
    if (data.phone) updateData.phone = data.phone;
    if (data.departmentId !== undefined) {
      if (data.departmentId) updateData.department = { connect: { id: data.departmentId } };
      else updateData.department = { disconnect: true };
    }
    if (data.designationId !== undefined) {
      if (data.designationId) updateData.designation = { connect: { id: data.designationId } };
      else updateData.designation = { disconnect: true };
    }
    if (data.branchId !== undefined) {
      if (data.branchId) updateData.branch = { connect: { id: data.branchId } };
      else updateData.branch = { disconnect: true };
    }
    if (data.managerId !== undefined) {
      if (data.managerId) updateData.manager = { connect: { id: data.managerId } };
      else updateData.manager = { disconnect: true };
    }
    if (data.shiftId !== undefined) {
      if (data.shiftId) updateData.shift = { connect: { id: typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId } };
      else updateData.shift = { disconnect: true };
    }

    if (data.role) {
      updateData.user = { update: { role: data.role } };
    }

    return this.prisma.employee.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { email: true, role: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } }
      }
    });
  }

  async delete(id: number, companyId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId }, select: { userId: true } });
    if (!employee) throw new NotFoundException('Employee not found');

    // Due to Cascade delete on User -> Employee, deleting the User will delete the Employee.
    // If it's the other way around, we should just delete the User.
    // Let's check schema: user User @relation(fields: [userId], references: [id], onDelete: Cascade)
    // Wait, the schema says: Employee has a userId that references User. OnDelete: Cascade.
    // This means if we delete the User, the Employee is deleted. 
    // So we delete the User.
    await this.prisma.user.delete({ where: { id: employee.userId } });
    
    return { success: true };
  }

  // --- Profile Features ---

  async getMyProfile(companyId: number, currentUserId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: {
        user: { select: { email: true, role: true, id: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        emergencyContacts: true,
        documents: true
      }
    });
    if (!employee) throw new NotFoundException('Employee profile not found');
    
    return { ...employee, isOwner: true };
  }

  async getProfile(id: number, companyId: number, currentUserId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: {
        user: { select: { email: true, role: true, id: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true, id: true } },
        shift: { select: { name: true, startTime: true, endTime: true } },
        emergencyContacts: true,
        documents: true
      }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const isOwner = employee.userId === currentUserId;

    // Filter documents if not owner
    if (!isOwner) {
      employee.documents = [];
    }

    return { ...employee, isOwner };
  }

  private async checkProfileEditPermission(employeeId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    
    if (employee.userId === currentUserId) return employee; // Self edit

    // Check Designation-level permissions
    const requestor = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: { designation: true }
    });

    if (requestor?.designation?.canEditProfiles) {
      return employee;
    }
    
    // Fallback to System Role-level permissions
    const hasPermission = await this.permissions.hasPermission(companyId, role, 'EMPLOYEE_PROFILES', 'EDIT_ANY');
    if (!hasPermission) {
      throw new UnauthorizedException('You do not have permission to edit other employee profiles');
    }
    
    return employee;
  }

  async updateProfile(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    if (data.password) {
       const hashedPassword = await bcrypt.hash(data.password, 10);
       await this.prisma.user.update({
         where: { id: employee.userId },
         data: { password: hashedPassword }
       });
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        salutation: data.salutation,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        country: data.country,
        state: data.state,
        city: data.city,
        language: data.language,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        slackId: data.slackId,
        maritalStatus: data.maritalStatus,
        address: data.address,
        about: data.about,
        avatarUrl: data.avatarUrl
      }
    });
  }

  async addContact(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    return this.prisma.emergencyContact.create({
      data: {
        employeeId: id,
        name: data.name,
        email: data.email,
        mobile: data.mobile,
        relationship: data.relationship
      }
    });
  }

  async deleteContact(id: number, contactId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    return this.prisma.emergencyContact.delete({
      where: { id: contactId }
    });
  }

  async addDocument(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    return this.prisma.employeeDocument.create({
      data: {
        employeeId: id,
        fileName: data.fileName,
        fileUrl: data.fileUrl
      }
    });
  }

  async deleteDocument(id: number, documentId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    return this.prisma.employeeDocument.delete({
      where: { id: documentId }
    });
  }
}
