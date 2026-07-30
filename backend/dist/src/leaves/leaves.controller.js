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
exports.LeavesController = void 0;
const common_1 = require("@nestjs/common");
const leaves_service_1 = require("./leaves.service");
const auth_guard_1 = require("../auth/auth.guard");
let LeavesController = class LeavesController {
    leavesService;
    constructor(leavesService) {
        this.leavesService = leavesService;
    }
    assignBalance(req, data) {
        return this.leavesService.assignLeaveBalance(data);
    }
    getMyBalances(req, year) {
        const y = year ? parseInt(year) : new Date().getFullYear();
        return this.leavesService.getMyBalances(req.user.sub, y);
    }
    getAllBalances(req, year) {
        const y = year ? parseInt(year) : new Date().getFullYear();
        return this.leavesService.getAllBalances(req.user.companyId, y);
    }
    requestLeave(req, data) {
        return this.leavesService.requestLeave(req.user.sub, data);
    }
    getMyRequests(req) {
        return this.leavesService.getMyRequests(req.user.sub);
    }
    getRequests(req, filter) {
        return this.leavesService.getRequests(req.user.companyId, filter);
    }
    updateRequest(req, id, data) {
        return this.leavesService.updateRequest(req.user.sub, id, data);
    }
    cancelRequest(req, id) {
        return this.leavesService.cancelRequest(req.user.sub, id);
    }
    updateRequestStatus(req, id, data) {
        return this.leavesService.updateRequestStatus(req.user.sub, id, data.status, data.rejectionReason);
    }
};
exports.LeavesController = LeavesController;
__decorate([
    (0, common_1.Post)('assign-balance'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "assignBalance", null);
__decorate([
    (0, common_1.Get)('balances/me'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('year')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "getMyBalances", null);
__decorate([
    (0, common_1.Get)('balances'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('year')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "getAllBalances", null);
__decorate([
    (0, common_1.Post)('request'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "requestLeave", null);
__decorate([
    (0, common_1.Get)('requests/me'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "getMyRequests", null);
__decorate([
    (0, common_1.Get)('requests'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "getRequests", null);
__decorate([
    (0, common_1.Put)('requests/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "updateRequest", null);
__decorate([
    (0, common_1.Put)('requests/:id/cancel'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "cancelRequest", null);
__decorate([
    (0, common_1.Put)('requests/:id/status'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", void 0)
], LeavesController.prototype, "updateRequestStatus", null);
exports.LeavesController = LeavesController = __decorate([
    (0, common_1.Controller)('leaves'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [leaves_service_1.LeavesService])
], LeavesController);
//# sourceMappingURL=leaves.controller.js.map