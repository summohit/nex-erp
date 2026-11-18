import datetime as dt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.comments import Comment
import sys

OUT = sys.argv[1]
import json, os
# Optional data file (tools/mira-tracker/data.json). When given, every list below
# is replaced by its contents, so daily updates change data, never layout.
DATA_PATH = sys.argv[2] if len(sys.argv) > 2 else None
DATA = json.load(open(DATA_PATH, encoding="utf-8")) if DATA_PATH and os.path.exists(DATA_PATH) else {}
D = lambda s: dt.date.fromisoformat(s)
AS_OF = D(DATA.get("as_of", "2026-11-16"))

NAVY = "1F3A5F"; INK = "1E293B"; MUTED = "64748B"; LINE = "D9DEE7"; SOFT = "F3F5F9"
F = "Arial"
thin = Side(style="thin", color=LINE)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HDR_FILL = PatternFill("solid", fgColor=NAVY)
INPUT_FILL = PatternFill("solid", fgColor="FFF59D")
STATUS_COLORS = {
    "Done": ("E6F4EA", "1E7B34"), "Fixed": ("E6F4EA", "1E7B34"), "Live": ("E6F4EA", "1E7B34"), "Yes": ("E6F4EA", "1E7B34"),
    "In progress": ("FFF3D6", "8A5A00"), "Live – improving": ("FFF3D6", "8A5A00"), "Deploying": ("FFF3D6", "8A5A00"),
    "Pending": ("FDE7EC", "B4234A"), "Open": ("FDE7EC", "B4234A"), "Partial": ("FDE7EC", "B4234A"), "No": ("FDE7EC", "B4234A"),
    "Needs check": ("ECEFF4", "475569"), "Planned": ("ECEFF4", "475569"), "To verify": ("ECEFF4", "475569"),
}

wb = Workbook()
TEAM = ["Mohit Singh", "Saanvi Sharma", "Pritish", "Bheem"]
FEAT_ASSIGN = {
    "Unfinalise / regenerate payslips": "Pritish",
    "Full & final settlement (FNF)": "Pritish",
    "Relieving letter flow": "Bheem",
    "Double LOP for pending-leave absence": "Pritish",
    "20th / 27th attendance reminder": "Saanvi Sharma",
    "Team Timeline multi-day override": "Pritish",
    "Payslip shows LOP dates": "Saanvi Sharma",
    "'Sent' mark on payslip and offer emails": "Saanvi Sharma",
    "Card / table view for notices": "Saanvi Sharma",
    "Payroll phases 5–8": "Mohit Singh",
    "Mobile app 2.5.3 release": "Bheem",
    "E-signature on joining documents": "Bheem",
}
BUG_ASSIGN = {
    "Approval email showed": "Saanvi Sharma",
    "Deactivated person shown": "Saanvi Sharma",
    "Clock-out overwrote": "Pritish",
    "Old mobile app": "Bheem",
    "Firebase service key": "Bheem",
    "One attendance test fails": "Pritish",
    "Type errors in weekly-offs": "Saanvi Sharma",
}
ROAD_ASSIGN = {
    "Verify today's production deploy": "Saanvi Sharma",
    "Hand over hr@ces-pl.com to Arshi Badar": "Mohit Singh",
    "Rotate the Firebase service key": "Bheem",
    "Release mobile app 2.5.3": "Bheem",
    "Unfinalise / regenerate payslips": "Pritish",
    "Full & final settlement (FNF)": "Pritish",
    "Relieving letter flow with email": "Bheem",
    "Double LOP + 20th/27th reminders": "Pritish",
    "Team Timeline multi-day override": "Pritish",
    "Payslip LOP dates": "Saanvi Sharma",
    "Switch 25 people to office emails": "Saanvi Sharma",
    "Payroll phases 5–8": "Mohit Singh",
    "Timesheet approvals, kiosk selfie, e-signature": "Bheem",
}
BUG_WHO = {}
def who_bug(title):
    if title in BUG_WHO: return BUG_WHO[title]
    for k, v in BUG_ASSIGN.items():
        if title.startswith(k): return v
    return None
TEAM_DV = '"' + ",".join(TEAM) + '"'


def title(ws, text, sub, width_cols):
    ws["A1"] = text
    ws["A1"].font = Font(name=F, size=18, bold=True, color=NAVY)
    ws["A2"] = sub
    ws["A2"].font = Font(name=F, size=10, color=MUTED)
    ws.sheet_view.showGridLines = False
    ws.row_dimensions[1].height = 28

def table(ws, start_row, headers, rows, widths, status_col=None, status_list=None, date_cols=(), pct_cols=(), input_cols=()):
    for j, h in enumerate(headers, 1):
        c = ws.cell(row=start_row, column=j, value=h)
        c.font = Font(name=F, size=10, bold=True, color="FFFFFF")
        c.fill = HDR_FILL
        c.alignment = Alignment(vertical="center", wrap_text=True)
        c.border = BORDER
    ws.row_dimensions[start_row].height = 30
    for i, r in enumerate(rows, start_row + 1):
        for j, v in enumerate(r, 1):
            c = ws.cell(row=i, column=j, value=v)
            c.font = Font(name=F, size=10, color=INK)
            c.alignment = Alignment(vertical="top", wrap_text=True)
            c.border = BORDER
            if j in date_cols and v:
                c.number_format = "dd-mmm-yyyy"
            if j in pct_cols:
                c.number_format = "0%"
            if j in input_cols:
                c.fill = INPUT_FILL
        if (i - start_row) % 2 == 0:
            for j in range(1, len(headers) + 1):
                cell = ws.cell(row=i, column=j)
                if cell.fill.fgColor.rgb in (None, "00000000") and j not in input_cols:
                    cell.fill = PatternFill("solid", fgColor=SOFT)
    for j, w in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=1, column=j).column_letter].width = w
    last = start_row + len(rows)
    ws.freeze_panes = ws.cell(row=start_row + 1, column=1)
    ws.auto_filter.ref = f"A{start_row}:{ws.cell(row=last, column=len(headers)).column_letter}{last}"
    if status_col:
        col = ws.cell(row=1, column=status_col).column_letter
        rng = f"{col}{start_row+1}:{col}{max(last, start_row+1)+60}"
        for s, (bg, fg) in STATUS_COLORS.items():
            ws.conditional_formatting.add(rng, CellIsRule(operator="equal", formula=[f'"{s}"'], fill=PatternFill("solid", fgColor=bg), font=Font(name=F, bold=True, color=fg)))
        if status_list:
            dv = DataValidation(type="list", formula1='"' + ",".join(status_list) + '"', allow_blank=True)
            dv.error = "Pick a status from the list."
            ws.add_data_validation(dv)
            dv.add(rng)
    return last

