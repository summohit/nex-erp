import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemSettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings(companyId: number) {
    let settings = await this.prisma.systemSetting.findUnique({
      where: { companyId },
    });

    if (!settings) {
      settings = await this.prisma.systemSetting.create({
        data: { companyId },
      });
    }

    return settings;
  }

  async updateSettings(
    companyId: number,
    data: {
      shiftRosterVisibleToEmployees?: boolean;
      /// §22. On, only APPROVED timesheet hours reach project cost.
      timesheetApprovalRequired?: boolean;
      offerLetterTemplateHtml?: string;
      offerLetterTemplateDocxUrl?: string;
      offerLetterConfig?: any;
      defaultTicketAssigneeId?: number | null;
      attendanceTicketAssigneeId?: number | null;
      twoFactorRequired?: boolean;
      quotationTerms?: string | null;
      quotationSignatoryName?: string | null;
      quotationSignatureUrl?: string | null;
    },
  ) {
    return this.prisma.systemSetting.upsert({
      where: { companyId },
      create: {
        companyId,
        shiftRosterVisibleToEmployees: data.shiftRosterVisibleToEmployees ?? false,
        timesheetApprovalRequired: data.timesheetApprovalRequired ?? false,
        offerLetterTemplateHtml: data.offerLetterTemplateHtml,
        offerLetterTemplateDocxUrl: data.offerLetterTemplateDocxUrl,
        offerLetterConfig: data.offerLetterConfig ?? undefined,
        defaultTicketAssigneeId: data.defaultTicketAssigneeId ?? null,
        attendanceTicketAssigneeId: data.attendanceTicketAssigneeId ?? null,
        twoFactorRequired: data.twoFactorRequired ?? false,
        quotationTerms: data.quotationTerms ?? null,
        quotationSignatoryName: data.quotationSignatoryName ?? null,
        quotationSignatureUrl: data.quotationSignatureUrl ?? null,
      },
      update: {
        shiftRosterVisibleToEmployees: data.shiftRosterVisibleToEmployees,
        offerLetterTemplateHtml: data.offerLetterTemplateHtml,
        offerLetterTemplateDocxUrl: data.offerLetterTemplateDocxUrl,
        // undefined leaves the stored JSON untouched; only overwrite when sent.
        offerLetterConfig: data.offerLetterConfig ?? undefined,
        ...(data.defaultTicketAssigneeId !== undefined && { defaultTicketAssigneeId: data.defaultTicketAssigneeId }),
        ...(data.attendanceTicketAssigneeId !== undefined && { attendanceTicketAssigneeId: data.attendanceTicketAssigneeId }),
        ...(data.twoFactorRequired !== undefined && { twoFactorRequired: data.twoFactorRequired }),
        // Spread rather than assigned: an update that does not mention the
        // switch must leave it alone, not quietly reset it to false and
        // re-open every project's cost to unapproved time.
        ...(data.timesheetApprovalRequired !== undefined && { timesheetApprovalRequired: data.timesheetApprovalRequired }),
        // Spread-guarded like the others: a PUT that omits the field must not
        // wipe the saved terms back to null.
        ...(data.quotationTerms !== undefined && { quotationTerms: data.quotationTerms }),
        ...(data.quotationSignatoryName !== undefined && { quotationSignatoryName: data.quotationSignatoryName }),
        ...(data.quotationSignatureUrl !== undefined && { quotationSignatureUrl: data.quotationSignatureUrl }),
      },
    });
  }
}
