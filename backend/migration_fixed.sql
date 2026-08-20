-- Base Tables (No Dependencies)
CREATE TABLE IF NOT EXISTS "Company" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domain" TEXT UNIQUE,
    "logoUrl" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "timezone" TEXT,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "kioskEnabled" BOOLEAN NOT NULL DEFAULT false,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS "User" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "companyId" INTEGER NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "VerificationToken" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationToken_identifier_token_key" UNIQUE("identifier", "token")
);

CREATE TABLE IF NOT EXISTS "RolePermission" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RolePermission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "RolePermission_role_module_action_companyId_key" UNIQUE("role", "module", "action", "companyId")
);

CREATE TABLE IF NOT EXISTS "Department" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Designation" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "departmentId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "canEditProfiles" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Designation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL,
    CONSTRAINT "Designation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Branch" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '18:00',
    "weeklyOffs" TEXT NOT NULL DEFAULT '0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" INTEGER NOT NULL,
    "geofenceRadius" INTEGER DEFAULT 500,
    "allowedIps" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Shift" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "bufferTimeMinutes" INTEGER NOT NULL DEFAULT 15,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Shift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ShiftRotation" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rotationType" TEXT NOT NULL DEFAULT 'WEEKLY',
    "shiftIds" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShiftRotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Employee" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "departmentId" INTEGER,
    "designationId" INTEGER,
    "phone" TEXT,
    "userId" INTEGER NOT NULL UNIQUE,
    "companyId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "managerId" INTEGER,
    "shiftId" INTEGER,
    "isProjectManager" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "kioskPin" TEXT,
    "salutation" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "language" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "slackId" TEXT,
    "maritalStatus" TEXT,
    "address" TEXT,
    "about" TEXT,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "ifscCode" TEXT,
    "placeOfBirthCity" TEXT,
    "placeOfBirthCountry" TEXT,
    "nationality" TEXT,
    "identificationNo" TEXT,
    "passportNo" TEXT,
    "visaNo" TEXT,
    "workPermitNo" TEXT,
    "zipCode" TEXT,
    "homeWorkDistanceKm" DOUBLE PRECISION,
    "spouseName" TEXT,
    "spouseBirthdate" TIMESTAMP(3),
    "childrenCount" INTEGER,
    "educationLevel" TEXT,
    "fieldOfStudy" TEXT,
    "avatarUrl" TEXT,
    "themePref" TEXT DEFAULT 'system',
    "currency" TEXT DEFAULT 'USD',
    "usualWorkLocation" JSONB,
    "workNotes" TEXT,
    "nextAppraisalDate" TIMESTAMP(3),
    "offboardingStatus" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL,
    CONSTRAINT "Employee_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation" ("id") ON DELETE SET NULL,
    CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Employee_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL,
    CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee" ("id") ON DELETE SET NULL,
    CONSTRAINT "Employee_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL
);

-- Employee Related Tables
CREATE TABLE IF NOT EXISTS "EmergencyContact" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmergencyContact_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeeDocument" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "documentType" TEXT DEFAULT 'Other',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeeOnboardingTask" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeOnboardingTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeeSkill" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeeResume" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "description" TEXT,
    "attachmentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeResume_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "OnboardingTemplate" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnboardingTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

-- Attendance & Leave Tables
CREATE TABLE IF NOT EXISTS "Holiday" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "LeaveType" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultDays" INTEGER NOT NULL DEFAULT 0,
    "accrualFrequency" TEXT,
    "accrualAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "allowHalfDay" BOOLEAN NOT NULL DEFAULT true,
    "carryForward" BOOLEAN NOT NULL DEFAULT false,
    "carryForwardLimit" INTEGER NOT NULL DEFAULT 0,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "LeaveBalance" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "allocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "used" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carriedOver" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id") ON DELETE CASCADE,
    CONSTRAINT "LeaveBalance_employeeId_leaveTypeId_year_key" UNIQUE("employeeId", "leaveTypeId", "year")
);

