import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { LeadFormsService } from './lead-forms.service';

// PUBLIC endpoints — deliberately NO @UseGuards. Used by the generated public
// Lead Form (via /lead-form/:formKey) and for iframe embedding on external sites.
@Controller('public/lead-form')
export class PublicLeadFormController {
  constructor(private readonly service: LeadFormsService) {}

  @Get(':formKey')
  get(@Param('formKey') formKey: string) {
    return this.service.getPublicForm(formKey);
  }

  @Post(':formKey/submit')
  submit(@Param('formKey') formKey: string, @Body() body: any) {
    return this.service.submitPublicForm(formKey, body ?? {});
  }
}
