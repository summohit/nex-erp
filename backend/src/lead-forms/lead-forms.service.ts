import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import * as crypto from 'crypto';

export interface LeadFormFieldDef {
  fieldKey: string;
  label: string;
  type: string; // text, email, tel, url, textarea, select
  isName?: boolean;
  defaultRequired?: boolean;
}

// The canonical set of fields the builder can offer. Enabling/disabling,
// required and order are stored per-form in LeadFormField.
export const LEAD_FORM_FIELD_DEFS: LeadFormFieldDef[] = [
  { fieldKey: 'name', label: 'Name', type: 'text', isName: true, defaultRequired: true },
  { fieldKey: 'email', label: 'Email', type: 'email' },
  { fieldKey: 'companyName', label: 'Company Name', type: 'text' },
  { fieldKey: 'website', label: 'Website', type: 'url' },
  { fieldKey: 'address', label: 'Address', type: 'textarea' },
  { fieldKey: 'mobile', label: 'Mobile', type: 'tel' },
  { fieldKey: 'message', label: 'Message', type: 'textarea' },
  { fieldKey: 'city', label: 'City', type: 'text' },
  { fieldKey: 'state', label: 'State', type: 'text' },
  { fieldKey: 'country', label: 'Country', type: 'select' },
  { fieldKey: 'postalCode', label: 'Postal Code', type: 'text' },
  { fieldKey: 'source', label: 'Source', type: 'select' },
  { fieldKey: 'product', label: 'Product', type: 'select' },
];

export const LEAD_SOURCES = [
  'Website / Inbound', 'Referral', 'Social Media', 'Cold Outreach',
  'Email Campaign', 'Event / Trade Show', 'Partner / Reseller',
  'Paid Ads', 'Direct / Walk-In', 'Other',
];

const COUNTRIES = [
  'India', 'United Arab Emirates', 'United States', 'United Kingdom', 'Saudi Arabia',
  'Qatar', 'Kuwait', 'Oman', 'Bahrain', 'Singapore', 'Australia', 'Canada', 'Germany', 'Other',
];

function generateFormKey(id: number): string {
  return Buffer.from(id.toString()).toString('base64url');
}

function parseFormKey(formKey: string): number {
  try {
    const n = parseInt(Buffer.from(formKey, 'base64url').toString('utf8'), 10);
    if (Number.isFinite(n)) return n;
  } catch {
    /* ignore */
  }
  return NaN;
}

@Injectable()
export class LeadFormsService {
  constructor(
    private prisma: PrismaService,
    private crmService: CrmService,
  ) {}