# ─────────────────────────── Modules ───────────────────────────
mods = [
    ("Dashboard & Workspace", "Core", "Live", 1.00, "Role-based workspace, KPI cards, probation action card, Excel export, real data on the new (v2) dashboard.", "—", D("2026-11-11")),
    ("Employees / People Hub", "HRMS", "Live", 1.00, "Directory (search, filters, active/deactivated), 360° profiles, org chart, documents, login email change, HR login hand over.", "—", D("2026-11-16")),
    ("Self-service Onboarding", "HRMS", "Live – improving", 0.95, "Invite with temporary password, joiner fills own profile, required checklist, HR review with per-note checkboxes, document rules and waivers.", "Super Admin review steps to be tested end to end; e-signature not built.", D("2026-11-16")),
    ("Recruitment & ATS", "HRMS", "Live", 1.00, "Jobs, candidate pipeline, interviews (IST), offers with payroll annexure and tax regime, public careers page with clean links.", "—", D("2026-11-16")),
    ("Attendance", "HRMS", "Live", 0.95, "Clock in/out with office geofence and approvals, field-visit photo approval, WFC from anywhere, no clock-in on off days, shift change, Team Timeline override.", "Multi-day override, 20th/27th attendance reminder, double LOP rule not built.", D("2026-11-16")),
    ("Leave, Comp-off & WFH", "HRMS", "Live", 1.00, "Leave requests and approvals, probation rules (no paid leave, pro-rata on confirmation), comp-off balance from approved requests, permanent WFH.", "—", D("2026-11-12")),
    ("Shift Roster", "HRMS", "Live", 1.00, "Roster, bulk permanent shift change (Super Admin), Change Shift pop-up, days off follow the shift.", "—", D("2026-11-11")),
    ("Field Visits & Travel Allowance", "Operations", "Live – improving", 0.90, "Requests, approvals, reschedule/postpone, NCR per-km allowance by grade, live route sharing with Finance, outside-site photo approval.", "Photo step reaches staff only with mobile app 2.5.3.", D("2026-11-16")),
    ("Performance & Probation", "HRMS", "Live", 1.00, "Review cycles, KPIs, probation tab, manager review before HR confirms, letters, PIP & notice.", "—", D("2026-11-04")),
    ("Payroll & Compensation", "Finance", "Live – improving", 0.85, "Configurable rules engine, pay profiles (AI document check), salary groups, PF/ESI/PT/TDS, consultants with GST, LOP basis, payslips, dry run.", "Unfinalise/regenerate payslips, FNF, revisions & arrears, tax declarations, reports (plan phases 5–8).", D("2026-11-06")),
    ("Offboarding", "HRMS", "Partial", 0.70, "Resignations, manager decision, clearance by HR/Admin/Finance, exit interviews.", "Full & final settlement (FNF) and relieving-letter email flow pending.", D("2026-11-02")),
    ("Assets & IT", "Operations", "Live", 0.90, "Inventory, assignments, hardware requests (HR/admin decide), mobile screens.", "Warranty and depreciation views.", D("2026-11-02")),
    ("Projects & Tasks", "Delivery", "Live", 1.00, "Boards, issues, sprints, subprojects, locations per project, task import, timers.", "—", D("2026-10-24")),
    ("Timesheets", "Delivery", "Partial", 0.60, "Hours logged per task in My Tasks.", "Approval workflow and workload view.", D("2026-11-05")),
    ("CRM – Leads", "Revenue", "Live", 1.00, "Kanban leads, follow-ups, CSV import/export, website chat with visitor details.", "—", D("2026-11-04")),
    ("Sales – Quotes & Orders", "Revenue", "Live", 0.95, "Quotation builder with PDF, sales orders.", "Point-of-sale screen is basic.", D("2026-11-13")),
    ("Clients", "Revenue", "Live", 0.85, "Client list and profiles with permissions; mobile screens.", "Billing and invoice link.", D("2026-11-02")),
    ("Helpdesk / Tickets", "Platform", "Live", 0.95, "Tickets, comments, images, role-scoped visibility, auto-assign.", "Email/push on new ticket to confirm.", D("2026-10-22")),
    ("Notice Board", "Platform", "Live", 1.00, "Notices with attachments, email, date filter.", "—", D("2026-11-11")),
    ("Appreciation", "HRMS", "Live", 0.85, "Awards and kudos (HR/admin give awards), mobile screens.", "Leaderboard.", D("2026-11-02")),
    ("Kiosk (punch)", "Attendance", "Partial", 0.60, "Company kiosk punch screen.", "Selfie capture and device pairing.", D("2026-09-01")),
    ("Settings & Admin", "Platform", "Live", 1.00, "Master data, permissions, payroll rules, probation policy, document requirements.", "—", D("2026-11-16")),
    ("Mobile app (Android)", "Mobile", "Live – improving", 0.85, "Version 2.5.2 live on Play: attendance, leave, approvals, field visits, assets, payslips, directory.", "2.5.3: travel journeys, push (Firebase), R8, field-visit photo step — to release.", D("2026-11-16")),
    ("Public site & Careers", "Marketing", "Live", 1.00, "Landing page, careers portal (/careers), APK download.", "—", D("2026-11-16")),
]
if "modules" in DATA:
    mods = [(m["module"], m["area"], m["status"], m["pct"], m["works"], m["gaps"], D(m["updated"]) if m.get("updated") else None) for m in DATA["modules"]]
wsM = wb.active; wsM.title = "Modules"
title(wsM, "What is working — module by module", f"Status as of {AS_OF:%d %b %Y}. '% Complete' is the team's estimate from the code and open work, not a measured figure.", 7)
mod_last = table(wsM, 4, ["Module", "Area", "Status", "% Complete", "What works today", "Known gaps / pending", "Last major update"],
                 mods, [28, 12, 16, 12, 62, 46, 15], status_col=3, status_list=["Live", "Live – improving", "Partial", "Planned"], date_cols=(7,), pct_cols=(4,))
MOD_FIRST, MOD_LAST = 5, mod_last

