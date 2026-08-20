import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { MailService } from '../mail/mail.service';
const csv = require('csv-parser');
import { Readable } from 'stream';

export interface BulkUploadResult {
  totalRows: number;
  successCount: number;
  failedCount: number;
  errors: { row: number; email?: string; reason: string }[];
}

@Injectable()
export class EmployeesImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly employeesService: EmployeesService
  ) {}

  async processCsv(
    companyId: number, 
    fileBuffer: Buffer,
    overrideDepartmentId: number | null = null,
    overrideDesignationId: number | null = null,
    overrideRole: string | null = null
  ): Promise<BulkUploadResult> {
    const results: any[] = [];
    
    // Parse CSV
    await new Promise((resolve, reject) => {
      Readable.from(fileBuffer)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    if (results.length === 0) {
      throw new BadRequestException('The CSV file is empty.');
    }

    const result: BulkUploadResult = {
      totalRows: results.length,
      successCount: 0,
      failedCount: 0,
      errors: []
    };

    // Pre-fetch all emails to quickly check duplicates globally
    const existingUsers = await this.prisma.user.findMany({ select: { email: true } });
    const existingEmails = new Set(existingUsers.map(u => u.email.toLowerCase()));

    // Pre-fetch departments and designations for this company
    const departments = await this.prisma.department.findMany({ where: { companyId } });
    const designations = await this.prisma.designation.findMany({ where: { companyId } });

    // Case-insensitive maps for fast lookup
    const deptMap = new Map<string, number>();
    const deptDefaultRoleMap = new Map<number, string>();
    departments.forEach(d => {
      deptMap.set(d.name.toLowerCase().trim(), d.id);
      if (d.defaultRole) deptDefaultRoleMap.set(d.id, d.defaultRole);
    });

    const desigMap = new Map<string, number>();
    designations.forEach(d => desigMap.set(d.name.toLowerCase().trim(), d.id));

    // Default password for all imports
    const defaultPasswordHash = await bcrypt.hash('Welcome@123', 10);

    // Default reporting line: CEO of the organization
    const ceoId = (await this.employeesService.findCeo(companyId))?.id ?? null;

    let rowNum = 1; // 1-indexed for headers, so data starts at 2. We'll track data row.
    for (const row of results) {
      rowNum++;
      
      const firstName = row['FirstName']?.trim();
      const lastName = row['LastName']?.trim();
      const email = row['Email']?.trim();
      const csvRole = row['Role']?.trim()?.toUpperCase() || null;
      const departmentName = row['Department']?.trim();
      const designationName = row['Designation']?.trim();
      const phone = row['Phone']?.trim() || null;

      // Validation
      if (!firstName || !lastName || !email) {
        result.failedCount++;
        result.errors.push({ row: rowNum, email, reason: 'Missing required fields (FirstName, LastName, Email)' });
        continue;
      }

      if (existingEmails.has(email.toLowerCase())) {
        result.failedCount++;
        result.errors.push({ row: rowNum, email, reason: 'Email already exists in the system' });
        continue;
      }

      // Lookups (Fallback to null / Unassigned)
      let departmentId: number | null = overrideDepartmentId;
      if (!departmentId && departmentName && deptMap.has(departmentName.toLowerCase())) {
        departmentId = deptMap.get(departmentName.toLowerCase())!;
      }

      let designationId: number | null = overrideDesignationId;
      if (!designationId && designationName && desigMap.has(designationName.toLowerCase())) {
        designationId = desigMap.get(designationName.toLowerCase())!;
      }

      const finalRole = overrideRole || csvRole || (departmentId ? deptDefaultRoleMap.get(departmentId) : null) || 'EMPLOYEE';

      try {
        await this.prisma.$transaction(async (prisma) => {
          // 1. Create User
          const newUser = await prisma.user.create({
            data: {
              email: email.toLowerCase(),
              password: defaultPasswordHash,
              role: finalRole,
              companyId,
              status: 'PENDING_VERIFICATION'
            }
          });

          // 2. Create Employee
          const newEmployee = await prisma.employee.create({
            data: {
              firstName,
              lastName,
              phone,
              departmentId,
              designationId,
              companyId,
              userId: newUser.id,
              managerId: ceoId,
              onboardingStatus: 'PENDING'
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
        });

        // 3. Send Verification Email outside the transaction
        const token = crypto.randomBytes(32).toString('hex');
        await this.prisma.verificationToken.create({
          data: {
            identifier: email.toLowerCase(),
            token,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        });
        this.mailService.sendVerificationEmail(email.toLowerCase(), token).catch(e => console.error(e));

        // Mark as success and add to our local existing emails to prevent duplicates in the same file
        existingEmails.add(email.toLowerCase());
        result.successCount++;
      } catch (err) {
        result.failedCount++;
        result.errors.push({ row: rowNum, email, reason: err.message || 'Database error occurred' });
      }
    }

    return result;
  }
}
