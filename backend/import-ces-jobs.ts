import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const FILE = getArg('file');
const COMPANY_ID = parseInt(getArg('company-id') || '1', 10);
const PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY;
// Writes nothing unless --commit is passed (this hits the live DB and uploads
// resumes to ImageKit, so the default is a report-only pass).
const COMMIT = process.argv.includes('--commit');

const report = {
  jobsCreated: 0, jobsUpdated: 0,
  appsCreated: 0, appsUpdated: 0, appsSkipped: 0,
  resumesUploaded: 0,
  interviewsCreated: 0, interviewsUnmatched: [] as string[],
  offersCreated: 0, offersUnmatched: [] as string[],
  warnings: [] as string[],
};

function parseDate(str: string): Date | null {
  if (!str || str.toLowerCase() === 'no end date') return null;
  // Format: DD-MM-YYYY
  const parts = str.split('-');
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
  }
  return null;
}

/** "11 October, 2025 16:45 pm" -> Date (IST). The am/pm suffix is unreliable —
 *  Workway prints "pm" alongside a 24-hour clock, so the hour is trusted as-is. */
function parseInterviewDate(str: string): Date | null {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\s*([ap]m)?/i);
  if (!m) return null;
  const months = ['january','february','march','april','may','june','july',
                  'august','september','october','november','december'];
  const mi = months.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  let hh = m[4] ? parseInt(m[4], 10) : 0;
  const mm = m[5] ? parseInt(m[5], 10) : 0;
  if (m[6] && /pm/i.test(m[6]) && hh < 12) hh += 12;   // only shift a true 12-hour value
  if (m[6] && /am/i.test(m[6]) && hh === 12) hh = 0;
  const d = new Date(`${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
  return isNaN(d.getTime()) ? null : d;
}

function mapInterviewStatus(s: string): string {
  const v = (s || '').toLowerCase();
  if (v.includes('complet') || v.includes('done')) return 'COMPLETED';
  if (v.includes('cancel')) return 'CANCELLED';
  return 'SCHEDULED';
}

function mapOfferStatus(s: string): string {
  const v = (s || '').toLowerCase();
  if (v.includes('accept')) return 'ACCEPTED';
  if (v.includes('decline') || v.includes('reject')) return 'DECLINED';
  if (v.includes('draft')) return 'DRAFT';
  return 'SENT';   // pending / expired / sent
}

function parseCtc(str: any): number | null {
  if (str === null || str === undefined || str === '') return null;
  if (typeof str === 'number') return str;
  const numStr = String(str).replace(/[^0-9.-]+/g, '');
  const val = parseFloat(numStr);
  return isNaN(val) ? null : val;
}

/**
 * Workway status -> our 9-stage recruitment pipeline:
 * APPLIED, PHONE_SCREENING, INTERVIEW, NEGOTIATION, OFFERED, HIRED, ONBOARDED,
 * ON_HOLD, REJECTED.
 *
 * The previous version had no home for "phone screen" or "Hold" and dropped both
 * into NEW, which is why 292 records were mislabelled. Order matters here:
 * "phone screen" must be tested before "interview".
 */
function mapStatus(status: string): string {
    const s = (status || '').toLowerCase().trim();
    if (!s) return 'APPLIED';
    if (s.includes('reject')) return 'REJECTED';
    if (s.includes('onboard')) return 'ONBOARDED';
    if (s.includes('hire')) return 'HIRED';
    if (s.includes('offer')) return 'OFFERED';
    if (s.includes('negotiat')) return 'NEGOTIATION';
    if (s.includes('hold')) return 'ON_HOLD';
    if (s.includes('phone') || s.includes('screen')) return 'PHONE_SCREENING';
    if (s.includes('interview')) return 'INTERVIEW';
    return 'APPLIED';
}

async function uploadToImageKit(pdfUrl: string, candidateName: string): Promise<string | null> {
    if (!PRIVATE_KEY) {
        console.warn('No IMAGEKIT_PRIVATE_KEY, skipping upload');
        return pdfUrl;
    }
    
    try {
        console.log(`Downloading PDF from ${pdfUrl}...`);
        const dl = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const buffer = dl.data;
        
        console.log(`Uploading to ImageKit for ${candidateName}...`);
        const form = new FormData();
        form.append('file', buffer, 'resume.pdf');
        form.append('fileName', `${candidateName.replace(/[^a-zA-Z0-9]/g, '_')}_resume.pdf`);
        form.append('folder', '/resumes');
        
        const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
            auth: { username: PRIVATE_KEY, password: '' },
            headers: form.getHeaders(),
        });
        
        return response.data.url;
    } catch (error: any) {
        console.error(`Failed to migrate resume for ${candidateName}:`, error.message);
        return pdfUrl; // fallback to original
    }
}

async function main() {
  if (!FILE) {
    console.error('Usage: ts-node import-ces-jobs.ts --file path/to/jobs_full.json');
    process.exit(1);
  }

  const rawData = fs.readFileSync(path.resolve(FILE), 'utf-8');
  const jobsData = JSON.parse(rawData);
  console.log(`Loaded ${jobsData.length} jobs to import.`);

  // Load dictionaries
  const departments = await prisma.department.findMany({ where: { companyId: COMPANY_ID } });
  const designations = await prisma.designation.findMany({ where: { companyId: COMPANY_ID } });
  const employees = await prisma.employee.findMany({ include: { user: true } });

  for (const job of jobsData) {
    console.log(`Processing Job: ${job.title_raw}`);
    
    // Attempt mapping
    let deptId: number | null = null;
    if (job.department) {
        const found = departments.find(d => d.name.toLowerCase() === job.department.toLowerCase());
        if (found) deptId = found.id;
    }
    let desigId: number | null = null;
    if (job.category) {
        const found = designations.find(d => d.name.toLowerCase() === job.category.toLowerCase());
        if (found) desigId = found.id;
    }
    let recruiterId: number | null = null;
    if (job.recruiter) {
        // Workway renders the recruiter as name + designation ("Mrs Piyushi Soni HR
        // Manager"), sometimes with an "It's you" badge. So look for an employee
        // name *inside* that string, not the other way round. Longest name first so
        // "Ashish Kumar Mandal" wins over a bare "Ashish".
        const rec = String(job.recruiter)
            .replace(/^(Mr|Mrs|Miss|Ms|Dr)\.?\s+/i, '')
            .replace(/it'?s you/ig, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
        const candidates = employees
            .map(e => ({ e, n: `${e.firstName || ''} ${e.lastName || ''}`.replace(/\s+/g, ' ').trim().toLowerCase() }))
            .filter(x => x.n.length >= 4)
            .sort((a, b) => b.n.length - a.n.length);
        const found = candidates.find(x => rec.includes(x.n));
        if (found) recruiterId = found.e.id;
        else report.warnings.push(`recruiter not matched: "${job.recruiter}"`);
    }

    const jobTitle = job.title_raw || 'Untitled Job';
    
    let dbJob = await prisma.job.findFirst({
        where: { title: jobTitle, companyId: COMPANY_ID }
    });

    const jobData = {
        title: jobTitle,
        companyId: COMPANY_ID,
        departmentId: deptId,
        designationId: desigId,
        recruiterId: recruiterId,
        experienceYears: job.work_experience,
        type: job.job_type || 'Full-time',
        // Prefer the Profile tab's status: the jobs-list cell is a dropdown whose
        // text concatenates every option ("Open Closed"), so it can't be trusted.
        status: String(job.profile?.status || job.status || '').trim().toLowerCase() === 'open'
            ? 'Open' : 'Closed',
        minSalary: parseCtc(job.minimum_salary_amount),
        descriptionHtml: job.description_html || job.description,
        startDate: parseDate(job.start_date),
        endDate: parseDate(job.end_date),
        totalOpenings: parseInt(job.total_openings) || 1,
    };

    if (dbJob) {
        if (COMMIT) dbJob = await prisma.job.update({ where: { id: dbJob.id }, data: jobData });
        report.jobsUpdated++;
    } else {
        if (COMMIT) dbJob = await prisma.job.create({ data: jobData });
        report.jobsCreated++;
    }
    // In a dry run nothing is written, so use a placeholder id for the linking below.
    const jobId: number = dbJob ? dbJob.id : -1;

    // Workway application id -> our JobApplication id. Interviews and offers carry
    // recruit_job_application_id, so they link exactly instead of by name.
    const appByWorkwayId = new Map<string, number>();

    // Process Candidates
    const candidates = job.candidates || [];
    for (const cand of candidates) {
        console.log(`  Processing Applicant: ${cand.full_name}`);
        
        let resumeUrl = cand.resume_url;
        if (resumeUrl && COMMIT) {
            // Check if already applied to avoid re-uploading
            const existingApp = await prisma.jobApplication.findFirst({
                where: { jobId: jobId, email: cand.email || cand.applicant_email || '' }
            });
            if (!existingApp || !existingApp.resumeUrl || existingApp.resumeUrl.includes('cloudfront')) {
                resumeUrl = await uploadToImageKit(resumeUrl, cand.full_name || 'unknown');
                report.resumesUploaded++;
            } else {
                resumeUrl = existingApp.resumeUrl; // keep the existing imagekit url
            }
        } else if (resumeUrl) {
            report.resumesUploaded++;   // dry run: count what would be uploaded
        }

        const appData = {
            jobId: jobId,
            companyId: COMPANY_ID,
            fullName: cand.full_name || 'Unknown',
            email: cand.email || cand.applicant_email || `unknown-${cand.application_id}@example.com`,
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

        const existingApp = COMMIT ? await prisma.jobApplication.findFirst({
            where: { jobId: jobId, email: appData.email }
        }) : null;

        let appId = existingApp?.id ?? -1;
        if (existingApp) {
            if (COMMIT) await prisma.jobApplication.update({ where: { id: existingApp.id }, data: appData });
            report.appsUpdated++;
        } else {
            if (COMMIT) {
                const created = await prisma.jobApplication.create({ data: appData });
                appId = created.id;
            }
            report.appsCreated++;
        }
        if (cand.application_id) appByWorkwayId.set(String(cand.application_id), appId);
    }

    // ── Interviews ────────────────────────────────────────────────────────
    for (const iv of (job.interview || [])) {
        const key = String(iv.recruit_job_application_id || '');
        const appId = appByWorkwayId.get(key);
        if (appId === undefined) {
            report.interviewsUnmatched.push(`${job.title_raw}: app ${key || '(none)'}`);
            continue;
        }
        const scheduledAt = parseInterviewDate(iv.schedule_date || iv.scheduled_date_and_time || '');
        if (!scheduledAt) {
            report.warnings.push(`interview app ${key}: unparseable date "${iv.schedule_date || iv.scheduled_date_and_time}"`);
            continue;
        }
        const interviewerName = String(iv.interviewer_name || iv.full_name || iv.interviewer || '')
            .replace(/^(Mr|Mrs|Miss|Ms)\.?\s+/i, '').trim();
        const interviewer = interviewerName
            ? employees.find(e => `${e.firstName} ${e.lastName}`.toLowerCase().includes(interviewerName.toLowerCase()))
            : null;

        if (COMMIT) {
            const dup = await prisma.interview.findFirst({ where: { applicationId: appId, scheduledAt } });
            const data = {
                applicationId: appId,
                interviewerId: interviewer?.id ?? null,
                title: iv.stage || iv.interview_type || iv.interview_round || 'Interview',
                scheduledAt,
                status: mapInterviewStatus(iv.interview_status || iv.status),
            };
            if (dup) await prisma.interview.update({ where: { id: dup.id }, data });
            else await prisma.interview.create({ data });
        }
        report.interviewsCreated++;
    }

    // ── Offer letters ─────────────────────────────────────────────────────
    for (const off of (job.offerletter || [])) {
        const okey = String(off.recruit_job_application_id || '');
        const appId = appByWorkwayId.get(okey);
        if (appId === undefined) {
            report.offersUnmatched.push(`${job.title_raw}: app ${okey || '(none)'}`);
            continue;
        }
        if (COMMIT) {
            // OfferLetter.applicationId is unique — one letter per application.
            const existing = await prisma.offerLetter.findUnique({ where: { applicationId: appId } });
            const data = {
                companyId: COMPANY_ID,
                status: mapOfferStatus(off.status),
                issuedAt: parseDate(off.offer_expire_on) ? null : null,
            };
            if (existing) {
                await prisma.offerLetter.update({ where: { id: existing.id }, data });
            } else {
                await prisma.offerLetter.create({
                    data: {
                        ...data,
                        applicationId: appId,
                        // required + unique; candidates never receive these imported links
                        accessToken: crypto.randomBytes(24).toString('hex'),
                    },
                });
            }
            // The agreed joining date lives on the application, not the letter.
            const joining = parseDate(off.expected_joining_date || off.job_expire);
            if (joining) await prisma.jobApplication.update({ where: { id: appId }, data: { joiningDate: joining } });
        }
        report.offersCreated++;
    }
  }

  console.log('\n──────── report ────────');
  console.log(`Jobs:         ${report.jobsCreated} to create, ${report.jobsUpdated} to update`);
  console.log(`Applications: ${report.appsCreated} to create, ${report.appsUpdated} to update`);
  console.log(`Resumes:      ${report.resumesUploaded} to upload to ImageKit`);
  console.log(`Interviews:   ${report.interviewsCreated}, ${report.interviewsUnmatched.length} unmatched candidate`);
  console.log(`Offers:       ${report.offersCreated}, ${report.offersUnmatched.length} unmatched applicant`);
  if (report.interviewsUnmatched.length)
    console.log(`  unmatched interviews: ${report.interviewsUnmatched.slice(0, 8).join(' | ')}`);
  if (report.offersUnmatched.length)
    console.log(`  unmatched offers: ${report.offersUnmatched.slice(0, 8).join(' | ')}`);
  if (report.warnings.length)
    report.warnings.slice(0, 8).forEach(w => console.log(`  - ${w}`));
  console.log(COMMIT ? '\nDONE — committed.' : '\nDRY RUN — nothing written. Re-run with --commit.');
  process.exit(0);
}

main().catch(console.error);