# ─────────────────────────── Features ───────────────────────────
feats = [
    # 16 Nov
    ("2026-11-16", "Attendance", "Field visit clock-in outside the site", "Away from the approved site: photo + description required, saved as pending, Present once Super Admin approves.", "Field staff, Super Admin", "Done", "Deploying"),
    ("2026-11-16", "Onboarding", "HR notes as checkboxes", "One checkbox per HR note; Submit for review appears only when all are ticked.", "New joiners, HR", "Done", "Deploying"),
    ("2026-11-16", "Onboarding", "Profile picture required", "Photo is part of the checklist and checked on the server before submit.", "New joiners", "Done", "Deploying"),
    ("2026-11-16", "Onboarding", "Red theme for self-onboarding", "Onboarding form and embedded profile use the red brand colour.", "New joiners", "Done", "Deploying"),
    ("2026-11-16", "Employees", "Profile format checks", "IFSC, bank account, PIN, Aadhaar/ID, PF, ESI, passport, names checked on save; jumps to the field with a red message.", "Everyone, HR", "Done", "Deploying"),
    ("2026-11-16", "Employees", "Starred fields required on every profile", "Required fields marked * and enforced on save, not only during onboarding.", "Everyone, HR", "Done", "Deploying"),
    ("2026-11-16", "Documents", "Named 'Other' documents", "Choosing Other asks for the document's name, shown on the card.", "Everyone", "Done", "Deploying"),
    ("2026-11-16", "Documents", "Document requirements set by HR", "Per document: required for everyone / not interns, number of files, hint. Drives onboarding, reminder and upload lists.", "HR, Super Admin", "Done", "Deploying"),
    ("2026-11-16", "Documents", "Document waivers", "HR asks Super Admin to waive a document; approved waiver counts as uploaded; Super Admin can waive directly. Recorded who and when.", "HR, Super Admin", "Done", "Deploying"),
    ("2026-11-16", "Platform", "Arrange my menu", "Header button blurs the page; each person drags sidebar menus into their own order, saved to their profile.", "Everyone", "Done", "Deploying"),
    ("2026-11-16", "Platform", "New UI (v2) is the default", "Redesigned interface for everyone; ?ui=v1 switches back.", "Everyone", "Done", "Deploying"),
    ("2026-11-16", "Employees", "Hand over HR login", "Super Admin moves hr@ces-pl.com, its role and reportees to a new person in one step; history kept.", "Super Admin", "Done", "Deploying"),
    ("2026-11-16", "Employees", "Personal → office login email", "Super Admin/HR switch a login to @ces-pl.com; old address kept as personal email; both notified.", "Super Admin, HR", "Done", "Deploying"),
    ("2026-11-16", "Recruitment", "Clean careers links", "/careers and /careers?job=<id>; old encoded links still work.", "Candidates, HR", "Done", "Deploying"),
    ("2026-11-16", "Onboarding", "Review pop-up: photo, open profile in new tab", "Profile review shows the joiner's photo; Open profile opens a full tab.", "HR", "Done", "Deploying"),
    ("2026-11-16", "Onboarding", "Onboarding invite for existing hires", "Start self-onboarding for people added before the new flow.", "HR", "Done", "Deploying"),
    # 4–13 Nov
    ("2026-11-13", "Onboarding", "Self-service onboarding", "Joiner gets a temporary password, fills profile, submits; HR approves or sends back with notes.", "New joiners, HR", "Done", "Live"),
    ("2026-11-13", "Platform", "Responsive layout on all pages", "Every page works on phone and tablet widths.", "Everyone", "Done", "Live"),
    ("2026-11-12", "Leave", "Comp-off balance from approved requests", "Used days counted from approved, non-deleted requests, so balance, quota and history agree.", "Everyone, HR", "Done", "Live"),
    ("2026-11-12", "Attendance", "Shift change from attendance", "Change a person's shift from the attendance screens, not only the roster.", "HR, Super Admin", "Done", "Live"),
    ("2026-11-12", "Leave", "Bulk approve pending leave", "Approve many pending requests at once.", "Managers, HR", "Done", "Live"),
    ("2026-11-11", "Attendance", "No clock-in on holidays / days off / full-day leave", "Clock-in hidden with the reason shown (weekly off, holiday, leave).", "Everyone", "Done", "Live"),
    ("2026-11-11", "Attendance", "Work From Client (WFC) shift", "Clock in and out from anywhere, never marked late.", "WFC staff", "Done", "Live"),
    ("2026-11-11", "Roster", "Bulk permanent shift change", "Super Admin picks a shift and many people at once.", "Super Admin", "Done", "Live"),
    ("2026-11-11", "Payroll", "Salary edits Super Admin only", "Finance can no longer edit salary.", "Super Admin, Finance", "Done", "Live"),
    ("2026-11-11", "Notices", "Notice Board date filter", "Last week, 30 days, 60 days or custom range.", "Everyone", "Done", "Live"),
    ("2026-11-06", "Payroll", "Consultant fees with GST and custom TDS", "Fee statement wording, GST on top when registered, per-person TDS.", "Finance", "Done", "Live"),
    ("2026-11-05", "Payroll", "Mid-month joiners and paid days", "Paid from the joining date; payslips show paid days (e.g. 30.5).", "Finance, Everyone", "Done", "Live"),
    ("2026-11-05", "Attendance", "Approved regularization = full Present", "Not late, not half day, clock-out settled.", "Everyone", "Done", "Live"),
    ("2026-11-04", "Performance", "Probation flow", "Policy in settings, no paid leave on probation, pro-rata leave on confirmation, manager review, letters.", "HR, Managers", "Done", "Live"),
    ("2026-11-04", "Recruitment", "Offer letter with payroll annexure", "Annexure from the salary group, tax regime and TDS estimate, premium PDF.", "HR", "Done", "Live"),
    ("2026-11-04", "CRM", "Lead CSV import / export", "Bring in and export leads in bulk.", "Sales", "Done", "Live"),
    ("2026-11-03", "Payroll", "New payroll engine and pay profiles", "Configurable rules, versioned pay profiles, compare old vs new, dry-run payslips.", "Finance", "Done", "Live"),
    # Oct
    ("2026-10-23", "Projects", "Location-wise task tracking", "Projects get states/cities/sites; one task, an execution record per location; subprojects.", "Project managers", "Done", "Live"),
    ("2026-10-22", "CRM", "Website chat with visitor details", "Location, device, source and visits for each website chat.", "Sales", "Done", "Live"),
    ("2026-10-22", "Leave", "Permanent WFH", "HR sets permanent work-from-home; own days off still apply.", "HR", "Done", "Live"),
    ("2026-10-16", "Field Visits", "Travel allowance with live route", "NCR per-km by grade; route recorded during the journey and shared live with Finance.", "Field staff, Finance", "Done", "Live"),
    ("2026-10-16", "Employees", "Profile completion drive", "Reminder until documents and details are complete; HR report.", "Everyone, HR", "Done", "Live"),
    # Pending / planned
    ("2026-11-10", "Payroll", "Unfinalise / regenerate payslips", "Super Admin moves a finalised payslip back to draft and regenerates for selected people.", "Super Admin, Finance", "Pending", "—"),
    ("2026-11-10", "Offboarding", "Full & final settlement (FNF)", "Last salary with LOP for unworked days plus asset recovery; payment due-date rule awaited.", "Finance, HR", "Pending", "—"),
    ("2026-11-11", "Offboarding", "Relieving letter flow", "End date → approval → Finance → Assets → HR clearance → relieving letter with email button.", "HR", "Pending", "—"),
    ("2026-11-10", "Attendance", "Double LOP for pending-leave absence", "Absent while leave is still pending costs 2 days.", "Finance", "Pending", "—"),
    ("2026-11-10", "Attendance", "20th / 27th attendance reminder", "Urgent notice to fix attendance before payroll.", "Everyone", "Pending", "—"),
    ("2026-11-10", "Attendance", "Team Timeline multi-day override", "Super Admin marks Present/Absent for a date range.", "Super Admin", "Pending", "—"),
    ("2026-11-10", "Payroll", "Payslip shows LOP dates", "Show the actual dates behind LOP, half days and leave.", "Finance, Everyone", "Pending", "—"),
    ("2026-11-10", "Payroll", "'Sent' mark on payslip and offer emails", "Record when each email was sent; show Sent (date) instead of resend.", "Finance, HR", "Needs check", "—"),
    ("2026-11-11", "Notices", "Card / table view for notices", "Switch the Notice Board between cards and a table.", "Everyone", "Needs check", "—"),
    ("2026-11-03", "Payroll", "Payroll phases 5–8", "Revisions & arrears, tax declarations, offer-locked annexure, reports.", "Finance", "Planned", "—"),
    ("2026-11-16", "Mobile", "Mobile app 2.5.3 release", "Travel journeys, push notifications, R8 optimisation, field-visit photo step.", "Everyone (Android)", "In progress", "—"),
    ("2026-11-16", "Onboarding", "E-signature on joining documents", "Sign joining documents inside MIRA.", "New joiners", "Planned", "—"),
    ("2026-11-16", "Onboarding", "Test Super Admin onboarding steps", "Run waivers, send back with notes, resubmit and approve on a real joiner; record results.", "QA", "Pending", "—"),
    ("2026-11-16", "Employees", "Test login email change and HR hand over", "Check both dialogs, the emails sent and the audit log on production.", "QA", "Pending", "—"),
]
FEAT_ASSIGN["Test Super Admin onboarding steps"] = "Saanvi Sharma"
FEAT_ASSIGN["Test login email change and HR hand over"] = "Saanvi Sharma"
if "features" in DATA:
    feats = [(f["date"], f["module"], f["feature"], f["what"], f["users"], f["status"], f["release"]) for f in DATA["features"]]
    FEAT_ASSIGN = {f["feature"]: f.get("assignee") for f in DATA["features"]}
wsF = wb.create_sheet("Features")
title(wsF, "Features — what we built, what is pending", "Status: Done = built and working · In progress = being built · Pending = agreed, not started · Needs check = partly visible in code, to confirm · Planned = later.", 8)
frows = [(f"F-{i:03d}", D(d), m, n, w, u, s, r, FEAT_ASSIGN.get(n)) for i, (d, m, n, w, u, s, r) in enumerate(feats, 1)]
f_last = table(wsF, 4, ["ID", "Date", "Module", "Feature", "What it does", "Who uses it", "Status", "Release", "Assigned to"],
               frows, [8, 13, 14, 34, 62, 18, 14, 13, 16], status_col=7, status_list=["Done", "In progress", "Pending", "Needs check", "Planned"], date_cols=(2,))
dvf = DataValidation(type="list", formula1=TEAM_DV, allow_blank=True); wsF.add_data_validation(dvf); dvf.add(f"I5:I{f_last+100}")
for s, (bg, fg) in STATUS_COLORS.items():
    wsF.conditional_formatting.add(f"H5:H{f_last+60}", CellIsRule(operator="equal", formula=[f'"{s}"'], fill=PatternFill("solid", fgColor=bg), font=Font(name=F, bold=True, color=fg)))

