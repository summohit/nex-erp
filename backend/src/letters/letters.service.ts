import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Merge tags follow Worksuite's ##NAME## convention, so templates imported from
 * there render unchanged. Each tag maps to a resolver over the employee record.
 */
export const MERGE_TAGS: { tag: string; label: string; group: string }[] = [
  { tag: '##EMPLOYEE_NAME##', label: 'Employee Name', group: 'Employee' },
  { tag: '##EMPLOYEE_ID##', label: 'Employee Code', group: 'Employee' },
  { tag: '##EMPLOYEE_DESIGNATION##', label: 'Designation', group: 'Employee' },
  { tag: '##EMPLOYEE_DEPARTMENT##', label: 'Department', group: 'Employee' },
  { tag: '##EMPLOYEE_ADDRESS##', label: 'Address', group: 'Employee' },
  { tag: '##EMPLOYEE_EMAIL##', label: 'Email', group: 'Employee' },
  { tag: '##EMPLOYEE_MOBILE##', label: 'Mobile', group: 'Employee' },
  { tag: '##EMPLOYEE_JOINING_DATE##', label: 'Joining Date', group: 'Employee' },
  { tag: '##EMPLOYEE_EXIT_DATE##', label: 'Exit Date', group: 'Employee' },
  { tag: '##EMPLOYEE_NOTICE_PERIOD_START_DATE##', label: 'Notice Start', group: 'Employee' },
  { tag: '##EMPLOYEE_NOTICE_PERIOD_END_DATE##', label: 'Notice End', group: 'Employee' },
  { tag: '##COMPANY_NAME##', label: 'Company Name', group: 'Company' },
  { tag: '##CONTACT_ADDRESS##', label: 'Company Address', group: 'Company' },
  { tag: '##CURRENT_DATE##', label: "Today's Date", group: 'Company' },
  { tag: '##SIGNATORY##', label: 'Signatory Name', group: 'Signatory' },
  { tag: '##SIGNATORY_DESIGNATION##', label: 'Signatory Designation', group: 'Signatory' },
  { tag: '##SIGNATORY_DEPARTMENT##', label: 'Signatory Department', group: 'Signatory' },
];

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface TemplateInput {
  title?: string;
  body?: string;
  description?: string;
  isActive?: boolean;
  displayOrder?: number;
  scope?: string; // EMPLOYEE | CANDIDATE
  autoOnOnboarding?: boolean;
  useForOfferLetter?: boolean;
}

/**
 * In a candidate template the ##EMPLOYEE_*## tags resolve to the applicant's
 * details, since no employee record exists until they are hired. These extra
 * tags are only meaningful there.
 */
export const CANDIDATE_MERGE_TAGS: { tag: string; label: string; group: string }[] = [
  { tag: '##EMPLOYEE_NAME##', label: 'Candidate Name', group: 'Candidate' },
  { tag: '##EMPLOYEE_ADDRESS##', label: 'Candidate Address', group: 'Candidate' },
  { tag: '##EMPLOYEE_EMAIL##', label: 'Candidate Email', group: 'Candidate' },
  { tag: '##EMPLOYEE_MOBILE##', label: 'Candidate Phone', group: 'Candidate' },
  { tag: '##EMPLOYEE_DESIGNATION##', label: 'Job Title', group: 'Candidate' },
  { tag: '##EMPLOYEE_JOINING_DATE##', label: 'Joining Date', group: 'Candidate' },
  { tag: '##OFFERED_CTC##', label: 'Offered CTC', group: 'Offer' },
  { tag: '##ANNUAL_CTC##', label: 'Annual CTC', group: 'Offer' },
  { tag: '##MONTHLY_CTC##', label: 'Monthly CTC', group: 'Offer' },
  { tag: '##SALARY_TABLE##', label: 'Salary Annexure Table', group: 'Offer' },
  { tag: '##REPORTING_TIME##', label: 'Reporting Time', group: 'Offer' },
  { tag: '##COMPANY_NAME##', label: 'Company Name', group: 'Company' },
  { tag: '##CONTACT_ADDRESS##', label: 'Company Address', group: 'Company' },
  { tag: '##CURRENT_DATE##', label: 'Issue Date', group: 'Company' },
];