CREATE TABLE IF NOT EXISTS "LeaveRequest" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "leaveTypeId" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "halfDayPeriod" TEXT,
    "reason" TEXT,
    "attachmentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id") ON DELETE CASCADE,
    CONSTRAINT "LeaveRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "Attendance" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "clockIn" TIMESTAMP(3),
    "clockOut" TIMESTAMP(3),
    "clockInLat" DOUBLE PRECISION,
    "clockInLng" DOUBLE PRECISION,
    "clockOutLat" DOUBLE PRECISION,
    "clockOutLng" DOUBLE PRECISION,
    "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "isEarlyLeave" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "Attendance_employeeId_date_key" UNIQUE("employeeId", "date")
);

CREATE TABLE IF NOT EXISTS "AttendanceLog" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "attendanceId" INTEGER NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "clockInLat" DOUBLE PRECISION,
    "clockInLng" DOUBLE PRECISION,
    "clockOutLat" DOUBLE PRECISION,
    "clockOutLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceLog_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AttendanceRegularization" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "proposedClockIn" TIMESTAMP(3),
    "proposedClockOut" TIMESTAMP(3),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceRegularization_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "AttendanceRegularization_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL
);

-- Payroll Tables
CREATE TABLE IF NOT EXISTS "SalaryComponent" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "isPreDefined" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryComponent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "SalaryStructure" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "componentId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "SalaryStructure_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "SalaryComponent" ("id") ON DELETE CASCADE,
    CONSTRAINT "SalaryStructure_employeeId_componentId_key" UNIQUE("employeeId", "componentId")
);

CREATE TABLE IF NOT EXISTS "Payslip" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "workingDays" INTEGER NOT NULL DEFAULT 30,
    "presentDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "absentDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "halfDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalDeductions" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lossOfPay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expenseAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "netPay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paidOn" TIMESTAMP(3),
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "Payslip_employeeId_month_year_key" UNIQUE("employeeId", "month", "year")
);

CREATE TABLE IF NOT EXISTS "PayslipItem" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "payslipId" INTEGER NOT NULL,
    "componentName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayslipItem_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayrollSetting" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "companyId" INTEGER NOT NULL UNIQUE,
    "basicPercent" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "hraPercent" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "pfPercent" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "gratuityPercent" DOUBLE PRECISION NOT NULL DEFAULT 4.81,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PayrollSetting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExpenseClaim" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "receiptUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "approvedById" INTEGER,
    "companyId" INTEGER NOT NULL,
    "month" INTEGER,
    "year" INTEGER,
    "purchaseDate" TIMESTAMP(3),
    "purchasedFrom" TEXT,
    "projectId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExpenseClaim_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "ExpenseClaim_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL,
    CONSTRAINT "ExpenseClaim_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

-- Assets Tables
CREATE TABLE IF NOT EXISTS "Asset" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "assetTag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'LAPTOP',
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "cost" DOUBLE PRECISION,
    "warrantyExpiry" TIMESTAMP(3),
    "images" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AssetAssignment" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "assetId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "assignedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnDate" TIMESTAMP(3),
    "conditionOnAssign" TEXT,
    "conditionOnReturn" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE,
    CONSTRAINT "AssetAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "AssetAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "HardwareRequest" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "requestType" TEXT NOT NULL DEFAULT 'NEW_DEVICE',
    "category" TEXT NOT NULL DEFAULT 'LAPTOP',
    "urgency" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT NOT NULL,
    "images" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "fulfilledAssetId" INTEGER,
    "approvedById" INTEGER,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HardwareRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "HardwareRequest_fulfilledAssetId_fkey" FOREIGN KEY ("fulfilledAssetId") REFERENCES "Asset" ("id") ON DELETE SET NULL,
    CONSTRAINT "HardwareRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL,
    CONSTRAINT "HardwareRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

-- Appreciation Tables
CREATE TABLE IF NOT EXISTS "AwardType" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'trophy',
    "color" TEXT NOT NULL DEFAULT 'orange',
    "status" BOOLEAN NOT NULL DEFAULT true,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AwardType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Appreciation" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "awardTypeId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "givenDate" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "photoUrl" TEXT,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Appreciation_awardTypeId_fkey" FOREIGN KEY ("awardTypeId") REFERENCES "AwardType" ("id") ON DELETE CASCADE,
    CONSTRAINT "Appreciation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "Appreciation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