# ─────────────────────────── Bugs ───────────────────────────
bugs = [
    ("2026-11-16", "Attendance", "Out-of-office clock-in raised no approval (Sudeep Jain)", "VIP Shift had the office location check turned off.", "Turned the check on for VIP Shift; today's clock-in sent for Super Admin approval.", "High", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-16", "Onboarding", "Approval email showed 'Temporary Password: nexerp2026'", "Old email template with a fixed password; joiners set their own.", "New welcome email with no password.", "High", "Fixed", "2026-11-16", "Pending"),
    ("2026-11-16", "Employees", "Directory search by full name found nobody", "Search matched each field separately.", "Every typed word matches anywhere (name, code, email…).", "Medium", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-16", "Employees", "Deactivated people hidden in directory", "Filter defaulted to Active while showing 'All employees'.", "Default is all employees; deactivated greyed at the bottom.", "Medium", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-16", "Employees", "Active / Deactivated filter did nothing", "Table was not refreshed after the filter changed.", "Filter refreshes the table.", "Medium", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-16", "Employees", "Deactivated person shown as 'Active' on profile", "Badge looked for status DEACTIVATED; logins are stored as SUSPENDED.", "Badge and photo dot read the real status.", "Low", "Fixed", "2026-11-16", "Pending"),
    ("2026-11-16", "Recruitment", "Careers link showed an encoded ID (/careers/MQ%3D%3D)", "Company number was put in the link.", "Plain /careers; old links redirect.", "Low", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-16", "Employees", "Save didn't jump to the field with the error", "Focus looked for an input inside the input.", "Opens the right tab, scrolls and focuses the field.", "Low", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-16", "Employees", "Error messages and borders shown in blue", "Error styles used the accent colour.", "Errors red on all profiles.", "Low", "Fixed", "2026-11-16", "Yes"),
    ("2026-11-12", "Leave", "Comp-off showed 1/2 used instead of 0/2", "Used days came from a drifting stored counter.", "Counted from approved requests.", "Medium", "Fixed", "2026-11-12", "Yes"),
    ("2026-10-24", "Projects", "Excel task import dates a day early", "Time-zone handling of Excel dates.", "Dates parsed as local dates.", "Medium", "Fixed", "2026-10-24", "Yes"),
    ("2026-10-22", "Recruitment", "Interview times scheduled in the wrong time zone", "Not stored as IST.", "Scheduling uses IST.", "Medium", "Fixed", "2026-10-22", "Yes"),
    ("2026-11-10", "Attendance", "Clock-out overwrote a late-arrival Half Day with Present", "Clock-out re-scored the day.", "To confirm against the 5 Nov regularization change; re-score October days if still present.", "High", "Needs check", None, "No"),
    ("2026-11-16", "Field Visits", "Old mobile app can't send the outside-site photo", "Photo step needs app 2.5.3.", "Release mobile 2.5.3.", "Medium", "Open", None, "No"),
    ("2026-10-16", "Security", "Firebase service key was shared in chat", "Key exposed during setup.", "Rotate the key in Firebase console and on the server.", "High", "Open", None, "No"),
    ("2026-11-16", "Quality", "One attendance test fails depending on time of day", "Test relies on the real clock.", "Freeze time in the test.", "Low", "Open", None, "No"),
    ("2026-11-16", "Quality", "Type errors in weekly-offs test file", "Test data out of date with the shift type.", "Update the test fixtures.", "Low", "Open", None, "No"),
]
if "bugs" in DATA:
    bugs = [(b["found"], b["module"], b["bug"], b["cause"], b["fix"], b["severity"], b["status"], b.get("fixed_on"), b.get("verified")) for b in DATA["bugs"]]
    BUG_WHO = {b["bug"]: b.get("assignee") for b in DATA["bugs"]}
BUG_STEPS = {b["bug"]: b.get("steps") for b in DATA.get("bugs", [])}
BUG_SHOT = {b["bug"]: b.get("screenshot") for b in DATA.get("bugs", [])}
wsB = wb.create_sheet("Bugs")
title(wsB, "Bugs — found, fixed and open", "Severity: High = wrong pay/attendance/security · Medium = blocks a task · Low = cosmetic or minor. Verified = checked by the team on the live/local app.", 11)
brows = [(f"B-{i:03d}", D(d), m, b, c, fx, sv, st, D(fd) if fd else None, v, who_bug(b), BUG_STEPS.get(b))
         for i, (d, m, b, c, fx, sv, st, fd, v) in enumerate(bugs, 1)]
b_last = table(wsB, 4, ["ID", "Found on", "Module", "Bug", "Cause", "Fix", "Severity", "Status", "Fixed on", "Verified", "Assigned to", "How to check (steps)"],
               brows, [8, 13, 13, 40, 36, 42, 11, 13, 13, 11, 16, 62], status_col=8, status_list=["Fixed", "Open", "In progress", "Needs check"], date_cols=(2, 9))
dvb = DataValidation(type="list", formula1=TEAM_DV, allow_blank=True); wsB.add_data_validation(dvb); dvb.add(f"K5:K{b_last+100}")
for i in range(5, b_last + 1):
    wsB.cell(row=i, column=12).font = Font(name=F, size=9.5, color=INK)
wsB["A3"] = "Assigned to: who fixes an open bug, or who verifies a fixed one still marked Verified = Pending."
wsB["A3"].font = Font(name=F, size=9, italic=True, color=MUTED)
sev_rng = f"G5:G{b_last+60}"
wsB.conditional_formatting.add(sev_rng, CellIsRule(operator="equal", formula=['"High"'], font=Font(name=F, bold=True, color="B4234A")))
for s, (bg, fg) in STATUS_COLORS.items():
    wsB.conditional_formatting.add(f"J5:J{b_last+60}", CellIsRule(operator="equal", formula=[f'"{s}"'], fill=PatternFill("solid", fgColor=bg), font=Font(name=F, bold=True, color=fg)))
dvv = DataValidation(type="list", formula1='"Yes,Pending,No"', allow_blank=True); wsB.add_data_validation(dvv); dvv.add(f"J5:J{b_last+60}")
dvs = DataValidation(type="list", formula1='"High,Medium,Low"', allow_blank=True); wsB.add_data_validation(dvs); dvs.add(sev_rng)

# ─────────────────────────── Roadmap ───────────────────────────
road = [
    ("P1", "Verify today's production deploy", "All", "16 Nov changes go live; check onboarding, directory, field visit, sidebar.", "Deploy finishing", "In progress"),
    ("P1", "Hand over hr@ces-pl.com to Arshi Badar", "Employees", "HR access is with a deactivated login.", "Super Admin to run Hand over", "Pending"),
    ("P1", "Rotate the Firebase service key", "Mobile / Security", "Key was exposed during setup.", "Firebase console access", "Pending"),
    ("P1", "Release mobile app 2.5.3", "Mobile", "Push, travel journeys, R8 (Play deadline Feb 2027), field-visit photo.", "Device test", "In progress"),
    ("P1", "Unfinalise / regenerate payslips", "Payroll", "Fix a finalised month without manual work.", "—", "Pending"),
    ("P1", "Full & final settlement (FNF)", "Offboarding / Payroll", "Needed for every leaver.", "FNF payment due-date rule", "Pending"),
    ("P2", "Relieving letter flow with email", "Offboarding", "Clearance chain ends in a letter.", "FNF", "Pending"),
    ("P2", "Double LOP + 20th/27th reminders", "Attendance", "Cleaner attendance before payroll.", "—", "Pending"),
    ("P2", "Team Timeline multi-day override", "Attendance", "Fix several days at once.", "—", "Pending"),
    ("P2", "Payslip LOP dates", "Payroll", "Explain deductions to employees.", "—", "Pending"),
    ("P2", "Switch 25 people to office emails", "Employees", "Logins on personal email.", "IT creates mailboxes", "Pending"),
    ("P3", "Payroll phases 5–8", "Payroll", "Arrears, tax declarations, reports.", "Finance sign-off", "Planned"),
    ("P3", "Timesheet approvals, kiosk selfie, e-signature", "Delivery / HRMS", "Close partial modules.", "—", "Planned"),
]
ROAD_TARGET = {"Verify today's production deploy": "2026-11-17"}
if "roadmap" in DATA:
    road = [(r["priority"], r["item"], r["module"], r["why"], r["waiting"], r["status"]) for r in DATA["roadmap"]]
    ROAD_ASSIGN = {r["item"]: r.get("owner") for r in DATA["roadmap"]}
    ROAD_TARGET = {r["item"]: r.get("target") for r in DATA["roadmap"]}
wsR = wb.create_sheet("Roadmap")
title(wsR, "Roadmap — what comes next", "P1 = this week · P2 = this month · P3 = later. Yellow cells (Owner, Target date) are for you to fill in.", 8)
rrows = [(p, it, m, why, dep, ROAD_ASSIGN.get(it), D(ROAD_TARGET[it]) if ROAD_TARGET.get(it) else None, st) for p, it, m, why, dep, st in road]
r_last = table(wsR, 4, ["Priority", "Item", "Module", "Why it matters", "Waiting for", "Owner", "Target date", "Status"],
               rrows, [9, 38, 18, 44, 26, 16, 14, 13], status_col=8, status_list=["Done", "In progress", "Pending", "Planned"], date_cols=(7,), input_cols=(6, 7))
for i in range(5, r_last + 1):
    wsR.cell(row=i, column=7).number_format = "dd-mmm-yyyy"
wsR.cell(row=5, column=7).comment = Comment("Example: target date filled in. Fill the other yellow Target date cells the same way.", "MIRA team")
dvr = DataValidation(type="list", formula1=TEAM_DV, allow_blank=True); wsR.add_data_validation(dvr); dvr.add(f"F5:F{r_last+100}")

# ─────────────────────────── Releases ───────────────────────────
rel = [
    ("2026-11-16", "044ee226", "Onboarding approved email without a fixed password", "—", "Deploying"),
    ("2026-11-16", "d8fbddb9", "Personal → office login email; Deactivated badge fix", "Employee.personalEmail", "Deploying"),
    ("2026-11-16", "828c6a50", "Directory search/filter fixes; HR login hand over", "—", "Deploying"),
    ("2026-11-16", "6ec7dc9f", "Arrange menu from the header", "—", "Deploying"),
    ("2026-11-16", "b2bebe52", "Field visit photo approval; sidebar arranging; v2 default", "User.menuOrder", "Deploying"),
    ("2026-11-16", "f7497437", "Onboarding documents, waivers, profile checks, careers link", "SystemSetting.documentPolicy; DocumentWaiver table", "Deploying"),
    ("2026-11-16", "3c473ffa", "Onboarding invite for existing hires, dashboard and menu fixes", "—", "Live"),
    ("2026-11-13", "—", "Self-service onboarding; responsive layout", "Onboarding fields", "Live"),
    ("2026-11-12", "—", "UI standard; leaves & roster; comp-off fix; shift change", "—", "Live"),
    ("2026-11-11", "—", "Bulk shift change, WFC, no clock-in on off days, notice filter", "—", "Live"),
    ("2026-10-16", "Android 2.5.2", "Mobile app on Google Play (current)", "—", "Live"),
]
REL_VERIFIED = {}
if "releases" in DATA:
    rel = [(r["date"], r["version"], r["what"], r["db"], r["status"]) for r in DATA["releases"]]
    REL_VERIFIED = {(r["version"], r["what"]): r.get("verified_by") for r in DATA["releases"]}
wsL = wb.create_sheet("Releases")
title(wsL, "Releases & deployments", "Web and server deploy with deploy.sh (database changes applied with prisma db push, additive only). Mobile releases go through Google Play.", 6)
lrows = [(D(d), c, w, db_, st, REL_VERIFIED.get((c, w))) for d, c, w, db_, st in rel]
l_last = table(wsL, 4, ["Date", "Version / commit", "What's included", "Database changes", "Status", "Verified by"],
               lrows, [13, 17, 58, 40, 13, 18], status_col=5, status_list=["Live", "Deploying", "Planned"], date_cols=(1,), input_cols=(6,))

# ─────────────────────────── Decisions ───────────────────────────
dec = [
    ("2026-11-16", "UI", "New interface (v2) is the default for everyone", "Approved by management; v1 kept as a fallback (?ui=v1)."),
    ("2026-11-16", "Employees", "Only Super Admin hands over hr@ces-pl.com", "Button shows only on that account."),
    ("2026-11-16", "Employees", "Super Admin and HR change login emails", "HR cannot change a Super Admin; employees cannot request it themselves."),
    ("2026-11-16", "Documents", "Required documents are set by HR / Super Admin", "No first-job vs experienced split, except 'not for interns' on UAN, Relieving letter, Payslips."),
    ("2026-11-16", "Documents", "Waivers approved by Super Admin only", "Approval recorded with name and date."),
    ("2026-11-16", "Attendance", "Field visit outside the site needs photo + reason", "Day counts as Present only after Super Admin approval."),
    ("2026-11-10", "Payroll", "FNF = last salary (LOP for unworked days) + asset recovery", "Payment due-date rule still to be decided."),
    ("2026-11-10", "Attendance", "Absence with leave still pending = 2 days LOP", "Approved or rejected leave = normal treatment."),
    ("2026-11-10", "Payroll", "Employer PF shown only in the KPI", "Not on payslips or group calculations."),
    ("2026-11-05", "Attendance", "Approved regularization = full Present", "Not late, not half day."),
    ("2026-11-04", "Leave", "Probation: 6 months, no paid leave, pro-rata on confirmation (rounded down)", "Casual 10, Sick 8; leave year Jan–Dec; HR confirms manually."),
    ("2026-11-03", "Payroll", "Every payroll rule is configurable by Finance", "No hardcoded rates or caps."),
    ("2026-10-15", "Leave", "Comp-off only for approved field visits; roster decides the day off", "—"),
]
if "decisions" in DATA:
    dec = [(d["date"], d["area"], d["decision"], d["details"]) for d in DATA["decisions"]]
wsD = wb.create_sheet("Decisions")
title(wsD, "Decisions & policies", "Rules agreed with management that the system follows. Change a rule here first, then in Settings.", 4)
drows = [(D(d), a, x, y) for d, a, x, y in dec]
table(wsD, 4, ["Date", "Area", "Decision", "Details"], drows, [13, 14, 60, 62], date_cols=(1,))

# ─────────────────────────── Open questions ───────────────────────────
oq = [
    ("Payroll", "What is the payment due date rule for full & final settlement (FNF)?", "FNF cannot be built without it.", "Management / Finance", "Open"),
    ("Employees", "When will IT create @ces-pl.com mailboxes for the 25 people on personal emails?", "Logins can be switched only after the mailbox exists.", "IT", "Open"),
    ("Employees", "When should hr@ces-pl.com move from Akshara Shukla to Arshi Badar?", "Arshi needs the HR role to approve onboarding and leave.", "Management", "Open"),
    ("Onboarding", "Confirm new joiners must upload Reference Person (and UAN, Relieving letter, Payslips if experienced).", "Rules now apply to onboarding as well as the reminder.", "HR", "Open"),
    ("Payroll", "Finance sign-off to start payroll phases 5–8.", "Sets the order of the next payroll work.", "Finance", "Open"),
    ("Mobile", "Who tests mobile 2.5.3 on a phone before release?", "Needed before Google Play submission.", "Management", "Open"),
]
Q_ANSWER = {}
if "questions" in DATA:
    oq = [(q["area"], q["question"], q["why"], q["who"], q["status"]) for q in DATA["questions"]]
    Q_ANSWER = {q["question"]: q.get("answer") for q in DATA["questions"]}
wsQ = wb.create_sheet("Open Questions")
title(wsQ, "Open questions & blockers", "Answers needed from management to keep work moving. Fill in the yellow Answer column.", 6)
qrows = [(f"Q-{i:02d}", a, q, why, who, Q_ANSWER.get(q), s) for i, (a, q, why, who, s) in enumerate(oq, 1)]
table(wsQ, 4, ["ID", "Area", "Question", "Why it matters", "Who answers", "Answer", "Status"], qrows, [7, 13, 56, 44, 20, 36, 11],
      status_col=7, status_list=["Open", "Answered"], input_cols=(6,))
STATUS_COLORS["Answered"] = ("E6F4EA", "1E7B34")
wsQ.conditional_formatting.add("G5:G80", CellIsRule(operator="equal", formula=['"Answered"'], fill=PatternFill("solid", fgColor="E6F4EA"), font=Font(name=F, bold=True, color="1E7B34")))

# ─────────────────────────── Dashboard ───────────────────────────
# Layout: navy banner; two rows of four KPI cards; "Delivery" charts; "Modules & team"
# charts with highlights. Chart helper numbers live on a hidden "_data" sheet.
from openpyxl.chart.series import DataPoint
from openpyxl.formatting.rule import DataBarRule

ws = wb.create_sheet("Dashboard", 0)
ws.sheet_view.showGridLines = False
ws.sheet_view.zoomScale = 90
BG = "F4F6FA"; CARD = "FFFFFF"; ACCENTS = {"navy": NAVY, "green": "2E9E50", "red": "D6336C", "amber": "F59F00", "blue": "3B5BDB"}
widths = {"A": 2, "B": 11, "C": 11, "D": 11, "E": 2, "F": 11, "G": 11, "H": 11, "I": 2, "J": 11, "K": 11, "L": 11, "M": 2, "N": 11, "O": 11, "P": 11, "Q": 2}
for col, w in widths.items():
    ws.column_dimensions[col].width = w
bgfill = PatternFill("solid", fgColor=BG)
for r in range(1, 80):
    for c in range(1, 18):
        ws.cell(row=r, column=c).fill = bgfill

# Banner
navyfill = PatternFill("solid", fgColor=NAVY)
for r in range(1, 5):
    for c in range(2, 17):
        ws.cell(row=r, column=c).fill = navyfill
for r, h in ((1, 10), (2, 34), (3, 20), (4, 10)):
    ws.row_dimensions[r].height = h
ws["B2"] = "MIRA  ·  Project Status"
ws["B2"].font = Font(name=F, size=22, bold=True, color="FFFFFF"); ws["B2"].alignment = Alignment(vertical="center")
ws["B3"] = "CES Tech · HRMS / ERP platform · Live numbers from the Modules, Features, Bugs and Roadmap tabs"
ws["B3"].font = Font(name=F, size=10, color="C9D4E8")
ws["N2"] = f"As of {AS_OF:%d %b %Y}"
ws["N2"].font = Font(name=F, size=13, bold=True, color="FFFFFF"); ws["N2"].alignment = Alignment(horizontal="right", vertical="center")
ws.merge_cells("N2:P2")
ws["N3"] = "Team: Mohit · Saanvi · Pritish · Bheem"
ws["N3"].font = Font(name=F, size=9, color="C9D4E8"); ws["N3"].alignment = Alignment(horizontal="right")
ws.merge_cells("N3:P3")

FL, BL, RL = f_last + 100, b_last + 100, r_last + 100
FR = f"Features!$G$5:$G${FL}"; BR = f"Bugs!$H$5:$H${BL}"; BS = f"Bugs!$G$5:$G${BL}"
MR = f"Modules!$C${MOD_FIRST}:$C${MOD_LAST}"; MP = f"Modules!$D${MOD_FIRST}:$D${MOD_LAST}"
RR = f"Roadmap!$H$5:$H${RL}"
FA = f"Features!$I$5:$I${FL}"; BA = f"Bugs!$K$5:$K${BL}"; RA = f"Roadmap!$F$5:$F${RL}"

CARD_COLS = [(2, 4), (6, 8), (10, 12), (14, 16)]
cardline = Side(style="thin", color="E1E6EF")
def card(top, slot, label, formula, sub, accent, fmt="0", value_color=None):
    c1, c2 = CARD_COLS[slot]
    L = ws.cell(row=top, column=c1).column_letter; R = ws.cell(row=top, column=c2).column_letter
    for r in range(top, top + 4):
        for c in range(c1, c2 + 1):
            cell = ws.cell(row=r, column=c)
            cell.fill = PatternFill("solid", fgColor=ACCENTS[accent] if r == top else CARD)
            cell.border = Border(left=cardline if c == c1 else None, right=cardline if c == c2 else None,
                                 bottom=cardline if r == top + 3 else None)
    for r in (top + 1, top + 2, top + 3):
        ws.merge_cells(f"{L}{r}:{R}{r}")
    a = ws.cell(row=top + 1, column=c1, value=label)
    a.font = Font(name=F, size=8.5, bold=True, color=MUTED); a.alignment = Alignment(indent=1, vertical="bottom")
    v = ws.cell(row=top + 2, column=c1, value=formula)
    v.font = Font(name=F, size=26, bold=True, color=value_color or ACCENTS[accent]); v.number_format = fmt
    v.alignment = Alignment(indent=1, vertical="center", horizontal="left")
    sb = ws.cell(row=top + 3, column=c1, value=sub)
    sb.font = Font(name=F, size=8.5, color=MUTED); sb.alignment = Alignment(indent=1, vertical="top")

def card_rows(top):
    for r, h in ((top, 5), (top + 1, 20), (top + 2, 40), (top + 3, 20)):
        ws.row_dimensions[r].height = h

ws.row_dimensions[5].height = 12
card_rows(6)
card(6, 0, "MODULES LIVE", f'=COUNTIF({MR},"Live")+COUNTIF({MR},"Live – improving")', f'="of "&COUNTA({MR})&" modules in production"', "navy")
card(6, 1, "OVERALL COMPLETION", f"=AVERAGE({MP})", "Average across all modules", "green", fmt="0%")
card(6, 2, "FEATURES DONE", f'=COUNTIF({FR},"Done")', f'="of "&COUNTA({FR})&" tracked · "&TEXT(COUNTIF({FR},"Done")/MAX(1,COUNTA({FR})),"0%")', "blue")
card(6, 3, "OPEN BUGS", f'=COUNTA({BR})-COUNTIF({BR},"Fixed")', f'=COUNTIFS({BR},"<>Fixed",{BS},"High")&" high severity"', "red")
ws.row_dimensions[10].height = 12
card_rows(11)
card(11, 0, "BUGS FIXED", f'=COUNTIF({BR},"Fixed")', f'=COUNTIFS({BR},"Fixed",Bugs!$J$5:$J${BL},"Pending")&" waiting for verification"', "green")
card(11, 1, "WORK PENDING", f'=COUNTIF({FR},"Pending")+COUNTIF({FR},"In progress")+COUNTIF({FR},"Needs check")+COUNTIF({FR},"Planned")', f'=COUNTIF({FR},"In progress")&" in progress · "&COUNTIF({FR},"Pending")&" not started"', "amber")
card(11, 2, "SHIPPED THIS MONTH", f'=COUNTIFS(Features!$B$5:$B${FL},">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1),{FR},"Done")', "Features marked Done this month", "navy")
card(11, 3, "THIS WEEK (P1)", f'=COUNTIFS(Roadmap!$A$5:$A${RL},"P1",{RR},"<>Done")', "Priority items not done yet", "amber")

def section(row, text, note=None):
    ws.row_dimensions[row].height = 26
    c = ws.cell(row=row, column=2, value=text); c.font = Font(name=F, size=13, bold=True, color=NAVY); c.alignment = Alignment(vertical="bottom")
    for col in range(2, 17):
        ws.cell(row=row, column=col).border = Border(bottom=Side(style="medium", color=NAVY))
    if note:
        n = ws.cell(row=row, column=10, value=note); n.font = Font(name=F, size=8.5, italic=True, color=MUTED)
        n.alignment = Alignment(horizontal="right", vertical="bottom"); ws.merge_cells(start_row=row, start_column=10, end_row=row, end_column=16)

ws.row_dimensions[15].height = 10
section(16, "Delivery", "Charts update when statuses change on the other tabs")

# Hidden chart data
wsX = wb.create_sheet("_data")
def src(r, c, label, formula, fmt="0"):
    wsX.cell(row=r, column=c, value=label)
    b = wsX.cell(row=r, column=c + 1, value=formula); b.number_format = fmt
for cc, h in ((1, "Feature status"), (4, "Bug status"), (7, "Done by month"), (10, "Module")):
    wsX.cell(row=1, column=cc, value=h); wsX.cell(row=1, column=cc + 1, value="Count" if cc < 10 else "% complete")
fs = ["Done", "In progress", "Pending", "Needs check", "Planned"]
for i, st in enumerate(fs, 1):
    src(1 + i, 1, st, f'=COUNTIF({FR},"{st}")')
bs = ["Fixed", "Open", "Needs check"]
for i, st in enumerate(bs, 1):
    src(1 + i, 4, st, f'=COUNTIF({BR},"{st}")')
months = [("Sep", (2026, 9)), ("Oct", (2026, 10)), ("Nov", (2026, 11)), ("Dec", (2026, 12))]
for i, (lab, (y, m)) in enumerate(months, 1):
    ny, nm = (y, m + 1) if m < 12 else (y + 1, 1)
    src(1 + i, 7, lab, f'=COUNTIFS(Features!$B$5:$B${FL},">="&DATE({y},{m},1),Features!$B$5:$B${FL},"<"&DATE({ny},{nm},1),{FR},"Done")')
NMOD = MOD_LAST - MOD_FIRST + 1
for i in range(MOD_FIRST, MOD_LAST + 1):
    src(2 + i - MOD_FIRST, 10, f"=Modules!A{i}", f"=Modules!D{i}", fmt="0%")
wsX.sheet_state = "hidden"

def only_values(percent=False):
    # Excel otherwise prints 'Count, Done, 38': series and category names too.
    dl = DataLabelList()
    dl.showVal = not percent; dl.showPercent = percent
    dl.showSerName = False; dl.showCatName = False; dl.showLegendKey = False; dl.showLeaderLines = False
    return dl

def style_chart(ch, w, h):
    ch.roundedCorners = False
    ch.width, ch.height = w, h
    if ch.legend is not None:
        ch.legend.overlay = False
    try: ch.title.overlay = False
    except Exception: pass
    try:
        ch.x_axis.delete = False; ch.y_axis.delete = False
    except Exception: pass

c1 = BarChart(); c1.type = "col"; c1.title = "Features by status"
c1.add_data(Reference(wsX, min_col=2, min_row=1, max_row=1 + len(fs)), titles_from_data=True)
c1.set_categories(Reference(wsX, min_col=1, min_row=2, max_row=1 + len(fs)))
c1.legend = None; c1.y_axis.majorGridlines = None; c1.gapWidth = 60
c1.dataLabels = only_values()
for idx, colr in enumerate(["2E9E50", "F59F00", "D6336C", "94A3B8", "3B5BDB"]):
    pt = DataPoint(idx=idx); pt.graphicalProperties.solidFill = colr; c1.series[0].dPt.append(pt)
style_chart(c1, 13.2, 7.4); ws.add_chart(c1, "B17")

c2 = PieChart(); c2.title = "Bugs: fixed vs open"
c2.add_data(Reference(wsX, min_col=5, min_row=1, max_row=1 + len(bs)), titles_from_data=True)
c2.set_categories(Reference(wsX, min_col=4, min_row=2, max_row=1 + len(bs)))
c2.dataLabels = only_values(percent=True)
for idx, colr in enumerate(["2E9E50", "D6336C", "94A3B8"]):
    pt = DataPoint(idx=idx); pt.graphicalProperties.solidFill = colr; c2.series[0].dPt.append(pt)
style_chart(c2, 13.2, 7.4); ws.add_chart(c2, "J17")

for r in range(17, 32):
    ws.row_dimensions[r].height = 15
section(32, "Modules & team", "Team = open bugs, bugs to verify, tasks and roadmap items per person")

c3 = BarChart(); c3.type = "bar"; c3.title = "Completion by module"
c3.add_data(Reference(wsX, min_col=11, min_row=1, max_row=1 + NMOD), titles_from_data=True)
c3.set_categories(Reference(wsX, min_col=10, min_row=2, max_row=1 + NMOD))
c3.legend = None; c3.gapWidth = 40
c3.y_axis.scaling.min = 0; c3.y_axis.scaling.max = 1; c3.y_axis.number_format = "0%"; c3.y_axis.majorGridlines = None
c3.x_axis.scaling.orientation = "maxMin"
c3.series[0].graphicalProperties.solidFill = "2E9E50"
style_chart(c3, 13.2, 14.8); ws.add_chart(c3, "B33")

c4 = BarChart(); c4.type = "col"; c4.title = "Features delivered by month"
c4.add_data(Reference(wsX, min_col=8, min_row=1, max_row=1 + len(months)), titles_from_data=True)
c4.set_categories(Reference(wsX, min_col=7, min_row=2, max_row=1 + len(months)))
c4.legend = None; c4.y_axis.majorGridlines = None; c4.gapWidth = 60
c4.dataLabels = only_values()
c4.series[0].graphicalProperties.solidFill = NAVY
style_chart(c4, 13.2, 7.0)

# Team tab (workload table) — the dashboard chart reads it
wsT = wb.create_sheet("Team")
title(wsT, "Team workload", "Open items per person. Counts follow 'Assigned to' on Features and Bugs and 'Owner' on Roadmap.", 6)
team_rows = []
for i, p in enumerate(TEAM, 5):
    team_rows.append([p,
        f'=COUNTIFS({BA},$A{i},{BR},"<>Fixed")',
        f'=COUNTIFS({BA},$A{i},{BR},"Fixed",Bugs!$J$5:$J${BL},"Pending")',
        f'=COUNTIFS({FA},$A{i},{FR},"<>Done")',
        f'=COUNTIFS({RA},$A{i},{RR},"<>Done")',
        f"=SUM(B{i}:E{i})"])
table(wsT, 4, ["Person", "Open bugs", "Bugs to verify", "Open tasks", "Roadmap items", "Total open"], team_rows, [22, 14, 16, 14, 16, 14])
tot = 5 + len(TEAM)
wsT.cell(row=tot, column=1, value="Team total").font = Font(name=F, size=10, bold=True, color=NAVY)
for j, col in enumerate("BCDEF", 2):
    c = wsT.cell(row=tot, column=j, value=f"=SUM({col}5:{col}{tot-1})"); c.font = Font(name=F, size=10, bold=True, color=NAVY)
    c.border = Border(top=Side(style="medium", color=NAVY))
wsT.cell(row=tot, column=1).border = Border(top=Side(style="medium", color=NAVY))
for r in range(5, tot + 1):
    for j in range(2, 7):
        wsT.cell(row=r, column=j).alignment = Alignment(horizontal="center", vertical="center")
wsT.conditional_formatting.add(f"F5:F{tot-1}", DataBarRule(start_type="num", start_value=0, end_type="max", color="F59F00"))

c5 = BarChart(); c5.type = "bar"; c5.grouping = "stacked"; c5.overlap = 100; c5.title = "Open work per person"
for col, colr in ((2, "D6336C"), (3, "94A3B8"), (4, "F59F00"), (5, "3B5BDB")):
    c5.add_data(Reference(wsT, min_col=col, min_row=4, max_row=4 + len(TEAM)), titles_from_data=True)
    c5.series[-1].graphicalProperties.solidFill = colr
c5.set_categories(Reference(wsT, min_col=1, min_row=5, max_row=4 + len(TEAM)))
c5.y_axis.majorGridlines = None; c5.x_axis.scaling.orientation = "maxMin"; c5.gapWidth = 50
c5.legend.position = "b"
style_chart(c5, 13.2, 7.4); ws.add_chart(c5, "J33")
c5b = BarChart(); c5b.type = "bar"; c5b.grouping = "stacked"; c5b.overlap = 100; c5b.title = "Open work per person"
for col, colr in ((2, "D6336C"), (3, "94A3B8"), (4, "F59F00"), (5, "3B5BDB")):
    c5b.add_data(Reference(wsT, min_col=col, min_row=4, max_row=4 + len(TEAM)), titles_from_data=True)
    c5b.series[-1].graphicalProperties.solidFill = colr
c5b.set_categories(Reference(wsT, min_col=1, min_row=5, max_row=4 + len(TEAM)))
c5b.y_axis.majorGridlines = None; c5b.x_axis.scaling.orientation = "maxMin"; c5b.legend.position = "b"
style_chart(c5b, 16, 8); wsT.add_chart(c5b, "J4")

ws.add_chart(c4, "J48")
for r in range(33, 63):
    ws.row_dimensions[r].height = 15

# Highlights + where to look
section(63, "Highlights & where to look")
hl = DATA.get("highlights") or ["• Self-service onboarding complete: document rules, waivers, review checkboxes",
      "• Field visits: photo approval when away from the site",
      "• New UI (v2) is now the default for everyone",
      "• Directory search/filter fixed; HR login hand over",
      "• Login email change to @ces-pl.com",
      "• Deployed to production 16 Nov"]
for i, t in enumerate(hl, 64):
    ws.row_dimensions[i].height = 20
    ws.merge_cells(start_row=i, start_column=2, end_row=i, end_column=8)
    c = ws.cell(row=i, column=2, value=t); c.font = Font(name=F, size=10, color=INK); c.alignment = Alignment(vertical="center", indent=1)
    for col in range(2, 9):
        ws.cell(row=i, column=col).fill = PatternFill("solid", fgColor=CARD)
guide = [("Modules", "What works, module by module"), ("Features", "Built and pending, with dates"),
         ("Bugs", "Found, fixed and open"), ("Roadmap", "What comes next"), ("Team", "Workload per person"), ("Work Log", "Hours by person"),
         ("Releases", "What went live and when"), ("Decisions", "Rules agreed with management"),
         ("Open Questions", "Answers we need"), ("How to read", "Status meanings, editing rules")]
for i, (sname, d) in enumerate(guide, 64):
    ws.row_dimensions[i].height = 20
    a = ws.cell(row=i, column=10, value=f"→ {sname}"); a.hyperlink = f"#'{sname}'!A1"
    a.font = Font(name=F, size=10, bold=True, color="3B5BDB"); a.alignment = Alignment(vertical="center", indent=1)
    ws.merge_cells(start_row=i, start_column=12, end_row=i, end_column=16)
    b = ws.cell(row=i, column=12, value=d); b.font = Font(name=F, size=9, color=MUTED); b.alignment = Alignment(vertical="center")
    for col in range(10, 17):
        ws.cell(row=i, column=col).fill = PatternFill("solid", fgColor=CARD)
ws.page_setup.orientation = "landscape"; ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 0
ws.sheet_properties.pageSetUpPr.fitToPage = True
ws.print_area = "A1:Q75"

# ─────────────────────────── Work Log ───────────────────────────
WORK_TYPES = ["Feature", "Bug", "Task", "Deploy", "Meeting", "Review"]
wlog = DATA.get("worklog") or []
wsW = wb.create_sheet("Work Log")
title(wsW, "Work log — hours by person", "One row per piece of work. Hours (yellow) are editable; the Team tab totals them per person.", 6)
wrows = [(D(w["date"]) if w.get("date") else None, w.get("person"), w.get("type"), w.get("item"), w.get("hours"), w.get("notes")) for w in wlog]
w_last = table(wsW, 4, ["Date", "Person", "Type", "Work item", "Hours", "Notes"], wrows, [13, 18, 11, 58, 9, 52],
               date_cols=(1,), input_cols=(5,))
for r in range(5, w_last + 101):
    wsW.cell(row=r, column=5).number_format = "0.00"
    wsW.cell(row=r, column=1).number_format = "dd-mmm-yyyy"
dvw = DataValidation(type="list", formula1=TEAM_DV, allow_blank=True); wsW.add_data_validation(dvw); dvw.add(f"B5:B{w_last+100}")
dvt = DataValidation(type="list", formula1='"' + ",".join(WORK_TYPES) + '"', allow_blank=True); wsW.add_data_validation(dvt); dvt.add(f"C5:C{w_last+100}")
WL = w_last + 100
wtot = w_last + 1
wsW.cell(row=wtot, column=4, value="Total hours").font = Font(name=F, size=10, bold=True, color=NAVY)
c = wsW.cell(row=wtot, column=5, value=f"=SUM(E5:E{w_last})"); c.font = Font(name=F, size=10, bold=True, color=NAVY); c.number_format = "0.00"
for col in (4, 5):
    wsW.cell(row=wtot, column=col).border = Border(top=Side(style="medium", color=NAVY))
wsW["A3"] = "Hours marked 'estimate' in Notes were filled from commit times — correct them to actual hours."
wsW["A3"].font = Font(name=F, size=9, italic=True, color=MUTED)

# Hours per person on the Team tab
wsT.cell(row=4, column=7, value="Hours today")
wsT.cell(row=4, column=8, value="Hours (7 days)")
for col in (7, 8):
    h = wsT.cell(row=4, column=col); h.font = Font(name=F, size=10, bold=True, color="FFFFFF"); h.fill = HDR_FILL
    h.border = BORDER; h.alignment = Alignment(vertical="center", wrap_text=True)
wsT.column_dimensions["G"].width = 14; wsT.column_dimensions["H"].width = 15
for i, p in enumerate(TEAM, 5):
    for col, f in ((7, f"=SUMIFS('Work Log'!$E$5:$E${WL},'Work Log'!$B$5:$B${WL},$A{i},'Work Log'!$A$5:$A${WL},TODAY())"),
                   (8, f"=SUMIFS('Work Log'!$E$5:$E${WL},'Work Log'!$B$5:$B${WL},$A{i},'Work Log'!$A$5:$A${WL},\">=\"&(TODAY()-6))")):
        c = wsT.cell(row=i, column=col, value=f); c.number_format = "0.00"; c.font = Font(name=F, size=10, color=INK)
        c.border = BORDER; c.alignment = Alignment(horizontal="center", vertical="center")
tt = 5 + len(TEAM)
for col, L in ((7, "G"), (8, "H")):
    c = wsT.cell(row=tt, column=col, value=f"=SUM({L}5:{L}{tt-1})"); c.number_format = "0.00"
    c.font = Font(name=F, size=10, bold=True, color=NAVY); c.border = Border(top=Side(style="medium", color=NAVY))
    c.alignment = Alignment(horizontal="center")

# ─────────────────────────── How to read ───────────────────────────
wsH = wb.create_sheet("How to read")
title(wsH, "How to read and update this report", "Prepared from the MIRA code repository (main branch, commits up to 044ee226) and the project decisions log.", 2)
rows = [
    ("Status — Features", "Done: built and working · In progress: being built · Pending: agreed, not started · Needs check: partly present in code, to confirm · Planned: later."),
    ("Status — Bugs", "Fixed · Open · In progress · Needs check. Severity High = pay, attendance or security impact."),
    ("Status — Modules", "Live · Live – improving (working, more coming) · Partial (key parts missing) · Planned."),
    ("Release", "Live = in production · Deploying = shipped to production on 16 Nov, being verified."),
    ("Cells you edit", "Yellow cells: Roadmap Owner and Target date, Releases Verified by, Open Questions Answer. Status columns have dropdowns."),
    ("Cells not to overwrite", "Everything on the Dashboard — those are formulas reading the other tabs."),
    ("Adding a row", "Add it at the bottom of the table, pick a status from the dropdown; the Dashboard counts it automatically (up to 100 new rows per tab)."),
    ("% Complete", "The team's estimate of how much of the module is built, not a measured figure."),
    ("Dates", "Shown as dd-mmm-yyyy, e.g. 16-Nov-2026."),
    ("Team", "Mohit Singh, Saanvi Sharma, Pritish, Bheem. 'Assigned to' (Features, Bugs) and 'Owner' (Roadmap) are dropdowns; the Dashboard's Team workload counts open items per person."),
    ("Work Log", "One row per piece of work with hours. Add rows at the bottom; pick Person and Type from the dropdowns. Team tab shows hours today and in the last 7 days."),
    ("Live version", "This file is a snapshot. The always-current list is the CES Project Tracker page (claude.ai link shared by Mohit)."),
    ("Source", "Git history of the MIRA repository (586 commits since 1 Sep 2026), the module status sheet of 1 Sep 2026, and decisions recorded with management."),
]
table(wsH, 4, ["Topic", "Explanation"], rows, [26, 110])

# Tab colours, zoom, print set-up, centred status columns
TAB = {"Dashboard": NAVY, "Modules": "2E9E50", "Features": "3B5BDB", "Bugs": "D6336C", "Roadmap": "F59F00",
       "Team": "7048E8", "Work Log": "2F9E44", "Releases": "0C8599", "Decisions": "64748B", "Open Questions": "E8590C", "How to read": "94A3B8"}
CENTER = {"Modules": (2, 3, 4, 7), "Features": (1, 2, 7, 8, 9), "Bugs": (1, 2, 7, 8, 9, 10, 11), "Roadmap": (1, 6, 7, 8),
          "Releases": (1, 2, 5), "Decisions": (1, 2), "Open Questions": (1, 2, 5, 7)}
for wsx in wb.worksheets:
    if wsx.title in TAB:
        wsx.sheet_properties.tabColor = TAB[wsx.title]
    if wsx.title not in ("Dashboard", "_data"):
        wsx.sheet_view.zoomScale = 90
        wsx.page_setup.orientation = "landscape"; wsx.page_setup.fitToWidth = 1; wsx.page_setup.fitToHeight = 0
        wsx.sheet_properties.pageSetUpPr.fitToPage = True
        wsx.print_title_rows = "4:4"
        for col in CENTER.get(wsx.title, ()):
            for r in range(5, wsx.max_row + 1):
                c = wsx.cell(row=r, column=col)
                c.alignment = Alignment(horizontal="center", vertical="top", wrap_text=True)
wsM.conditional_formatting.add(f"D{MOD_FIRST}:D{MOD_LAST}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="63BE7B"))
wb.move_sheet(wsT, offset=(wb.sheetnames.index('Roadmap') + 1) - wb.sheetnames.index('Team'))
wb.move_sheet(wsW, offset=(wb.sheetnames.index('Team') + 1) - wb.sheetnames.index('Work Log'))
wb.active = 0
from openpyxl.workbook.properties import CalcProperties
wb.calculation = CalcProperties(fullCalcOnLoad=True)
# Save to a temp file beside the target, then swap it in with one rename, so
# OneDrive sees a single complete change (rapid repeated saves make it keep
# 'conflict' copies named after the Mac).
import tempfile
_fd, _tmp = tempfile.mkstemp(prefix="~$mira-", suffix=".tmp", dir=os.path.dirname(os.path.abspath(OUT)) or ".")
os.close(_fd)
wb.save(_tmp)
os.replace(_tmp, OUT)
if os.environ.get("EXPORT_DATA"):
    out = {"as_of": AS_OF.isoformat(), "highlights": hl,
      "modules": [dict(module=a, area=b, status=c, pct=d, works=e, gaps=f, updated=g.isoformat() if g else None) for a, b, c, d, e, f, g in mods],
      "features": [dict(date=d, module=m, feature=n, what=w, users=u, status=st, release=r, assignee=FEAT_ASSIGN.get(n)) for d, m, n, w, u, st, r in feats],
      "bugs": [dict(found=d, module=m, bug=b, cause=c, fix=fx, severity=sv, status=st, fixed_on=fd, verified=v, assignee=who_bug(b), steps=BUG_STEPS.get(b), screenshot=BUG_SHOT.get(b)) for d, m, b, c, fx, sv, st, fd, v in bugs],
      "roadmap": [dict(priority=p, item=it, module=m, why=why, waiting=dep, owner=ROAD_ASSIGN.get(it), target=ROAD_TARGET.get(it), status=st) for p, it, m, why, dep, st in road],
      "releases": [dict(date=d, version=c, what=w, db=db_, status=st, verified_by=REL_VERIFIED.get((c, w))) for d, c, w, db_, st in rel],
      "decisions": [dict(date=d, area=a, decision=x, details=y) for d, a, x, y in dec],
      "worklog": DATA.get("worklog", []),
      "questions": [dict(area=a, question=q, why=why, who=who, status=st, answer=Q_ANSWER.get(q)) for a, q, why, who, st in oq]}
    json.dump(out, open(os.environ["EXPORT_DATA"], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("saved", OUT, "features", f_last - 4, "bugs", b_last - 4)
