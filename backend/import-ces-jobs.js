"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var adapter_pg_1 = require("@prisma/adapter-pg");
var pg_1 = require("pg");
var dotenv = __importStar(require("dotenv"));
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var axios_1 = __importDefault(require("axios"));
var form_data_1 = __importDefault(require("form-data"));
dotenv.config();
var pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
var adapter = new adapter_pg_1.PrismaPg(pool);
var prisma = new client_1.PrismaClient({ adapter: adapter });
function getArg(name) {
    var idx = process.argv.indexOf("--".concat(name));
    return idx !== -1 ? process.argv[idx + 1] : undefined;
}
var FILE = getArg('file');
var COMPANY_ID = parseInt(getArg('company-id') || '1', 10);
var PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY;
function parseDate(str) {
    if (!str || str.toLowerCase() === 'no end date')
        return null;
    // Format: DD-MM-YYYY
    var parts = str.split('-');
    if (parts.length === 3) {
        return new Date("".concat(parts[2], "-").concat(parts[1], "-").concat(parts[0], "T00:00:00Z"));
    }
    return null;
}
function parseCtc(str) {
    if (str === null || str === undefined || str === '')
        return null;
    if (typeof str === 'number')
        return str;
    var numStr = String(str).replace(/[^0-9.-]+/g, '');
    var val = parseFloat(numStr);
    return isNaN(val) ? null : val;
}
function mapStatus(status) {
    var s = (status || '').toLowerCase();
    if (s.includes('rejected'))
        return 'REJECTED';
    if (s.includes('hired'))
        return 'HIRED';
    if (s.includes('interview'))
        return 'INTERVIEWING';
    if (s.includes('shortlist'))
        return 'SHORTLISTED';
    if (s.includes('offered'))
        return 'OFFERED';
    return 'NEW';
}
function uploadToImageKit(pdfUrl, candidateName) {
    return __awaiter(this, void 0, void 0, function () {
        var dl, buffer, form, response, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!PRIVATE_KEY) {
                        console.warn('No IMAGEKIT_PRIVATE_KEY, skipping upload');
                        return [2 /*return*/, pdfUrl];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    console.log("Downloading PDF from ".concat(pdfUrl, "..."));
                    return [4 /*yield*/, axios_1.default.get(pdfUrl, { responseType: 'arraybuffer' })];
                case 2:
                    dl = _a.sent();
                    buffer = dl.data;
                    console.log("Uploading to ImageKit for ".concat(candidateName, "..."));
                    form = new form_data_1.default();
                    form.append('file', buffer, 'resume.pdf');
                    form.append('fileName', "".concat(candidateName.replace(/[^a-zA-Z0-9]/g, '_'), "_resume.pdf"));
                    form.append('folder', '/resumes');
                    return [4 /*yield*/, axios_1.default.post('https://upload.imagekit.io/api/v1/files/upload', form, {
                            auth: { username: PRIVATE_KEY, password: '' },
                            headers: form.getHeaders(),
                        })];
                case 3:
                    response = _a.sent();
                    return [2 /*return*/, response.data.url];
                case 4:
                    error_1 = _a.sent();
                    console.error("Failed to migrate resume for ".concat(candidateName, ":"), error_1.message);
                    return [2 /*return*/, pdfUrl]; // fallback to original
                case 5: return [2 /*return*/];
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var rawData, jobsData, departments, designations, employees, _loop_1, _i, jobsData_1, job;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!FILE) {
                        console.error('Usage: ts-node import-ces-jobs.ts --file path/to/jobs_full.json');
                        process.exit(1);
                    }
                    rawData = fs.readFileSync(path.resolve(FILE), 'utf-8');
                    jobsData = JSON.parse(rawData);
                    console.log("Loaded ".concat(jobsData.length, " jobs to import."));
                    return [4 /*yield*/, prisma.department.findMany({ where: { companyId: COMPANY_ID } })];
                case 1:
                    departments = _a.sent();
                    return [4 /*yield*/, prisma.designation.findMany({ where: { companyId: COMPANY_ID } })];
                case 2:
                    designations = _a.sent();
                    return [4 /*yield*/, prisma.employee.findMany({ include: { user: true } })];
                case 3:
                    employees = _a.sent();
                    _loop_1 = function (job) {
                        var deptId, found, desigId, found, recruiterId, rec_1, found, jobTitle, dbJob, jobData, candidates, _b, candidates_1, cand, resumeUrl, existingApp_1, appData, existingApp;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    console.log("Processing Job: ".concat(job.title_raw));
                                    deptId = null;
                                    if (job.department) {
                                        found = departments.find(function (d) { return d.name.toLowerCase() === job.department.toLowerCase(); });
                                        if (found)
                                            deptId = found.id;
                                    }
                                    desigId = null;
                                    if (job.category) {
                                        found = designations.find(function (d) { return d.name.toLowerCase() === job.category.toLowerCase(); });
                                        if (found)
                                            desigId = found.id;
                                    }
                                    recruiterId = null;
                                    if (job.recruiter) {
                                        rec_1 = job.recruiter.replace(/Mr |Miss |Mrs /i, '').trim();
                                        found = employees.find(function (e) { return "".concat(e.firstName, " ").concat(e.lastName).toLowerCase().includes(rec_1.toLowerCase()); });
                                        if (found)
                                            recruiterId = found.id;
                                    }
                                    jobTitle = job.title_raw || 'Untitled Job';
                                    return [4 /*yield*/, prisma.job.findFirst({
                                            where: { title: jobTitle, companyId: COMPANY_ID }
                                        })];
                                case 1:
                                    dbJob = _c.sent();
                                    jobData = {
                                        title: jobTitle,
                                        companyId: COMPANY_ID,
                                        departmentId: deptId,
                                        designationId: desigId,
                                        recruiterId: recruiterId,
                                        experienceYears: job.work_experience,
                                        type: job.job_type || 'Full-time',
                                        status: (job.status || '').toLowerCase() === 'open' ? 'Open' : 'Closed',
                                        minSalary: parseCtc(job.minimum_salary_amount),
                                        descriptionHtml: job.description,
                                        startDate: parseDate(job.start_date),
                                        endDate: parseDate(job.end_date),
                                        totalOpenings: parseInt(job.total_openings) || 1,
                                    };
                                    if (!dbJob) return [3 /*break*/, 3];
                                    return [4 /*yield*/, prisma.job.update({ where: { id: dbJob.id }, data: jobData })];
                                case 2:
                                    dbJob = _c.sent();
                                    return [3 /*break*/, 5];
                                case 3: return [4 /*yield*/, prisma.job.create({ data: jobData })];
                                case 4:
                                    dbJob = _c.sent();
                                    _c.label = 5;
                                case 5:
                                    candidates = job.candidates || [];
                                    _b = 0, candidates_1 = candidates;
                                    _c.label = 6;
                                case 6:
                                    if (!(_b < candidates_1.length)) return [3 /*break*/, 16];
                                    cand = candidates_1[_b];
                                    console.log("  Processing Applicant: ".concat(cand.full_name));
                                    resumeUrl = cand.resume_url;
                                    if (!resumeUrl) return [3 /*break*/, 10];
                                    return [4 /*yield*/, prisma.jobApplication.findFirst({
                                            where: { jobId: dbJob.id, email: cand.email || cand.applicant_email || '' }
                                        })];
                                case 7:
                                    existingApp_1 = _c.sent();
                                    if (!(!existingApp_1 || !existingApp_1.resumeUrl || existingApp_1.resumeUrl.includes('cloudfront'))) return [3 /*break*/, 9];
                                    return [4 /*yield*/, uploadToImageKit(resumeUrl, cand.full_name || 'unknown')];
                                case 8:
                                    resumeUrl = _c.sent();
                                    return [3 /*break*/, 10];
                                case 9:
                                    resumeUrl = existingApp_1.resumeUrl; // keep the existing imagekit url
                                    _c.label = 10;
                                case 10:
                                    appData = {
                                        jobId: dbJob.id,
                                        companyId: COMPANY_ID,
                                        fullName: cand.full_name || 'Unknown',
                                        email: cand.email || cand.applicant_email || "unknown-".concat(cand.application_id, "@example.com"),
                                        phone: cand.phone || cand.applicant_phone || '',
                                        resumeUrl: resumeUrl,
                                        experienceYears: cand.total_experience,
                                        noticePeriod: cand.notice_period,
                                        currentLocation: cand.current_location,
                                        currentCtc: parseCtc(cand.current_ctc),
                                        expectedCtc: parseCtc(cand.expected_ctc),
                                        gender: cand.gender,
                                        status: mapStatus(cand.current_status),
                                        rejectionReason: cand.reject_reason,
                                        answers: cand.remark,
                                        dateOfBirth: parseDate(cand.date_of_birth),
                                        coverLetter: cand.cover_letter,
                                    };
                                    return [4 /*yield*/, prisma.jobApplication.findFirst({
                                            where: { jobId: dbJob.id, email: appData.email }
                                        })];
                                case 11:
                                    existingApp = _c.sent();
                                    if (!existingApp) return [3 /*break*/, 13];
                                    return [4 /*yield*/, prisma.jobApplication.update({ where: { id: existingApp.id }, data: appData })];
                                case 12:
                                    _c.sent();
                                    return [3 /*break*/, 15];
                                case 13: return [4 /*yield*/, prisma.jobApplication.create({ data: appData })];
                                case 14:
                                    _c.sent();
                                    _c.label = 15;
                                case 15:
                                    _b++;
                                    return [3 /*break*/, 6];
                                case 16: return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, jobsData_1 = jobsData;
                    _a.label = 4;
                case 4:
                    if (!(_i < jobsData_1.length)) return [3 /*break*/, 7];
                    job = jobsData_1[_i];
                    return [5 /*yield**/, _loop_1(job)];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6:
                    _i++;
                    return [3 /*break*/, 4];
                case 7:
                    console.log('Import complete.');
                    process.exit(0);
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(console.error);