-- Recruitment Tables
CREATE TABLE IF NOT EXISTS "Job" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "departmentId" INTEGER,
    "designationId" INTEGER,
    "branchId" INTEGER,
    "experienceYears" TEXT,
    "type" TEXT NOT NULL DEFAULT 'Full-time',
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "minSalary" DOUBLE PRECISION,
    "maxSalary" DOUBLE PRECISION,
    "discloseSalary" BOOLEAN NOT NULL DEFAULT false,
    "descriptionHtml" TEXT,
    "screeningQuestions" TEXT,
    "companyId" INTEGER NOT NULL,
    "postedDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "totalOpenings" INTEGER NOT NULL DEFAULT 1,
    "recruiterId" INTEGER,
    "workLocationType" TEXT NOT NULL DEFAULT 'On-site',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Job_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL,
    CONSTRAINT "Job_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation" ("id") ON DELETE SET NULL,
    CONSTRAINT "Job_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE SET NULL,
    CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Job_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "Employee" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "JobApplication" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "jobId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "resumeUrl" TEXT,
    "linkedinUrl" TEXT,
    "portfolioUrl" TEXT,
    "experienceYears" TEXT,
    "noticePeriod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "offeredSalary" DOUBLE PRECISION,
    "approvalStatus" TEXT DEFAULT 'APPROVED',
    "answers" TEXT,
    "aiScore" INTEGER,
    "aiSummary" TEXT,
    "isAiScored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobApplication_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE,
    CONSTRAINT "JobApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "JobApplication_jobId_email_key" UNIQUE("jobId", "email")
);

CREATE TABLE IF NOT EXISTS "Interview" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "applicationId" INTEGER NOT NULL,
    "interviewerId" INTEGER,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL DEFAULT 30,
    "locationUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "rating" INTEGER,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "JobApplication" ("id") ON DELETE CASCADE,
    CONSTRAINT "Interview_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "Employee" ("id") ON DELETE SET NULL
);

-- CRM & Sales Tables
CREATE TABLE IF NOT EXISTS "Client" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "industry" TEXT,
    "website" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentTerms" TEXT DEFAULT 'Net 30',
    "taxId" TEXT,
    "registrationNo" TEXT,
    "defaultHourlyRate" DOUBLE PRECISION,
    "creditLimit" DOUBLE PRECISION,
    "outstandingBalance" DOUBLE PRECISION DEFAULT 0.0,
    "billingAddressLine1" TEXT,
    "billingAddressLine2" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingZipCode" TEXT,
    "billingCountry" TEXT,
    "shippingSameAsBilling" BOOLEAN NOT NULL DEFAULT true,
    "shippingAddressLine1" TEXT,
    "shippingCity" TEXT,
    "shippingState" TEXT,
    "shippingZipCode" TEXT,
    "shippingCountry" TEXT,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Client_name_companyId_key" UNIQUE("name", "companyId")
);

CREATE TABLE IF NOT EXISTS "ClientContact" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "mobile" TEXT,
    "jobTitle" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isBilling" BOOLEAN NOT NULL DEFAULT false,
    "clientId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
    CONSTRAINT "ClientContact_email_clientId_key" UNIQUE("email", "clientId")
);

CREATE TABLE IF NOT EXISTS "Lead" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "companyName" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "value" DOUBLE PRECISION,
    "currency" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "assignedToId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "clientId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "Employee" ("id") ON DELETE SET NULL,
    CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Lead_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "Quotation" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "quoteNumber" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "leadId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
    "approvedById" INTEGER,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quotation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
    CONSTRAINT "Quotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE SET NULL,
    CONSTRAINT "Quotation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL,
    CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "QuotationItem" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "quotationId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "SalesOrder" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "quotationId" INTEGER,
    "clientId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isRental" BOOLEAN NOT NULL DEFAULT false,
    "rentalStartDate" TIMESTAMP(3),
    "rentalEndDate" TIMESTAMP(3),
    "rentalStatus" TEXT,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE SET NULL,
    CONSTRAINT "SalesOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
    CONSTRAINT "SalesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "SalesOrderItem" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "salesOrderId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "isRentalItem" BOOLEAN NOT NULL DEFAULT false,
    "returnedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE
);