  // ─────────────────────────────────────────────
  // FIELD VALUE VALIDATION (shared admin/public)
  // ─────────────────────────────────────────────
  private validateValue(field: LeadFormFieldDef & { required: boolean }, raw: any): { value: string; error?: string } {
    const value = raw === undefined || raw === null ? '' : String(raw).trim();

    if (field.required && !value) {
      return { value, error: `${field.label} is required.` };
    }
    if (!value) return { value: '' };

    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { value, error: `Please enter a valid email address.` };
    }
    if (field.type === 'url') {
      const test = value.startsWith('http') ? value : `https://${value}`;
      if (!/^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w\-./?%&=]*)?$/i.test(test)) {
        return { value, error: `Please enter a valid website URL.` };
      }
    }
    return { value };
  }

  // ─────────────────────────────────────────────
  // ADMIN API
  // ─────────────────────────────────────────────
  listForms(companyId: number) {
    return this.prisma.leadForm.findMany({
      where: { companyId },
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { leadsCreated: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForm(companyId: number, id: number) {
    const form = await this.prisma.leadForm.findFirst({
      where: { id, companyId },
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
        _count: { select: { leadsCreated: true } },
      },
    });
    if (!form) throw new NotFoundException('Lead Form not found');
    return form;
  }

  async createForm(companyId: number, data: any, userId: number) {
    let createdById: number | null = null;
    if (userId) {
      const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      createdById = employee?.id ?? null;
    }
    const form = await this.prisma.leadForm.create({
      data: {
        companyId,
        name: this.requireName(data.name),
        description: data.description || null,
        source: data.source || 'Lead Form',
        successMessage: data.successMessage || 'Thank you! Your enquiry has been received.',
        redirectUrl: data.redirectUrl || null,
        productOptions: this.sanitizeProductOptions(data.productOptions),
        createdById,
        formKey: '__pending__',
        fields: {
          create: this.buildFields(data.fields),
        },
      },
    });

    const formKey = data.formKey || generateFormKey(form.id);
    return this.prisma.leadForm.update({
      where: { id: form.id },
      data: { formKey },
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { leadsCreated: true } },
      },
    });
  }

  async updateForm(companyId: number, id: number, data: any) {
    const form = await this.prisma.leadForm.findFirst({ where: { id, companyId } });
    if (!form) throw new NotFoundException('Lead Form not found');

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = this.requireName(data.name);
    if (data.description !== undefined) updateData.description = data.description;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.successMessage !== undefined) updateData.successMessage = data.successMessage;
    if (data.redirectUrl !== undefined) updateData.redirectUrl = data.redirectUrl;
    if (data.captchaEnabled !== undefined) updateData.captchaEnabled = !!data.captchaEnabled;
    if (data.productOptions !== undefined) updateData.productOptions = this.sanitizeProductOptions(data.productOptions);
    if (data.status !== undefined) updateData.status = data.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';

    // Replace fields atomically when provided.
    if (data.fields !== undefined) {
      await this.prisma.$transaction([
        this.prisma.leadFormField.deleteMany({ where: { formId: id } }),
        this.prisma.leadFormField.createMany({ data: this.buildFields(data.fields).map((f) => ({ ...f, formId: id })) }),
      ]);
    }

    return this.prisma.leadForm.update({
      where: { id },
      data: updateData,
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { leadsCreated: true } },
      },
    });
  }

  async setFormStatus(companyId: number, id: number, status: string) {
    const form = await this.prisma.leadForm.findFirst({ where: { id, companyId } });
    if (!form) throw new NotFoundException('Lead Form not found');
    return this.prisma.leadForm.update({
      where: { id },
      data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' },
    });
  }

  async duplicateForm(companyId: number, id: number) {
    const form = await this.getForm(companyId, id);
    const clone = await this.prisma.leadForm.create({
      data: {
        companyId,
        name: `${form.name} (Copy)`,
        description: form.description,
        source: form.source,
        successMessage: form.successMessage,
        redirectUrl: form.redirectUrl,
        captchaEnabled: form.captchaEnabled,
        productOptions: form.productOptions as any,
        createdById: form.createdById,
        formKey: '__pending__',
        fields: {
          create: form.fields.map((f: any) => ({
            fieldKey: f.fieldKey,
            label: f.label,
            type: f.type,
            enabled: f.enabled,
            required: f.required,
            isName: f.isName,
            sortOrder: f.sortOrder,
            options: f.options as any,
          })),
        },
      },
    });
    const formKey = generateFormKey(clone.id);
    return this.prisma.leadForm.update({
      where: { id: clone.id },
      data: { formKey },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async deleteForm(companyId: number, id: number) {
    const form = await this.prisma.leadForm.findFirst({ where: { id, companyId } });
    if (!form) throw new NotFoundException('Lead Form not found');
    return this.prisma.leadForm.delete({ where: { id } });
  }

  private requireName(name: string): string {
    if (!name || !String(name).trim()) throw new BadRequestException('Form name is required');
    return String(name).trim();
  }

  private sanitizeProductOptions(options: any): any {
    if (options === undefined || options === null) return undefined;
    if (!Array.isArray(options)) return undefined;
    return options.map((o) => String(o)).filter(Boolean);
  }

  private buildFields(fields: any): any[] {
    if (!Array.isArray(fields) || fields.length === 0) {
      // default: all fields enabled
      return LEAD_FORM_FIELD_DEFS.map((def, i) => ({
        fieldKey: def.fieldKey,
        label: def.label,
        type: def.type,
        enabled: true,
        required: !!def.defaultRequired,
        isName: !!def.isName,
        sortOrder: i,
      }));
    }
    return fields.map((f, i) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      type: f.type,
      enabled: f.enabled === false ? false : true,
      required: !!(f.isName || f.required),
      isName: !!f.isName,
      sortOrder: typeof f.sortOrder === 'number' ? f.sortOrder : i,
      options: this.sanitizeProductOptions(f.options),
    }));
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────
  async getPublicForm(formKey: string) {
    const id = parseFormKey(formKey);
    if (!Number.isFinite(id)) throw new NotFoundException('Lead Form not found');
    const form = await this.prisma.leadForm.findUnique({
      where: { id },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!form || form.status !== 'ACTIVE') throw new NotFoundException('Lead Form not found');

    const fieldDefs = this.resolveFieldDefs(form.productOptions as any);
    const fields = form.fields
      .filter((f: any) => f.enabled)
      .map((f: any) => {
        const def = fieldDefs[f.fieldKey] || { options: undefined };
        return {
          fieldKey: f.fieldKey,
          label: f.label,
          type: f.type,
          required: f.required,
          isName: f.isName,
          options: def.options ?? undefined,
        };
      });

    return {
      formKey: form.formKey,
      name: form.name,
      description: form.description,
      successMessage: form.successMessage,
      captchaEnabled: form.captchaEnabled,
      fields,
    };
  }

  async submitPublicForm(formKey: string, payload: any) {
    const id = parseFormKey(formKey);
    if (!Number.isFinite(id)) throw new NotFoundException('Lead Form not found');
    const form = await this.prisma.leadForm.findUnique({
      where: { id },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!form || form.status !== 'ACTIVE') throw new NotFoundException('Lead Form not found');

    const fieldDefs = this.resolveFieldDefs(form.productOptions as any);
    const configured = form.fields
      .filter((f: any) => f.enabled)
      .map((f: any) => ({
        fieldKey: f.fieldKey,
        label: f.label,
        type: f.type,
        required: f.required,
        isName: f.isName,
        options: fieldDefs[f.fieldKey]?.options,
      }));

    // Validate only configured, enabled fields. Ignore anything else submitted.
    const values: Record<string, string> = {};
    for (const field of configured) {
      const { value, error } = this.validateValue(field, payload[field.fieldKey]);
      if (error) throw new BadRequestException(error);
      values[field.fieldKey] = value;
    }

    const nameField = configured.find((f) => f.isName) || configured.find((f) => f.fieldKey === 'name');
    const title = (nameField && values[nameField.fieldKey]) || form.name;
    if (!title) throw new BadRequestException('Name is required.');

    const leadData: any = {
      title,
      contactName: values.name || (nameField ? values[nameField.fieldKey] : undefined) || null,
      email: values.email || null,
      phone: values.mobile || values.phone || null,
      companyName: values.companyName || null,
      website: values.website || null,
      address: values.address || null,
      source: values.source || form.source,
      leadFormId: form.id,
      description: values.message || null,
    };

    const created = await this.crmService.createLead(form.companyId, leadData, null);
    return {
      success: true,
      message: form.successMessage || 'Thank you! Your enquiry has been received.',
      leadId: created.id,
      redirectUrl: form.redirectUrl || null,
    };
  }

  private resolveFieldDefs(productOptions: string[] | null): Record<string, any> {
    const map: Record<string, any> = {
      source: { options: LEAD_SOURCES },
      country: { options: COUNTRIES },
      product: { options: productOptions && productOptions.length ? productOptions : ['Product A', 'Product B', 'Product C'] },
    };
    return map;
  }

  // Public-form capability descriptor (used by builder to show option source)
  getAvailableSources() {
    return LEAD_SOURCES;
  }
}