@Injectable()
export class LettersService {
  constructor(private prisma: PrismaService) {}

  getMergeTags(scope?: string) {
    return (scope || '').toUpperCase() === 'CANDIDATE' ? CANDIDATE_MERGE_TAGS : MERGE_TAGS;
  }

  // ── templates ──────────────────────────────────────────────────────────
  findTemplates(companyId: number) {
    return this.prisma.letterTemplate.findMany({
      where: { companyId },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
      select: {
        id: true, title: true, description: true, isActive: true,
        scope: true, autoOnOnboarding: true, useForOfferLetter: true,
        displayOrder: true, createdAt: true, updatedAt: true,
        _count: { select: { letters: true } },
      },
    });
  }

  async findTemplate(companyId: number, id: number) {
    const t = await this.prisma.letterTemplate.findFirst({ where: { id, companyId } });
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  async createTemplate(companyId: number, data: TemplateInput) {
    if (!data.title?.trim()) throw new BadRequestException('Title is required');
    const clash = await this.prisma.letterTemplate.findFirst({
      where: { companyId, title: data.title.trim() }, select: { id: true },
    });
    if (clash) throw new BadRequestException('A template with that title already exists');
    const created = await this.prisma.letterTemplate.create({
      data: {
        companyId,
        title: data.title.trim(),
        body: data.body ?? '',
        description: data.description ?? null,
        isActive: data.isActive ?? true,
        displayOrder: data.displayOrder ?? 0,
        scope: (data.scope || 'EMPLOYEE').toUpperCase(),
        autoOnOnboarding: data.autoOnOnboarding ?? false,
        useForOfferLetter: data.useForOfferLetter ?? false,
      },
    });
    await this.enforceSingleOfferLetter(companyId, created.id, data.useForOfferLetter);
    return created;
  }

  /** Only one template can drive the offer letter; setting one clears the rest. */
  private async enforceSingleOfferLetter(companyId: number, keepId: number, on?: boolean) {
    if (!on) return;
    await this.prisma.letterTemplate.updateMany({
      where: { companyId, useForOfferLetter: true, id: { not: keepId } },
      data: { useForOfferLetter: false },
    });
  }

  async updateTemplate(companyId: number, id: number, data: TemplateInput) {
    await this.findTemplate(companyId, id);
    if (data.title !== undefined && !data.title.trim()) {
      throw new BadRequestException('Title is required');
    }
    if (data.title) {
      const clash = await this.prisma.letterTemplate.findFirst({
        where: { companyId, title: data.title.trim(), id: { not: id } }, select: { id: true },
      });
      if (clash) throw new BadRequestException('A template with that title already exists');
    }
    const updated = await this.prisma.letterTemplate.update({
      where: { id },
      data: {
        title: data.title?.trim(),
        body: data.body,
        description: data.description,
        isActive: data.isActive,
        displayOrder: data.displayOrder,
        scope: data.scope ? data.scope.toUpperCase() : undefined,
        autoOnOnboarding: data.autoOnOnboarding,
        useForOfferLetter: data.useForOfferLetter,
      },
    });
    await this.enforceSingleOfferLetter(companyId, id, data.useForOfferLetter);
    return updated;
  }

  async deleteTemplate(companyId: number, id: number) {
    await this.findTemplate(companyId, id);
    // Issued letters keep their rendered snapshot; the FK just goes null.
    await this.prisma.letterTemplate.delete({ where: { id } });
    return { success: true };
  }

  // ── rendering ──────────────────────────────────────────────────────────
  private async buildValues(companyId: number, employeeId: number, signatoryEmployeeId?: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        user: { select: { email: true } },
        department: { select: { name: true } },
        designation: { select: { name: true } },
      },
    });
    if (!employee) throw new BadRequestException('Employee not found');

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });

    // Exit and notice dates live on the resignation, not the employee record.
    // Notice runs from when the resignation was filed to the last working day.
    const resignation = await this.prisma.resignation.findFirst({
      where: { employeeId, companyId, status: { not: 'WITHDRAWN' } },
      orderBy: { createdAt: 'desc' },
    });
    const lastDay = resignation?.approvedLastWorkingDay ?? resignation?.intendedLastWorkingDay ?? null;

    let signatory: any = null;
    if (signatoryEmployeeId) {
      signatory = await this.prisma.employee.findFirst({
        where: { id: signatoryEmployeeId, companyId },
        include: { department: { select: { name: true } }, designation: { select: { name: true } } },
      });
    }

    const e: any = employee;
    return {
      '##EMPLOYEE_NAME##': [e.firstName, e.lastName].filter(Boolean).join(' '),
      '##EMPLOYEE_ID##': e.employeeCode || '',
      '##EMPLOYEE_DESIGNATION##': e.designation?.name || '',
      '##EMPLOYEE_DEPARTMENT##': e.department?.name || '',
      '##EMPLOYEE_ADDRESS##': e.address || '',
      '##EMPLOYEE_EMAIL##': e.user?.email || '',
      '##EMPLOYEE_MOBILE##': e.phone || '',
      '##EMPLOYEE_JOINING_DATE##': fmtDate(e.joiningDate),
      '##EMPLOYEE_EXIT_DATE##': fmtDate(lastDay),
      '##EMPLOYEE_NOTICE_PERIOD_START_DATE##': fmtDate(resignation?.createdAt),
      '##EMPLOYEE_NOTICE_PERIOD_END_DATE##': fmtDate(lastDay),
      '##COMPANY_NAME##': (company as any)?.name || '',
      '##CONTACT_ADDRESS##': (company as any)?.address || '',
      '##CURRENT_DATE##': fmtDate(new Date()),
      '##SIGNATORY##': signatory ? [signatory.firstName, signatory.lastName].filter(Boolean).join(' ') : '',
      '##SIGNATORY_DESIGNATION##': signatory?.designation?.name || '',
      '##SIGNATORY_DEPARTMENT##': signatory?.department?.name || '',
    } as Record<string, string>;
  }

  private render(body: string, values: Record<string, string>): string {
    // Replace the longest tags first so ##EMPLOYEE_NOTICE_PERIOD_START_DATE##
    // isn't clipped by a shorter tag that shares its prefix.
    const tags = Object.keys(values).sort((a, b) => b.length - a.length);
    let out = body || '';
    for (const t of tags) {
      out = out.split(t).join(values[t] ?? '');
    }
    return out;
  }

  /** Render a template against an employee without saving anything. */
  async preview(companyId: number, data: { templateId: number; employeeId: number; signatoryEmployeeId?: number }) {
    const template = await this.findTemplate(companyId, data.templateId);
    const values = await this.buildValues(companyId, data.employeeId, data.signatoryEmployeeId);
    return { title: template.title, body: this.render(template.body, values) };
  }

  // ── issued letters ─────────────────────────────────────────────────────
  /**
   * Every letter this company has issued, from both sources:
   *
   *  - GeneratedLetter — letters rendered from a template for an employee.
   *  - OfferLetter     — the recruitment e-signature flow, which is keyed to a
   *                      job application rather than an employee, so it lives in
   *                      its own table. Those never appeared here before, which
   *                      made a signed offer look missing.
   *
   * Rows are normalised into one shape and merged newest-first. Offer rows carry
   * `source: 'OFFER'` plus their signature state so the UI can badge them and
   * link to the countersigned PDF.
   */
  async findLetters(companyId: number, employeeId?: number) {
    const generated = await this.prisma.generatedLetter.findMany({
      where: { companyId, ...(employeeId ? { employeeId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, pdfUrl: true, createdAt: true,
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, phone: true,
            user: { select: { email: true } },
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        template: { select: { id: true, title: true } },
      },
    });

    const rows: any[] = generated.map(g => ({
      ...g,
      source: 'TEMPLATE',
      employee: {
        id: g.employee?.id ?? null,
        firstName: g.employee?.firstName,
        lastName: g.employee?.lastName,
        employeeCode: g.employee?.employeeCode,
        avatarUrl: g.employee?.avatarUrl,
        email: g.employee?.user?.email ?? null,
        phone: g.employee?.phone ?? null,
        designation: g.employee?.designation?.name ?? null,
        department: g.employee?.department?.name ?? null,
      },
      candidateEmail: g.employee?.user?.email ?? null,
      candidatePhone: g.employee?.phone ?? null,
    }));

    // An offer belongs to a candidate, so it can't be filtered by employee id.
    if (!employeeId) {
      const offers = await this.prisma.offerLetter.findMany({
        where: { companyId },
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true, status: true, pdfUrl: true, countersignedPdfUrl: true,
          issuedAt: true, createdAt: true, respondedAt: true,
          signatureName: true, signatureType: true, signatureIp: true, viewedAt: true,
          application: {
            select: {
              id: true, fullName: true, email: true, phone: true,
              job: { select: { title: true } },
            },
          },
        },
      });

      for (const o of offers) {
        // Skip historical records imported from Worksuite. This system only ever
        // sets ACCEPTED through the signing flow, which always writes signature
        // data — so ACCEPTED with no signature and no response can only have come
        // from an import. Listing those as "Awaiting signature" is wrong twice
        // over: nobody is waiting, and nobody ever signed here.
        const neverSignedHere = !o.signatureName && !o.respondedAt;
        if (o.status === 'ACCEPTED' && neverSignedHere) continue;

        const [firstName, ...rest] = (o.application?.fullName || 'Candidate').split(' ');
        rows.push({
          id: o.id,
          source: 'OFFER',
          title: 'Offer Letter',
          // Candidates have no employee record until they are hired.
          employee: {
            id: null,
            firstName,
            lastName: rest.join(' '),
            employeeCode: null,
            avatarUrl: null,
            email: o.application?.email ?? null,
            phone: o.application?.phone ?? null,
            designation: o.application?.job?.title ?? null,
            department: null,
          },
          applicationId: o.application?.id ?? null,
          candidateEmail: o.application?.email ?? null,
          candidatePhone: o.application?.phone ?? null,
          jobTitle: o.application?.job?.title ?? null,
          template: { id: null, title: 'Offer Letter (Recruitment)' },
          pdfUrl: o.countersignedPdfUrl || o.pdfUrl,
          createdAt: o.issuedAt ?? o.createdAt,
          offerStatus: o.status,
          // Only a real e-signature counts as signed here. Rows imported from
          // Worksuite carry status ACCEPTED without one, and must not be
          // presented as though someone signed in this system.
          isSigned: !!o.signatureName,
          signatureName: o.signatureName,
          signatureType: o.signatureType,
          signatureIp: o.signatureIp,
          signedAt: o.respondedAt,
          viewedAt: o.viewedAt,
        });
      }
    }

    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return rows;
  }

  /**
   * One issued letter. `source` says which table the id belongs to, since the
   * two share an id space. An offer letter has no stored HTML body — it exists
   * only as a PDF — so the caller gets the PDF url and signature detail instead.
   */
  async findLetter(companyId: number, id: number, source?: string) {
    if ((source || '').toUpperCase() === 'OFFER') {
      const o = await this.prisma.offerLetter.findFirst({
        where: { id, companyId },
        include: {
          application: {
            select: { id: true, fullName: true, email: true, phone: true, offeredSalary: true,
                      joiningDate: true, job: { select: { title: true } } },
          },
        },
      });
      if (!o) throw new NotFoundException('Offer letter not found');
      const [firstName, ...rest] = (o.application?.fullName || 'Candidate').split(' ');
      return {
        id: o.id,
        source: 'OFFER',
        title: 'Offer Letter',
        body: null,
        pdfUrl: o.countersignedPdfUrl || o.pdfUrl,
        signedPdfUrl: o.countersignedPdfUrl,
        createdAt: o.issuedAt ?? o.createdAt,
        employee: {
          id: null,
          firstName,
          lastName: rest.join(' '),
          employeeCode: null,
          avatarUrl: null,
          email: o.application?.email ?? null,
          phone: o.application?.phone ?? null,
          designation: o.application?.job?.title ?? null,
          department: null,
        },
        template: { id: null, title: 'Offer Letter (Recruitment)' },
        applicationId: o.application?.id ?? null,
        candidateEmail: o.application?.email ?? null,
        candidatePhone: o.application?.phone ?? null,
        jobTitle: o.application?.job?.title ?? null,
        offeredSalary: o.application?.offeredSalary ?? null,
        joiningDate: o.application?.joiningDate ?? null,
        offerStatus: o.status,
        isSigned: !!o.signatureName,
        signatureName: o.signatureName,
        signatureType: o.signatureType,
        signatureIp: o.signatureIp,
        signatureImage: o.signatureImage,
        signedAt: o.respondedAt,
        viewedAt: o.viewedAt,
      };
    }

    const l = await this.prisma.generatedLetter.findFirst({
      where: { id, companyId },
      include: {
        employee: {
          select: {
            id: true, firstName: true, lastName: true, employeeCode: true, avatarUrl: true, phone: true,
            user: { select: { email: true } },
            department: { select: { name: true } },
            designation: { select: { name: true } },
          },
        },
        template: { select: { id: true, title: true } },
      },
    });
    if (!l) throw new NotFoundException('Letter not found');
    return {
      ...l,
      source: 'TEMPLATE',
      employee: {
        id: l.employee?.id ?? null,
        firstName: l.employee?.firstName,
        lastName: l.employee?.lastName,
        employeeCode: l.employee?.employeeCode,
        avatarUrl: l.employee?.avatarUrl,
        email: l.employee?.user?.email ?? null,
        phone: l.employee?.phone ?? null,
        designation: l.employee?.designation?.name ?? null,
        department: l.employee?.department?.name ?? null,
      },
      candidateEmail: l.employee?.user?.email ?? null,
      candidatePhone: l.employee?.phone ?? null,
    };
  }

  /** Render and store a letter. The stored body is a snapshot, not a live view. */
  async generate(companyId: number, issuedById: number | undefined, data: {
    templateId: number; employeeId: number; signatoryEmployeeId?: number;
    title?: string; body?: string;
    marginTop?: number; marginBottom?: number; marginLeft?: number; marginRight?: number;
  }) {
    const template = await this.findTemplate(companyId, data.templateId);
    const values = await this.buildValues(companyId, data.employeeId, data.signatoryEmployeeId);
    // An edited body from the preview screen wins over the stored template.
    const body = this.render(data.body ?? template.body, values);

    return this.prisma.generatedLetter.create({
      data: {
        companyId,
        employeeId: data.employeeId,
        templateId: template.id,
        title: (data.title || template.title).trim(),
        body,
        issuedById: issuedById ?? null,
        marginTop: data.marginTop ?? 20,
        marginBottom: data.marginBottom ?? 20,
        marginLeft: data.marginLeft ?? 20,
        marginRight: data.marginRight ?? 20,
      },
    });
  }

  /**
   * Issue every template flagged for onboarding to a newly created employee.
   *
   * Called after a candidate is converted, which is the first point at which an
   * Employee row exists for the merge tags to resolve against. Failures are
   * swallowed per template: a letter that cannot render must never roll back
   * or block the hire itself.
   */
  async generateOnboardingLetters(companyId: number, employeeId: number, issuedById?: number) {
    const templates = await this.prisma.letterTemplate.findMany({
      where: { companyId, isActive: true, autoOnOnboarding: true },
      orderBy: [{ displayOrder: 'asc' }, { title: 'asc' }],
    });
    if (!templates.length) return { issued: 0, titles: [] as string[] };

    // The signatory is whoever ran the onboarding; issuedById is a User id, so
    // resolve it to their employee record for the ##SIGNATORY_*## tags.
    const signer = issuedById
      ? await this.prisma.employee.findFirst({
          where: { userId: issuedById, companyId }, select: { id: true },
        })
      : null;
    const values = await this.buildValues(companyId, employeeId, signer?.id);
    const titles: string[] = [];
    for (const t of templates) {
      try {
        await this.prisma.generatedLetter.create({
          data: {
            companyId, employeeId, templateId: t.id,
            title: t.title,
            body: this.render(t.body, values),
            issuedById: issuedById ?? null,
          },
        });
        titles.push(t.title);
      } catch {
        // Skip this template; the rest of onboarding continues.
      }
    }
    return { issued: titles.length, titles };
  }

  async deleteLetter(companyId: number, id: number, source?: string) {
    // Offer letters are recruitment records with a signature trail; they are
    // managed from the candidate, not deleted from the letters list.
    if ((source || '').toUpperCase() === 'OFFER') {
      throw new BadRequestException('Offer letters are managed from the candidate record and cannot be deleted here');
    }
    await this.findLetter(companyId, id);
    await this.prisma.generatedLetter.delete({ where: { id } });
    return { success: true };
  }
}