-- Project Management Tables
CREATE TABLE IF NOT EXISTS "Project" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "icon" TEXT NOT NULL DEFAULT 'folder',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "leadId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "clientId" INTEGER,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "billingType" TEXT NOT NULL DEFAULT 'NON_BILLABLE',
    "budgetAmount" DOUBLE PRECISION,
    "hourlyRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "onboardingStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    CONSTRAINT "Project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Employee" ("id"),
    CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL,
    CONSTRAINT "Project_key_companyId_key" UNIQUE("key", "companyId")
);

CREATE TABLE IF NOT EXISTS "ProjectDocument" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "projectId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileId" TEXT,
    "type" TEXT NOT NULL,
    "rawText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE,
    CONSTRAINT "ProjectDocument_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "Employee" ("id")
);

CREATE TABLE IF NOT EXISTS "ProjectAnalysisRun" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "projectId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "aiModel" TEXT NOT NULL DEFAULT 'llama3-70b-8192',
    "promptVersion" TEXT,
    "documentsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "processingDuration" INTEGER,
    "overallConfidence" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "totalCost" DOUBLE PRECISION,
    "costCurrency" TEXT,
    "costBreakdown" JSONB,
    "costTotalMismatch" BOOLEAN,
    "estimatedRevenue" DOUBLE PRECISION,
    "estimatedMarginPct" DOUBLE PRECISION,
    "marginDisplay" TEXT,
    "readinessScore" INTEGER,
    "healthStatus" TEXT,
    "healthBreakdown" JSONB,
    "validationWarnings" JSONB,
    "isReadyForKickoff" BOOLEAN,
    "kickoffBlockers" JSONB,
    "resourceConstraints" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectAnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectSummary" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "executiveSummary" TEXT NOT NULL,
    "businessObjective" TEXT NOT NULL,
    "projectGoals" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "projectComplexity" TEXT NOT NULL,
    "projectPriority" TEXT NOT NULL,
    "successCriteria" TEXT NOT NULL,
    CONSTRAINT "ProjectSummary_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectScope" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "inScope" TEXT NOT NULL,
    "outOfScope" TEXT NOT NULL,
    "deliverables" TEXT NOT NULL,
    "features" TEXT NOT NULL,
    "acceptanceCriteria" TEXT NOT NULL,
    "scopeConfidence" DOUBLE PRECISION,
    "scopeGaps" TEXT,
    CONSTRAINT "ProjectScope_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectRequirement" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "sourceDocument" TEXT,
    "sourceReference" TEXT,
    "acceptanceCriteria" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    "duplicateInfo" TEXT,
    "type" TEXT NOT NULL DEFAULT 'EXTRACTED',
    CONSTRAINT "ProjectRequirement_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectWbsTask" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "wbsId" TEXT,
    "phase" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "subtask" TEXT,
    "description" TEXT,
    "estimatedEffort" DOUBLE PRECISION,
    "quantity" INTEGER,
    "engineer" TEXT,
    "workingDays" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endDate" TIMESTAMP(3),
    "endTime" TEXT,
    "sourceReference" TEXT,
    "remarks" TEXT,
    "dependencies" TEXT,
    "requiredSkill" TEXT,
    "requiredLevel" TEXT,
    "priority" TEXT NOT NULL,
    CONSTRAINT "ProjectWbsTask_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectResourcePlan" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "seniority" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "allocationPercent" INTEGER NOT NULL DEFAULT 100,
    "estimatedHours" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "requiredSkills" TEXT,
    "responsibilities" TEXT,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "type" TEXT NOT NULL DEFAULT 'AI_ESTIMATED',
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    CONSTRAINT "ProjectResourcePlan_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectCostEstimate" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "resourceCost" DOUBLE PRECISION,
    "infrastructureCost" DOUBLE PRECISION,
    "vendorCost" DOUBLE PRECISION,
    "licenseCost" DOUBLE PRECISION,
    "otherCost" DOUBLE PRECISION,
    "contingency" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "estimatedRevenue" DOUBLE PRECISION,
    "estimatedProfit" DOUBLE PRECISION,
    "estimatedMargin" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "confidence" DOUBLE PRECISION,
    "type" TEXT NOT NULL DEFAULT 'AI_ESTIMATED',
    CONSTRAINT "ProjectCostEstimate_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectRoadmap" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "startDate" TIMESTAMP(3),
    "completionDate" TIMESTAMP(3),
    "estimatedDuration" INTEGER,
    "phases" TEXT NOT NULL,
    "criticalPath" TEXT,
    "scheduleConfidence" DOUBLE PRECISION,
    CONSTRAINT "ProjectRoadmap_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectMilestone" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "deliverables" TEXT,
    "dependencies" TEXT,
    "responsibleRole" TEXT,
    "approvalReq" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    CONSTRAINT "ProjectMilestone_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectRisk" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "risk" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "probability" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "riskScore" DOUBLE PRECISION,
    "mitigation" TEXT,
    "contingency" TEXT,
    "owner" TEXT,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    CONSTRAINT "ProjectRisk_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectDependency" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "dependency" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "dependentTask" TEXT,
    "internalExternal" TEXT NOT NULL,
    "owner" TEXT,
    "dueDate" TIMESTAMP(3),
    "impact" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    CONSTRAINT "ProjectDependency_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectAssumption" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "assumption" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "impactIfIncorrect" TEXT,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    CONSTRAINT "ProjectAssumption_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectStakeholder" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "stakeholder" TEXT NOT NULL,
    "organization" TEXT,
    "role" TEXT,
    "influence" TEXT,
    "interest" TEXT,
    "responsibility" TEXT,
    "communicationReq" TEXT,
    "approvalAuthority" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProjectStakeholder_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectRaci" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "projectArea" TEXT NOT NULL,
    "responsible" TEXT,
    "accountable" TEXT,
    "consulted" TEXT,
    "informed" TEXT,
    CONSTRAINT "ProjectRaci_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectOpenQuestion" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "category" TEXT,
    "importance" TEXT,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "suggestedAnswer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    CONSTRAINT "ProjectOpenQuestion_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectMissingInfo" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "missingItem" TEXT NOT NULL,
    "whyRequired" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProjectMissingInfo_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectRecommendation" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL,
    "recommendation" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    CONSTRAINT "ProjectRecommendation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectAiConfidence" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "scope" DOUBLE PRECISION,
    "requirements" DOUBLE PRECISION,
    "timeline" DOUBLE PRECISION,
    "resourcePlan" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "riskAnalysis" DOUBLE PRECISION,
    "overall" DOUBLE PRECISION,
    CONSTRAINT "ProjectAiConfidence_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectHealth" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "readinessScore" DOUBLE PRECISION,
    "scopeScore" DOUBLE PRECISION,
    "requirementScore" DOUBLE PRECISION,
    "resourceScore" DOUBLE PRECISION,
    "budgetScore" DOUBLE PRECISION,
    "timelineScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "documentationScore" DOUBLE PRECISION,
    "healthStatus" TEXT NOT NULL,
    CONSTRAINT "ProjectHealth_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectKickoffReadiness" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "analysisId" INTEGER NOT NULL UNIQUE,
    "reqsApproved" BOOLEAN NOT NULL DEFAULT false,
    "scopeApproved" BOOLEAN NOT NULL DEFAULT false,
    "budgetApproved" BOOLEAN NOT NULL DEFAULT false,
    "resourcesAvailable" BOOLEAN NOT NULL DEFAULT false,
    "timelineFeasible" BOOLEAN NOT NULL DEFAULT false,
    "stakeholdersIded" BOOLEAN NOT NULL DEFAULT false,
    "dependenciesIded" BOOLEAN NOT NULL DEFAULT false,
    "risksReviewed" BOOLEAN NOT NULL DEFAULT false,
    "docsAvailable" BOOLEAN NOT NULL DEFAULT false,
    "clientApprovals" BOOLEAN NOT NULL DEFAULT false,
    "overallStatus" TEXT NOT NULL,
    CONSTRAINT "ProjectKickoffReadiness_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ProjectAnalysisRun" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ProjectMember" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "projectId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE,
    CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "ProjectMember_projectId_employeeId_key" UNIQUE("projectId", "employeeId")
);

