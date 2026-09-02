import { Injectable, ConflictException, NotFoundException, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

import { PermissionsService } from '../permissions/permissions.service';
import { MailService } from '../mail/mail.service';
import * as crypto from 'crypto';

@Injectable()
export class EmployeesService {
  constructor(
    private prisma: PrismaService,
    private permissions: PermissionsService,
    private mailService: MailService
  ) {}

  private async assertDirectoryAccess(companyId: number, role: string) {
    if (role === 'SUPERADMIN') return;
    const hasAccess = await this.permissions.hasPermission(companyId, role, 'employees/directory', 'VIEW');
    if (!hasAccess) {
      throw new ForbiddenException('You do not have permission to view the employee directory.');
    }
  }

  async findAll(companyId: number, role: string) {
    await this.assertDirectoryAccess(companyId, role);
    return this.prisma.employee.findMany({
      where: { companyId },
      include: {
        user: { select: { email: true, role: true, status: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true } },
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        documents: true
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // Minimal name/avatar list for populating dropdowns and resolving display names
  // in modules (Assets, Projects, etc.) that need employee identity but not full
  // directory access (which is gated by assertDirectoryAccess).
  async findBasicList(companyId: number) {
    return this.prisma.employee.findMany({
      where: { companyId, user: { status: { not: 'SUSPENDED' } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        managerId: true,
        department: { select: { name: true } },
        designation: { select: { name: true } }
      },
      orderBy: { firstName: 'asc' }
    });
  }

  async getHeadcountSummary(companyId: number) {
    const employees = await this.prisma.employee.findMany({
      where: { companyId },
      select: { department: { select: { name: true } } }
    });

    const map = new Map<string, number>();
    for (const emp of employees) {
      const dept = emp.department?.name || 'Unassigned';
      map.set(dept, (map.get(dept) || 0) + 1);
    }

    return {
      total: employees.length,
      byDepartment: Array.from(map.entries()).map(([name, count]) => ({ name, count }))
    };
  }

  async findCeo(companyId: number) {
    // 1. Prefer an employee with the "CEO" designation
    const ceo = await this.prisma.employee.findFirst({
      where: {
        companyId,
        designation: { name: { equals: 'CEO', mode: 'insensitive' } },
        user: { status: { not: 'SUSPENDED' } }
      },
      include: {
        user: { select: { email: true, role: true } },
        designation: { select: { name: true } }
      }
    });
    if (ceo) return ceo;

    // 2. Fallback: the earliest SUPERADMIN (company founder)
    const founder = await this.prisma.user.findFirst({
      where: { companyId, role: 'SUPERADMIN', status: { not: 'SUSPENDED' } },
      orderBy: { id: 'asc' },
      select: {
        employee: {
          include: {
            user: { select: { email: true, role: true } },
            designation: { select: { name: true } }
          }
        }
      }
    });

    return founder?.employee || null;
  }

  async getOrgChart(companyId: number, role: string) {
    await this.assertDirectoryAccess(companyId, role);
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

  async generateEmployeeCode(prisma: any, companyId: number, employmentCategory: string): Promise<string> {
    const prefix = employmentCategory === 'TRAINEE' ? 'T' : employmentCategory === 'CONTRACT' ? 'C' : '';
    const defaultWidth = prefix === 'C' ? 3 : prefix === 'T' ? 4 : 5;

    const existing = await prisma.employee.findMany({
      where: { companyId, employeeCode: { startsWith: prefix || undefined, not: null } },
      select: { employeeCode: true }
    });

    let maxNumber = 0;
    let maxWidth = defaultWidth;
    for (const e of existing) {
      const suffix = prefix ? e.employeeCode.slice(prefix.length) : e.employeeCode;
      if (!/^\d+$/.test(suffix)) continue;
      const num = parseInt(suffix, 10);
      if (num > maxNumber) {
        maxNumber = num;
        maxWidth = suffix.length;
      }
    }

    const nextNumber = (maxNumber + 1).toString().padStart(maxWidth, '0');
    return `${prefix}${nextNumber}`;
  }

  async create(companyId: number, data: any) {
    // 1. Check if user already exists
    const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // 2. Hash default password
    const hashedPassword = await bcrypt.hash('Welcome@123', 10);

    // 3. Validate phone number if provided
    if (data.phone) {
      const phoneRegex = /^\+?[0-9\s\-()]{10,20}$/;
      if (!phoneRegex.test(data.phone)) {
        throw new BadRequestException('Invalid phone number format. Must be 10-20 characters, optionally starting with +');
      }
    }

    // 4. Determine Role from Department
    let assignedRole = data.role || 'EMPLOYEE';
    if (data.departmentId) {
      const dept = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
      if (dept && dept.defaultRole) {
        assignedRole = dept.defaultRole;
      }
    }

    // 5. Default reporting line: CEO of the organization when no manager specified
    let managerId = data.managerId || null;
    if (!managerId) {
      const ceo = await this.findCeo(companyId);
      managerId = ceo?.id ?? null;
    }

    const employmentCategory = data.employmentCategory || 'PERMANENT';

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

      const employeeCode = await this.generateEmployeeCode(prisma, companyId, employmentCategory);

      const newEmployee = await prisma.employee.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          departmentId: data.departmentId || null,
          designationId: data.designationId || null,
          branchId: data.branchId || null,
          managerId: managerId,
          shiftId: data.shiftId ? (typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId) : null,
          companyId: companyId,
          userId: newUser.id,
          onboardingStatus: 'PENDING',
          employeeCode,
          employmentCategory
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

      const token = crypto.randomBytes(32).toString('hex');
      await prisma.verificationToken.create({
        data: {
          identifier: newUser.email,
          token,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        }
      });
      this.mailService.sendVerificationEmail(newUser.email, token).catch(e => console.error(e));

      return newEmployee;
    });
  }

  async update(id: number, companyId: number, data: any) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const updateData: any = {};
    if (data.firstName) updateData.firstName = data.firstName;
    if (data.lastName) updateData.lastName = data.lastName;
    if (data.nextAppraisalDate !== undefined) updateData.nextAppraisalDate = data.nextAppraisalDate ? new Date(data.nextAppraisalDate) : null;
    if (data.phone) {
      const phoneRegex = /^\+?[0-9\s\-()]{10,20}$/;
      if (!phoneRegex.test(data.phone)) {
        throw new BadRequestException('Invalid phone number format. Must be 10-20 characters, optionally starting with +');
      }
      updateData.phone = data.phone;
    }
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

    if (data.isProjectManager !== undefined) {
      updateData.isProjectManager = Boolean(data.isProjectManager);
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
    const employee = await this.prisma.employee.findFirst({
      where: { id, companyId },
      include: { user: { select: { status: true } } }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const currentStatus = employee.user.status;
    const newStatus = currentStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';

    await this.prisma.user.update({
      where: { id: employee.userId },
      data: { status: newStatus }
    });

    if (newStatus === 'SUSPENDED') {
      // Set subordinates' managerId to null
      await this.prisma.employee.updateMany({
        where: { managerId: employee.id, companyId },
        data: { managerId: null }
      });
    }

    return { success: true, newStatus };
  }

  // --- Profile Features ---

  async getMyProfile(companyId: number, currentUserId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: {
        user: { select: { email: true, role: true, id: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
        branch: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true, id: true } },
        emergencyContacts: true,
        documents: true,
        skills: true,
        resumeLines: true
      }
    });
    if (!employee) throw new NotFoundException('Employee profile not found');

    // Own profile: always allowed to see and manage their own documents. This
    // must stay in step with getProfile(), which returns the same flag.
    return { ...employee, isOwner: true, canManageDocuments: true };
  }

  async getProfile(id: number, companyId: number, currentUserId: number, role: string) {
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
        documents: true,
        skills: true,
        resumeLines: true
      }
    });
    if (!employee) throw new NotFoundException('Employee not found');

    const isOwner = employee.userId === currentUserId;
    if (!isOwner) {
      await this.assertDirectoryAccess(companyId, role);
    }

    // Personal documents (ID proofs, contracts) stay private. They are exposed to
    // the owner and to the people who are already allowed to add and delete them
    // — HR, admins and designation-level profile editors — but not to every
    // colleague who merely has directory access.
    const canViewDocuments = isOwner || (await this.canManageEmployeeDocuments(companyId, currentUserId, role));
    if (!canViewDocuments) {
      employee.documents = [];
    }

    return { ...employee, isOwner, canManageDocuments: canViewDocuments };
  }

  /**
   * Whether the caller may see and manage another employee's personal documents.
   * Deliberately narrower than checkProfileEditPermission, whose fallback admits
   * anyone with directory VIEW — too broad for ID proofs and contracts.
   */
  private async canManageEmployeeDocuments(companyId: number, currentUserId: number, role: string): Promise<boolean> {
    if (role === 'SUPERADMIN' || role === 'HR' || role === 'ADMIN') return true;

    const requestor = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: { designation: true },
    });
    return !!requestor?.designation?.canEditProfiles;
  }

  private async checkProfileEditPermission(employeeId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');
    
    if (employee.userId === currentUserId || role === 'SUPERADMIN' || role === 'HR') return employee; // Self edit, Super Admin, HR

    // Check Designation-level permissions
    const requestor = await this.prisma.employee.findFirst({
      where: { userId: currentUserId, companyId },
      include: { designation: true }
    });

    if (requestor?.designation?.canEditProfiles) {
      return employee;
    }
    
    // Fallback to System Role-level permissions
    const hasPermission = await this.permissions.hasPermission(companyId, role, 'employees/directory', 'VIEW');
    if (!hasPermission) {
      throw new ForbiddenException('You do not have permission to edit other employee profiles');
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
        avatarUrl: data.avatarUrl,
        managerId: data.managerId || null,
        branchId: data.branchId || null,
        departmentId: data.departmentId || null,
        designationId: data.designationId || null,
        
        usualWorkLocation: data.usualWorkLocation ? data.usualWorkLocation : null,
        workNotes: data.workNotes || null,

        // Work Details Additions
        joiningDate: data.joiningDate ? new Date(data.joiningDate) : undefined,
        employmentCategory: data.employmentCategory !== undefined ? data.employmentCategory : undefined,
        nextAppraisalDate: data.nextAppraisalDate ? new Date(data.nextAppraisalDate) : null,

        // Bank Details
        bankName: data.bankName || null,
        bankAccountNumber: data.bankAccountNumber || null,
        ifscCode: data.ifscCode || null,

        // Place of Birth
        placeOfBirthCity: data.placeOfBirthCity || null,
        placeOfBirthCountry: data.placeOfBirthCountry || null,

        // Citizenship & Identification
        nationality: data.nationality || null,
        identificationNo: data.identificationNo || null,
        passportNo: data.passportNo || null,

        // Visa & Permit
        visaNo: data.visaNo || null,
        workPermitNo: data.workPermitNo || null,

        // Location & Distance
        zipCode: data.zipCode || null,
        homeWorkDistanceKm: data.homeWorkDistanceKm ? Number(data.homeWorkDistanceKm) : null,

        // Family Details
        spouseName: data.spouseName || null,
        spouseBirthdate: data.spouseBirthdate ? new Date(data.spouseBirthdate) : null,
        childrenCount: data.childrenCount !== null && data.childrenCount !== undefined ? Number(data.childrenCount) : null,

        // Education
        educationLevel: data.educationLevel || null,
        fieldOfStudy: data.fieldOfStudy || null,

        // skills / resumeLines are intentionally NOT accepted here — they used
        // to be a `deleteMany + create` full-replace driven by whatever array
        // the client happened to hold locally. Any device with a stale copy of
        // the form (e.g. hadn't refetched since another device added a skill)
        // would silently wipe that other device's change on its next unrelated
        // save. addSkill/updateSkill/deleteSkill and their resumeLine
        // equivalents below replace this — each touches exactly the row it
        // means to, using the row's real id, never the whole list.
      }
    });
  }

  async addSkill(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    if (!data.category || !data.name || !data.level) {
      throw new BadRequestException('Category, name and level are required');
    }
    return this.prisma.employeeSkill.create({
      data: { employeeId: id, category: data.category, name: data.name, level: data.level }
    });
  }

  async updateSkill(id: number, skillId: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const skill = await this.prisma.employeeSkill.findFirst({ where: { id: skillId, employeeId: id } });
    if (!skill) throw new NotFoundException('Skill not found');
    return this.prisma.employeeSkill.update({
      where: { id: skillId },
      data: { category: data.category, name: data.name, level: data.level }
    });
  }

  async deleteSkill(id: number, skillId: number, companyId: number, currentUserId: number, role: string) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const skill = await this.prisma.employeeSkill.findFirst({ where: { id: skillId, employeeId: id } });
    if (!skill) throw new NotFoundException('Skill not found');
    return this.prisma.employeeSkill.delete({ where: { id: skillId } });
  }

  async addResumeLine(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    if (!data.title || !data.organization) {
      throw new BadRequestException('Title and organization are required');
    }
    return this.prisma.employeeResume.create({
      data: {
        employeeId: id,
        type: data.type || 'Experience',
        title: data.title,
        organization: data.organization,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        description: data.description || null,
        attachmentUrl: data.attachmentUrl || null,
      }
    });
  }

  async updateResumeLine(id: number, lineId: number, companyId: number, currentUserId: number, role: string, data: any) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const line = await this.prisma.employeeResume.findFirst({ where: { id: lineId, employeeId: id } });
    if (!line) throw new NotFoundException('Resume entry not found');
    return this.prisma.employeeResume.update({
      where: { id: lineId },
      data: {
        type: data.type || 'Experience',
        title: data.title,
        organization: data.organization,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        description: data.description || null,
        attachmentUrl: data.attachmentUrl || null,
      }
    });
  }

  async deleteResumeLine(id: number, lineId: number, companyId: number, currentUserId: number, role: string) {
    await this.checkProfileEditPermission(id, companyId, currentUserId, role);
    const line = await this.prisma.employeeResume.findFirst({ where: { id: lineId, employeeId: id } });
    if (!line) throw new NotFoundException('Resume entry not found');
    return this.prisma.employeeResume.delete({ where: { id: lineId } });
  }

  async addContact(id: number, companyId: number, currentUserId: number, role: string, data: any) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    if (!data.name || !data.mobile) {
      throw new BadRequestException('Name and Mobile are required');
    }

    const nameRegex = /^[a-zA-Z\s.'-]+$/;
    if (!nameRegex.test(data.name.trim())) {
      throw new BadRequestException('Invalid name format. Name should contain only letters and spaces.');
    }

    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!phoneRegex.test(data.mobile)) {
      throw new BadRequestException('Invalid mobile number format. Must be 7-15 digits, optionally starting with +');
    }

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
        employeeId: employee.id,
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        documentType: data.documentType || 'Other'
      }
    });
  }

  async addDocuments(id: number, companyId: number, currentUserId: number, role: string, data: { docs: any[] }) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    const MAX_DOCS_PER_REQUEST = 5;
    const docs = Array.isArray(data.docs) ? data.docs : [];
    if (docs.length === 0) throw new BadRequestException('No documents provided.');
    if (docs.length > MAX_DOCS_PER_REQUEST) {
      throw new BadRequestException(`You can upload a maximum of ${MAX_DOCS_PER_REQUEST} documents at a time.`);
    }

    return this.prisma.$transaction(
      docs.map(d => this.prisma.employeeDocument.create({
        data: {
          employeeId: employee.id,
          fileName: d.fileName,
          fileUrl: d.fileUrl,
          documentType: d.documentType || 'Other'
        }
      }))
    );
  }

  async deleteDocument(id: number, documentId: number, companyId: number, currentUserId: number, role: string) {
    const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);

    return this.prisma.employeeDocument.delete({
      where: { id: documentId }
    });
  }

  async sendWelcomeEmails(companyId: number, employeeIds: number[]) {
    const result = { successCount: 0, failedCount: 0, errors: [] as { employeeId: number; reason: string }[] };

    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, companyId },
      include: { user: { select: { id: true, email: true, status: true } } }
    });
    const foundIds = new Set(employees.map(e => e.id));

    for (const employeeId of employeeIds) {
      if (!foundIds.has(employeeId)) {
        result.failedCount++;
        result.errors.push({ employeeId, reason: 'Employee not found' });
        continue;
      }
    }

    for (const employee of employees) {
      try {
        const tempPassword = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        await this.prisma.user.update({
          where: { id: employee.user.id },
          data: { password: passwordHash, status: 'ACTIVE' }
        });

        await this.mailService.sendCredentialsEmail(employee.user.email, tempPassword);
        result.successCount++;
      } catch (err) {
        result.failedCount++;
        result.errors.push({ employeeId: employee.id, reason: err.message || 'Failed to send email' });
      }
    }

    return result;
  }
}
