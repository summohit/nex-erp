"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayrollController = void 0;
const common_1 = require("@nestjs/common");
const payroll_service_1 = require("./payroll.service");
const auth_guard_1 = require("../auth/auth.guard");
let PayrollController = class PayrollController {
    payrollService;
    constructor(payrollService) {
        this.payrollService = payrollService;
    }
    getSalaryComponents(req) {
        return this.payrollService.getSalaryComponents(req.user.companyId);
    }
    createSalaryComponent(req, data) {
        return this.payrollService.createSalaryComponent(req.user.companyId, data);
    }
    updateSalaryComponent(req, id, data) {
        return this.payrollService.updateSalaryComponent(req.user.companyId, id, data);
    }
    deleteSalaryComponent(req, id) {
        return this.payrollService.deleteSalaryComponent(req.user.companyId, id);
    }
    getSalaryStructure(req, employeeId) {
        return this.payrollService.getSalaryStructure(req.user.companyId, employeeId);
    }
    updateSalaryStructure(req, employeeId, items) {
        return this.payrollService.updateSalaryStructure(req.user.companyId, employeeId, items);
    }
    generatePayslips(req, body) {
        return this.payrollService.generatePayslips(req.user.companyId, Number(body.month), Number(body.year));
    }
    batchSendEmails(req, body) {
        return this.payrollService.batchSendPayslipEmails(req.user.companyId, Number(body.month), Number(body.year));
    }
    getMyPayslips(req) {
        return this.payrollService.getMyPayslips(req.user.companyId, req.user.sub);
    }
    getPayslips(req, month, year) {
        return this.payrollService.getPayslips(req.user.companyId, month, year);
    }
    batchFinalizePayslips(req, body) {
        return this.payrollService.batchFinalizePayslips(req.user.companyId, Number(body.month), Number(body.year));
    }
    markPayslipsPaid(req, body) {
        return this.payrollService.markPayslipsPaid(req.user.companyId, Number(body.month), Number(body.year));
    }
    updatePayslip(req, id, data) {
        return this.payrollService.updatePayslip(req.user.companyId, id, data);
    }
    createExpenseClaim(req, data) {
        return this.payrollService.createExpenseClaim(req.user.companyId, req.user.sub, data);
    }
    getMyExpenseClaims(req) {
        return this.payrollService.getMyExpenseClaims(req.user.companyId, req.user.sub);
    }
    getAllExpenseClaims(req) {
        return this.payrollService.getAllExpenseClaims(req.user.companyId);
    }
    updateExpenseClaimStatus(req, id, data) {
        return this.payrollService.updateExpenseClaimStatus(req.user.companyId, req.user.sub, id, data);
    }
    deleteExpenseClaim(req, id) {
        return this.payrollService.deleteExpenseClaim(req.user.companyId, req.user.sub, id);
    }
};
exports.PayrollController = PayrollController;
__decorate([
    (0, common_1.Get)('components'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "getSalaryComponents", null);
__decorate([
    (0, common_1.Post)('components'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "createSalaryComponent", null);
__decorate([
    (0, common_1.Put)('components/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "updateSalaryComponent", null);
__decorate([
    (0, common_1.Delete)('components/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "deleteSalaryComponent", null);
__decorate([
    (0, common_1.Get)('structure/:employeeId'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('employeeId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "getSalaryStructure", null);
__decorate([
    (0, common_1.Post)('structure/:employeeId'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('employeeId', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Array]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "updateSalaryStructure", null);
__decorate([
    (0, common_1.Post)('payslips/generate'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "generatePayslips", null);
__decorate([
    (0, common_1.Post)('payslips/send-emails'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "batchSendEmails", null);
__decorate([
    (0, common_1.Get)('payslips/me'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "getMyPayslips", null);
__decorate([
    (0, common_1.Get)('payslips'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('month')),
    __param(2, (0, common_1.Query)('year')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Number]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "getPayslips", null);
__decorate([
    (0, common_1.Put)('payslips/finalize-all'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "batchFinalizePayslips", null);
__decorate([
    (0, common_1.Put)('payslips/mark-paid'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "markPayslipsPaid", null);
__decorate([
    (0, common_1.Put)('payslips/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "updatePayslip", null);
__decorate([
    (0, common_1.Post)('expenses'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "createExpenseClaim", null);
__decorate([
    (0, common_1.Get)('expenses/me'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "getMyExpenseClaims", null);
__decorate([
    (0, common_1.Get)('expenses'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "getAllExpenseClaims", null);
__decorate([
    (0, common_1.Put)('expenses/:id/status'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "updateExpenseClaimStatus", null);
__decorate([
    (0, common_1.Delete)('expenses/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], PayrollController.prototype, "deleteExpenseClaim", null);
exports.PayrollController = PayrollController = __decorate([
    (0, common_1.Controller)('payroll'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [payroll_service_1.PayrollService])
], PayrollController);
//# sourceMappingURL=payroll.controller.js.map