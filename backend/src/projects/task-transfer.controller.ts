import {
  BadRequestException, Controller, ForbiddenException, Get, Post, Query, Req, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { canManageTask } from '../tasks/task-permissions';
import { TaskTransferService } from './task-transfer.service';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Task export / import in the "template project task" layout.
 *
 * Own prefix rather than /projects, so routes like /projects/:id can never
 * swallow "tasks/export". Export, template and import are for people who run
 * the project's plan: administrators, or the PM / owner of every project the
 * file touches.
 */
@UseGuards(AuthGuard)
@Controller('project-tasks')
export class TaskTransferController {
  constructor(private transfer: TaskTransferService, private prisma: PrismaService) {}

  @Get('export')
  async export(
    @Req() req, @Res() res,
    @Query('projectIds') projectIds?: string, @Query('includeDone') includeDone?: string,
  ) {
    const ids = this.ids(projectIds);
    await this.assertMayManage(req, ids);
    const buf = await this.transfer.exportTasks(req.user.companyId, { projectIds: ids, includeDone: includeDone === '1' || includeDone === 'true' });
    this.send(res, buf, `project-tasks-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  @Get('template')
  async template(@Req() req, @Res() res, @Query('projectIds') projectIds?: string) {
    const ids = this.ids(projectIds);
    await this.assertMayManage(req, ids);
    this.send(res, await this.transfer.template(req.user.companyId, ids), 'project-task-template.xlsx');
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  async preview(@Req() req, @UploadedFile() file: Express.Multer.File, @Query('projectId') projectId?: string) {
    if (!file?.buffer) throw new BadRequestException('Attach the Excel file.');
    const scope = projectId ? Number(projectId) : undefined;
    await this.assertMayManage(req, scope ? [scope] : undefined);
    return this.transfer.preview(req.user.companyId, file.buffer, scope);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  async import(@Req() req, @UploadedFile() file: Express.Multer.File, @Query('projectId') projectId?: string) {
    if (!file?.buffer) throw new BadRequestException('Attach the Excel file.');
    const scope = projectId ? Number(projectId) : undefined;
    await this.assertMayManage(req, scope ? [scope] : undefined);
    const employeeId = req.user.employeeId;
    if (!employeeId) throw new ForbiddenException('Your login is not linked to an employee record.');
    return this.transfer.import(req.user.companyId, file.buffer, employeeId, req.user.role, scope);
  }

  private ids(text?: string): number[] | undefined {
    const ids = String(text ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ids.length ? ids : undefined;
  }

  /** Admins anywhere; otherwise only for projects the caller manages, and never company-wide. */
  private async assertMayManage(req: any, projectIds?: number[]) {
    const role = req.user.role;
    if (role === 'SUPERADMIN' || role === 'ADMIN') return;
    if (!projectIds?.length) {
      throw new ForbiddenException('Only an administrator can export or import tasks across all projects.');
    }
    for (const id of projectIds) {
      if (!(await canManageTask(this.prisma, req.user.companyId, id, req.user.employeeId, role))) {
        throw new ForbiddenException('Only the project manager or an administrator can export or import this project\'s tasks.');
      }
    }
  }

  private send(res: any, buf: Buffer, name: string) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buf);
  }
}