CREATE TABLE IF NOT EXISTS "Board" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Main Board',
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "BoardColumn" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TODO',
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "position" INTEGER NOT NULL,
    "boardId" INTEGER NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "BoardColumn_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board" ("id") ON DELETE CASCADE,
    CONSTRAINT "BoardColumn_boardId_position_key" UNIQUE("boardId", "position")
);

CREATE TABLE IF NOT EXISTS "Issue" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TASK',
    "status" TEXT NOT NULL DEFAULT 'TODO',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "storyPoints" INTEGER,
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "estimatedHours" DOUBLE PRECISION,
    "recurring" TEXT,
    "dueReminder" TEXT,
    "coverUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "workStartedAt" TIMESTAMP(3),
    "workCompletedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "projectId" INTEGER NOT NULL,
    "columnId" INTEGER,
    "assigneeId" INTEGER,
    "reporterId" INTEGER,
    "parentId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE,
    CONSTRAINT "Issue_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "BoardColumn" ("id") ON DELETE SET NULL,
    CONSTRAINT "Issue_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Employee" ("id") ON DELETE SET NULL,
    CONSTRAINT "Issue_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Employee" ("id") ON DELETE SET NULL,
    CONSTRAINT "Issue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Issue" ("id") ON DELETE SET NULL,
    CONSTRAINT "Issue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Issue_key_companyId_key" UNIQUE("key", "companyId")
);

