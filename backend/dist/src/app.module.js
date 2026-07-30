"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const prisma_module_1 = require("./prisma/prisma.module");
const upload_module_1 = require("./upload/upload.module");
const master_data_module_1 = require("./master-data/master-data.module");
const company_module_1 = require("./company/company.module");
const permissions_module_1 = require("./permissions/permissions.module");
const employees_module_1 = require("./employees/employees.module");
const onboarding_module_1 = require("./onboarding/onboarding.module");
const attendance_module_1 = require("./attendance/attendance.module");
const leaves_module_1 = require("./leaves/leaves.module");
const payroll_module_1 = require("./payroll/payroll.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, users_module_1.UsersModule, prisma_module_1.PrismaModule, upload_module_1.UploadModule, master_data_module_1.MasterDataModule, company_module_1.CompanyModule, permissions_module_1.PermissionsModule, employees_module_1.EmployeesModule, onboarding_module_1.OnboardingModule, attendance_module_1.AttendanceModule, leaves_module_1.LeavesModule, payroll_module_1.PayrollModule],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map