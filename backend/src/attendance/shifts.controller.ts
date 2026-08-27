import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('shifts')
@UseGuards(AuthGuard, PermissionsGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  findAll(@Request() req) {
    return this.shiftsService.findAll(req.user.companyId);
  }

  @Get('me')
  getMyShift(@Request() req) {
    return this.shiftsService.getMyShift(req.user.sub);
  }

  @Post()
  @Permissions('attendance/shifts')
  create(@Request() req, @Body() data: any) {
    return this.shiftsService.create(req.user.companyId, data);
  }

  @Put(':id')
  @Permissions('attendance/shifts')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.shiftsService.update(req.user.companyId, id, data);
  }

  @Delete(':id')
  @Permissions('attendance/shifts')
  delete(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.delete(req.user.companyId, id);
  }
}