CREATE TABLE IF NOT EXISTS "IssueReminder" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "issueId" INTEGER NOT NULL,
    "threshold" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueReminder_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueReminder_issueId_threshold_key" UNIQUE("issueId", "threshold")
);

CREATE TABLE IF NOT EXISTS "IssueTimeLog" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "issueId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMin" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueTimeLog_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueTimeLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "IssueComment" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "body" TEXT NOT NULL,
    "issueId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "IssueAttachment" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "fileType" TEXT NOT NULL DEFAULT 'FILE',
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "issueId" INTEGER NOT NULL,
    "uploadedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueAttachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueAttachment_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Label" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "projectId" INTEGER NOT NULL,
    CONSTRAINT "Label_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "IssueLabel" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "issueId" INTEGER NOT NULL,
    "labelId" INTEGER NOT NULL,
    CONSTRAINT "IssueLabel_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueLabel_issueId_labelId_key" UNIQUE("issueId", "labelId")
);

CREATE TABLE IF NOT EXISTS "IssueActivity" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "issueId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueActivity_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Checklist" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "issueId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Checklist_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ChecklistItem" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "checklistId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "IssueMember" (
    "issueId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssueMember_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "IssueMember_issueId_employeeId_pk" PRIMARY KEY ("issueId", "employeeId")
);

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "linkUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

-- RBAC Tables
CREATE TABLE IF NOT EXISTS "PermissionDefinition" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "resourceType" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "action" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "AppRole" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppRole_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "UserRole" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,
    "companyId" INTEGER,
    "branchId" INTEGER,
    "departmentId" INTEGER,
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole" ("id") ON DELETE CASCADE,
    CONSTRAINT "UserRole_userId_roleId_key" UNIQUE("userId", "roleId")
);

CREATE TABLE IF NOT EXISTS "AppRolePermission" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'ALLOW',
    "condition" JSONB,
    CONSTRAINT "AppRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole" ("id") ON DELETE CASCADE,
    CONSTRAINT "AppRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "PermissionDefinition" ("id") ON DELETE CASCADE,
    CONSTRAINT "AppRolePermission_roleId_permissionId_key" UNIQUE("roleId", "permissionId")
);

CREATE TABLE IF NOT EXISTS "FeatureFlag" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "companyId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureFlag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "FeatureFlag_companyId_key_key" UNIQUE("companyId", "key")
);

CREATE TABLE IF NOT EXISTS "Menu" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "companyId" INTEGER,
    "parentId" INTEGER,
    "title" TEXT NOT NULL,
    "icon" TEXT,
    "route" TEXT,
    "externalUrl" TEXT,
    "openInNewTab" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "featureFlagKey" TEXT,
    "requiredPermId" INTEGER,
    CONSTRAINT "Menu_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Menu" ("id") ON DELETE RESTRICT,
    CONSTRAINT "Menu_requiredPermId_fkey" FOREIGN KEY ("requiredPermId") REFERENCES "PermissionDefinition" ("id")
);

CREATE TABLE IF NOT EXISTS "UserMenuBookmark" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "userId" INTEGER NOT NULL,
    "menuId" INTEGER NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "customOrder" INTEGER,
    CONSTRAINT "UserMenuBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "UserMenuBookmark_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu" ("id") ON DELETE CASCADE,
    CONSTRAINT "UserMenuBookmark_userId_menuId_key" UNIQUE("userId", "menuId")
);

CREATE TABLE IF NOT EXISTS "ApprovalWorkflow" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "companyId" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApprovalWorkflow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ApprovalStep" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "workflowId" INTEGER NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "approverType" TEXT NOT NULL,
    "roleId" INTEGER,
    "isParallel" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ApprovalStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "companyId" INTEGER NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Performance Management
CREATE TABLE IF NOT EXISTS "CompanyOKR" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "companyId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyOKR_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "OKRKeyResult" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "okrId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'units',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OKRKeyResult_okrId_fkey" FOREIGN KEY ("okrId") REFERENCES "CompanyOKR" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PerformanceGoal" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "dueDate" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "targetValue" DOUBLE PRECISION,
    "currentValue" DOUBLE PRECISION DEFAULT 0,
    "unit" TEXT,
    "okrId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceGoal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "PerformanceGoal_okrId_fkey" FOREIGN KEY ("okrId") REFERENCES "CompanyOKR" ("id") ON DELETE SET NULL,
    CONSTRAINT "PerformanceGoal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AppraisalCycle" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppraisalCycle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PerformanceReview" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "reviewerId" INTEGER,
    "cycleId" INTEGER,
    "cycleName" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MANAGER',
    "rating" INTEGER,
    "feedback" TEXT,
    "selfRating" INTEGER,
    "selfFeedback" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SELF_REVIEW',
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "PerformanceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee" ("id") ON DELETE SET NULL,
    CONSTRAINT "PerformanceReview_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "AppraisalCycle" ("id") ON DELETE SET NULL,
    CONSTRAINT "PerformanceReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AppraisalSignoff" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "reviewId" INTEGER NOT NULL,
    "signedById" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comments" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppraisalSignoff_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "PerformanceReview" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PeerFeedback" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "reviewerId" INTEGER NOT NULL,
    "cycleId" INTEGER,
    "cycleName" TEXT NOT NULL,
    "rating" INTEGER,
    "strengths" TEXT,
    "improvements" TEXT,
    "comments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PeerFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "PeerFeedback_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "PeerFeedback_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE
);

-- Offboarding
CREATE TABLE IF NOT EXISTS "Resignation" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "intendedLastWorkingDay" TIMESTAMP(3) NOT NULL,
    "approvedLastWorkingDay" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" INTEGER,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Resignation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "Resignation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "Resignation_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "ExitInterview" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 3,
    "interviewerId" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExitInterview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "ExitInterview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "ExitInterview_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "OffboardingTask" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "employeeId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "department" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "clearedById" INTEGER,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OffboardingTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
    CONSTRAINT "OffboardingTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "OffboardingTask_clearedById_fkey" FOREIGN KEY ("clearedById") REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "BlackoutDate" (
    "id" SERIAL NOT NULL PRIMARY KEY,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "departmentId" INTEGER,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlackoutDate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL,
    CONSTRAINT "BlackoutDate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE,
    CONSTRAINT "BlackoutDate_date_departmentId_companyId_key" UNIQUE("date", "departmentId", "companyId")
);
