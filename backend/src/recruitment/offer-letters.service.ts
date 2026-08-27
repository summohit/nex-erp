import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import * as mammoth from 'mammoth';

/**
 * Company legal identity, statutory policy constants and salary-structure ratios.
 * Persisted as JSON on SystemSetting.offerLetterConfig. Every value has a sensible
 * default so an offer letter renders even before a company configures anything.
 */
export interface OfferLetterConfig {
  // Legal identity / letterhead
  legalEntityName?: string;   // e.g. "N-Expert Solutions Private Limited"
  cin?: string;
  officeAddress?: string;     // reporting location, also used in the footer
  contactPhone?: string;
  contactEmail?: string;
  website?: string;
  tagline?: string;

  // Policy constants
  reportingTime?: string;     // e.g. "9:30 AM"
  probationMonths?: number;
  probationNoticeMonths?: number;   // notice required while still on probation
  noticePeriodMonths?: number;
  terminationNoticeMonths?: number;
  bondMonths?: number;
  liquidatedDamages?: number;
  casualLeaveDays?: number;
  sickLeaveDays?: number;
  workingHoursText?: string;
  monthlyWorkHours?: number;
  healthCoverAmount?: number;
  healthCoverAmountAlt?: number;    // upper band, letter reads "X or Y"
  // Cost-recovery ladder on early resignation
  costRecoveryFullMonths?: number;  // resign before this -> reimburse 100%
  costRecoveryHalfMonths?: number;  // resign before this -> reimburse partial
  costRecoveryHalfPercent?: number; // the partial rate
  trainingBondMonths?: number;      // separate service agreement for paid training

  // Salary structure
  basicPercentOfCtc?: number; // 50 => Basic is 50% of CTC
  hraPercentOfBasic?: number; // 40 => HRA is 40% of Basic
  travellingAllowance?: number; // monthly, flat
  medicalAllowance?: number;    // monthly, flat
  pfBase?: number;              // statutory PF wage base, default 15000
  pfPercent?: number;           // 12
  employerEsicPercent?: number; // 3.25
  employeeEsicPercent?: number; // 0.75
}

const CONFIG_DEFAULTS: Required<Omit<OfferLetterConfig,
  'legalEntityName' | 'cin' | 'officeAddress' | 'contactPhone' | 'contactEmail' | 'website' | 'tagline'>> = {
  reportingTime: '9:30 AM',
  probationMonths: 6,
  probationNoticeMonths: 2,
  noticePeriodMonths: 3,
  terminationNoticeMonths: 1,
  bondMonths: 24,
  liquidatedDamages: 500000,
  casualLeaveDays: 10,
  sickLeaveDays: 8,
  workingHoursText: '9:30 A.M. to 6:30 P.M., Monday through Saturday',
  monthlyWorkHours: 208,
  healthCoverAmount: 300000,
  healthCoverAmountAlt: 500000,
  costRecoveryFullMonths: 6,
  costRecoveryHalfMonths: 12,
  costRecoveryHalfPercent: 50,
  trainingBondMonths: 24,
  basicPercentOfCtc: 50,
  hraPercentOfBasic: 40,
  travellingAllowance: 1600,
  medicalAllowance: 1250,
  pfBase: 15000,
  pfPercent: 12,
  employerEsicPercent: 3.25,
  employeeEsicPercent: 0.75,
};

interface SalaryRow {
  label: string;
  monthly: number;
  annual: number;
  emphasis?: boolean;
  group?: boolean;
}

/**
 * Default letter body. The repeating letterhead and footer are NOT part of this —
 * they are rendered by Puppeteer's headerTemplate/footerTemplate so they appear on
 * every page. Clause text mirrors a standard Indian appointment letter; companies
 * can override the whole thing from System Settings.
 */
const DEFAULT_OFFER_LETTER_TEMPLATE = `
<div style="font-family:'Helvetica Neue',Arial,sans-serif; color:#1f2937; font-size:11.5px; line-height:1.75; max-width:760px; margin:0 auto; text-align:justify;">

  <p style="margin:0 0 20px; font-size:11px; color:#6b7280; letter-spacing:0.02em;">{{issuedDate}}</p>

  <div style="margin:0 0 22px; padding-left:12px; border-left:3px solid #ff5500; text-align:left;">
    <p style="margin:0 0 3px; font-weight:700; font-size:12.5px; color:#111827; letter-spacing:0.01em;">{{candidateName}}</p>
    <p style="margin:0; white-space:pre-line; color:#6b7280; font-size:10.5px; line-height:1.6;">{{candidateAddress}}</p>
  </div>

  <p style="margin:0 0 16px; text-align:left;">Dear {{candidateName}},</p>

  <p style="margin:0 0 12px;">
    We are pleased to inform you that you have been selected for employment with us as
    <strong>{{jobTitle}}</strong> with {{companyName}} (Unit of {{legalEntityName}}). Your total
    emoluments are <strong>{{offeredSalary}}</strong>, based on your individual and company
    performance in half yearly. You may also be assigned and / or deputed to any other
    subsidiary/affiliated companies / Divisions whenever the company may deem fit.
  </p>

  <p style="margin:0 0 12px;">
    You are expected to <strong>join on {{joiningDate}} at {{reportingTime}}</strong> at the
    following location to complete your joining formalities:
    <strong>{{officeAddress}}</strong>
  </p>

  <p style="margin:0 0 12px;">
    You may, at the discretion of the Company and in accordance with business requirements, be
    required to relocate or be deployed to any of the Company&#39;s units, departments, affiliated
    entities, or to the offices of its customers, whether within India or overseas.
  </p>

  <p style="margin:0 0 12px;">
    In such an event, your remuneration, benefits, allowances, and other employment terms shall be
    governed by and aligned with the Company&#39;s applicable policies prevailing at the respective
    location of assignment.
  </p>

  <p style="margin:0 0 12px;">
    Any approval for remote or hybrid working arrangements shall be subject to ongoing performance
    evaluation and business exigencies and shall remain under continuous review. The Company reserves
    the right to modify, suspend, or withdraw such arrangements at any time.
  </p>

  <p style="margin:0 0 12px;">
    By accepting this offer, you hereby irrevocably consent to the foregoing terms and acknowledge
    the Company&#39;s right to assign, transfer, or redeploy you as outlined above.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Compensation and Benefits Salary</h3>
  <p style="margin:0 0 12px;">
    The detailed break-up of your salary and benefits has been set out in Annexure – I and shall be
    governed by the Company&#39;s applicable compensation policies.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Health Insurance</h3>
  <p style="margin:0 0 12px;">
    The Company shall extend group health insurance coverage to you with an
    <strong>annual coverage of INR {{healthCoverAmount}}/- or {{healthCoverAmountAlt}}/-</strong>.
    Such coverage shall become effective from day 1 and shall be governed by the terms, conditions, and
    limitations of the Company&#39;s insurance policy in force from time to time.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Notice Period</h3>
  <p style="margin:0 0 12px;">
    Post confirmation of your employment, either party may terminate this employment by providing
    <strong>{{noticePeriodMonths}} ({{noticePeriodMonths}}) months&#39;</strong> prior written notice.
    You shall be required to serve the full notice period unless otherwise waived or reduced at the
    sole discretion of the Company. During the notice period, you are expected to continue
    discharging your duties diligently and complete all handover and exit formalities.
  </p>

  <p style="margin:0 0 12px;">
    Your salary and any other dues payable during the notice period shall be processed and released
    only upon successful completion of the full notice period and clearance of all exit formalities,
    and shall form part of the full and final settlement letter as per Company policy.
  </p>

  <p style="margin:0 0 12px;">
    In the event that you fail to serve the stipulated notice period in full and/or fail to duly
    complete the handover of all Company property, assets, access credentials, and responsibilities
    to the satisfaction of the Company, no salary, incentives, or other dues shall be payable for the
    notice period, and no relieving letter, experience certificate, or any other employment-related
    documents shall be issued by {{companyName}}. Any amounts otherwise payable to you may be
    offset/adjusted against outstanding obligations, losses, or recoveries, in accordance with
    Company policy and applicable law. The Company reserves the right to take appropriate legal or
    administrative action for recovery of Company assets and dues, as deemed necessary.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Probation Period</h3>
  <p style="margin:0 0 12px;">
    You shall be on probation for a period of
    <strong>{{probationMonths}} ({{probationMonths}}) months</strong> from the date of commencement of
    your employment. The probation period may be extended at the sole discretion of the Company. Upon
    successful completion of the probation period, your employment shall be confirmed in writing on
    company internal tool.
  </p>

  <p style="margin:0 0 12px;">
    During the probation period, either party may terminate this employment by providing
    <strong>{{probationNoticeMonths}} ({{probationNoticeMonths}}) months&#39;</strong> notice. Post
    confirmation, the notice period shall be
    <strong>{{noticePeriodMonths}} ({{noticePeriodMonths}}) months&#39;</strong> written notice.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Resignation, Cost Recovery &amp; Background Verification</h3>
  <p style="margin:0 0 6px;">In the event of voluntary resignation:</p>
  <ul style="margin:0 0 10px; padding-left:20px;">
    <li style="margin-bottom:5px;">
      Within <strong>{{costRecoveryFullMonths}} ({{costRecoveryFullMonths}}) months</strong> from the
      date of joining, you shall be liable to fully reimburse the Company for all costs and expenses
      incurred on you (excluding earned salary).
    </li>
    <li>
      Between <strong>{{costRecoveryFullMonths}} ({{costRecoveryFullMonths}})</strong> and
      <strong>{{costRecoveryHalfMonths}} ({{costRecoveryHalfMonths}}) months</strong> from the date of
      joining, you shall be liable to reimburse
      <strong>{{costRecoveryHalfPercent}} percent ({{costRecoveryHalfPercent}}%)</strong> of such costs
      and expenses (excluding earned salary).
    </li>
  </ul>

  <p style="margin:0 0 12px;">
    This offer and your continued employment are subject to satisfactory background verification and
    reference checks. Any misrepresentation, suppression of facts, or adverse findings may result in
    withdrawal of this offer or termination of your employment. The Company reserves the right to
    require you to undergo a medical examination to confirm your continued fitness, as and when
    considered necessary.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Working Hours</h3>
  <p style="margin:0 0 12px;">
    The work timings are at the sole discretion of the Management and would normally consist of
    <strong>{{monthlyWorkHours}} hours&#39;</strong> work in a month. These are subject to change as per
    business requirements. The general working hours will be <strong>{{workingHoursText}}</strong>,
    except second and fourth Saturday and Sunday. Employees may also be expected to work in shifts
    based on business requirements.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Paid Leave</h3>
  <p style="margin:0 0 12px;">
    Post successful completion of the probation period, you shall be eligible for
    <strong>{{casualLeaveDays}} ({{casualLeaveDays}}) days of Casual Leave</strong> and
    <strong>{{sickLeaveDays}} ({{sickLeaveDays}}) days of Sick Leave</strong> per calendar year, in
    accordance with the Company&#39;s leave policy.
  </p>

  <p style="margin:0 0 12px;">
    Casual Leave and Sick Leave shall not be applicable or permitted during the notice period, and
    any unutilized leave shall not be encashed or adjusted against the notice period unless expressly
    approved in writing by the Management.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Service Commitment &amp; Employee Bond</h3>
  <p style="margin:0 0 12px;">
    In consideration of your appointment, access to proprietary information, client exposure, and any
    training (formal or on-the-job) provided by the Company, you agree to serve {{companyName}} for a
    minimum continuous period of <strong>{{bondMonths}} ({{bondMonths}}) months</strong> from the date
    of joining of your employment. In the event of voluntary resignation, abandonment of employment,
    or termination of services attributable to you prior to completion of the said period, you shall
    be liable to pay the Company a sum of <strong>INR {{liquidatedDamages}}/-</strong> as liquidated
    damages, representing a genuine pre-estimate of costs incurred by the Company. The Company shall
    be entitled to recover the said amount from any dues payable to you or through other lawful means.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Non-Disclosure</h3>
  <p style="margin:0 0 12px;">
    Due to the proprietary nature of our products and services, employee is expected to maintain the
    highest level of confidentiality and will be required to sign an agreement not to disclose any
    information with respect to {{companyName}}.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Business Code of Conduct and Ethics</h3>
  <p style="margin:0 0 12px;">
    Employee is expected to maintain the highest level of ethical conduct and are required to sign our
    Code of Ethical Business Conduct and Conflict of Interest certificate. Any instance of improper
    conduct including but not limited to misconduct, gross negligence or abandonment of the position
    to which you have been appointed shall constitute sufficient grounds for immediate termination of
    your services without any notice.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Information Security</h3>
  <p style="margin:0 0 12px;">
    Employee is required to maintain the confidentiality and integrity of the information assets and
    comply with the Information Security Policies. Employee is expected to maintain confidentiality of
    information residing in mobile computing devices such as portable laptops, notebooks, mouse,
    headphone, pendrive and other equipments provide by company. Employee is responsible for
    maintaining information security outside the premises of the organization and outside the normal
    working hours.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Notice for Termination</h3>
  <p style="margin:0 0 12px;">
    The written notice required for termination of employment will be
    <strong>{{terminationNoticeMonths}} month&#39;s</strong> notice by either party. You would be
    required to serve the stipulated notice period and early release would be at the sole discretion
    of the Management. In case you leave your employment without giving requisite notice, no relieving
    letter will be issued and settlement of dues will be at the sole discretion of the Management.
    However, under {{companyName}} disciplinary procedure, your services can be terminated without any
    notice period.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Service Agreement</h3>
  <p style="margin:0 0 12px;">
    Post your joining, should you accept any specialized training whether in India or abroad, you will
    be required to commit to serve {{companyName}} for a minimum period of
    <strong>{{trainingBondMonths}} months</strong> as per the {{companyName}} policy or depending on
    the training and certification. You will be required to enter into a Service/ Bond Agreement, as per
    {{companyName}}&#39;s policy on Training, supported with a Guarantee in the form and manner decided
    by {{companyName}}. You are under no obligation to accept any training requiring a commitment to
    serve {{companyName}} on your part. However, once accepted by you, this shall constitute a legally
    binding contract. Any termination or breach thereof shall be governed by the terms of the
    applicable Service Agreement, including the penalties stipulated therein. Prior to execution,
    {{companyName}} shall provide you with full clarity and disclosure of the Service Agreement terms.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Exclusive Employment</h3>
  <p style="margin:0 0 12px;">
    You agree that, during the tenure of your employment with the Company, you shall not engage in any
    other employment or association, whether full-time or part-time, including as a director, partner,
    member, consultant, or employee of any other organization or entity engaged in any business
    activity, without the prior written consent of {{companyName}}. Any such consent, if granted, may
    be subject to conditions as deemed appropriate by the Company and may be withdrawn at its sole
    discretion at any time.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Company Policies</h3>
  <p style="margin:0 0 12px;">
    You acknowledge and agree to comply with all internal policies, rules, and procedures of the
    Company, as may be applicable to you from time to time and made available upon joining. These
    policies govern various human resources, administrative, and operational matters. The Company
    reserves the right to amend, modify, or withdraw such policies at its absolute discretion.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Rotational and Shift Work</h3>
  <p style="margin:0 0 12px;">
    Based on the future requirements and the nature of your role, you may be required to work
    rotational or shift-based schedules, including night shifts. Any such change in shift timing shall
    be communicated to you in advance. During such assignments you shall continue to be governed by the
    Company&#39;s working hours policy. Where applicable and in force, the Company&#39;s shift allowance
    policy shall apply.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Entire Agreement</h3>
  <p style="margin:0 0 12px;">
    This offer letter constitutes the entire, final and exclusive agreement between you and the Company
    with respect to the terms of your employment and supersedes all prior or contemporaneous
    discussions, representations, promises, or agreements, whether written or oral. This agreement has
    been entered into without reliance on any representation not expressly set forth herein and may be
    amended only by a written instrument duly executed by an authorized representative of the Company.
  </p>

  <h3 style="font-size:11px; margin:26px 0 9px; color:#111827; text-transform:uppercase; letter-spacing:0.09em; font-weight:700; padding-bottom:5px; border-bottom:1px solid #e5e7eb; text-align:left; page-break-after:avoid; page-break-inside:avoid;">Severability</h3>
  <p style="margin:0 0 12px;">
    If any provision of this offer letter is held to be illegal, invalid, or unenforceable under
    applicable law, such provision shall be deemed severable, and the remaining provisions shall
    continue to be valid, binding, and enforceable to the fullest extent permitted by law.
  </p>

  <p style="margin:0 0 12px;">
    This offer/appointment is subject to the condition that you indemnify and also certify that all the
    information (like educational qualifications, work experience, past salary drawn and all other
    information) supplied by you to {{companyName}} to get an employment with {{companyName}}, is
    accurate and nothing has been given untrue. If it is later found that you had supplied
    inaccurate/incorrect/false information, then {{companyName}} reserves the right to terminate your
    services without any notice and seek appropriate damages or reimbursement of financial expenses
    incurred towards your training, relaxation, any other allowances, etc. This is without prejudice to
    any other rights which {{companyName}} may have against you.
  </p>

  <p style="margin:0 0 12px;">
    {{companyName}} reserves the right to change the terms and the conditions of your employment and
    its policies and procedures at any time.
  </p>

  <p style="margin:0 0 12px;">
    Please sign a duplicate copy of this letter confirming your acceptance of the above terms and
    conditions of appointment and return it to us for office records.
  </p>

  <p style="margin:0 0 26px;">
    We are excited about your decision to join the company and wish you a long, successful career with
    {{companyName}}.
  </p>

  <div style="margin-top:26px; text-align:left; page-break-inside:avoid;">
    <p style="margin:0 0 26px;">Sincerely,</p>
    <div style="display:inline-block; border-top:1px solid #9ca3af; padding-top:6px; min-width:230px;">
      <p style="margin:0; font-weight:700; font-size:11.5px; color:#111827;">Authority Signatory</p>
      <p style="margin:2px 0 0; color:#6b7280; font-size:10.5px;">{{legalEntityName}}</p>
    </div>
  </div>

  <!-- ================= ANNEXURE ================= -->
  <div style="page-break-before: always; padding-top:8px;">
    <div style="border-left:3px solid #ff5500; padding-left:12px; margin-bottom:14px;">
      <h3 style="font-size:13px; margin:0 0 4px; color:#111827; text-transform:uppercase; letter-spacing:0.07em;">Annexure – I</h3>
      <p style="margin:0; color:#6b7280; font-size:10.5px;">
        Salary breakup for <strong style="color:#374151;">{{candidateName}}</strong> — {{jobTitle}}
        &nbsp;·&nbsp; Annual CTC <strong style="color:#374151;">INR {{annualCtc}}/-</strong>
      </p>
    </div>
    {{salaryTable}}
    <p style="margin:12px 0 0; font-size:10px; color:#94a3b8;">
      Statutory deductions (PF / ESIC) are applied as per prevailing government rates and are subject
      to change. Net take-home is indicative and excludes income tax (TDS), which depends on your
      declared investments.
    </p>
  </div>

  <!-- ============ PAN ANNEXURE + ACCEPTANCE ============ -->
  <div style="page-break-before: always; padding-top:8px;">
    <div style="border-left:3px solid #ff5500; padding-left:12px; margin-bottom:16px;">
      <h3 style="font-size:13px; margin:0 0 3px; color:#111827; text-transform:uppercase; letter-spacing:0.07em;">Annexure</h3>
      <p style="margin:0; color:#6b7280; font-size:10.5px;">{{candidateName}}</p>
    </div>

    <p style="margin:0 0 12px;">
      Please note that you must submit a copy of your Permanent Account Number (PAN) card on your date
      of joining at {{companyName}}.
    </p>

    <p style="margin:0 0 40px;">
      By acknowledging this document, you undertake that you shall be solely responsible for any
      consequences arising due to nonsubmission of your PAN copy and {{companyName}} shall not be
      responsible for the same, in any manner whatsoever.
    </p>

    <p style="margin:0 0 26px;">Date:</p>

    <p style="margin:0 0 6px; font-weight:700;">{{candidateName}} &nbsp;&nbsp; Read and accepted</p>
    <div style="border-bottom:1px solid #94a3b8; width:240px; height:42px;"></div>
    <p style="margin:6px 0 0; font-size:10px; color:#94a3b8;">Candidate signature</p>
  </div>

</div>
`.trim();

@Injectable()
export class OfferLettersService {
  private readonly logger = new Logger(OfferLettersService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Recruiter-facing view of the letter. Includes the derived document password so
   * the hiring team can pass it to the candidate — safe here because this endpoint
   * is already behind the authenticated recruitment guard.
   */
  async getForApplication(applicationId: number, companyId: number) {
    const letter = await this.prisma.offerLetter.findFirst({
      where: { applicationId, companyId },
    });
    if (!letter) return null;

    const application = await this.prisma.jobApplication.findUnique({
      where: { id: applicationId },
      select: { fullName: true, phone: true },
    });

    return {
      ...letter,
      signingPath: `/offer/${letter.accessToken}`,
      documentPassword: application ? this.derivePassword(application) : null,
    };
  }

  /** The built-in template, so System Settings can show/seed the editable source. */
  getDefaultTemplateHtml(): string {
    return DEFAULT_OFFER_LETTER_TEMPLATE;
  }

  /** Every merge tag the templates support, grouped for the System Settings UI. */
  getPlaceholderReference() {
    return [
      { group: 'Company', tags: [
        { tag: '{{companyName}}', label: 'Company Name' },
        { tag: '{{legalEntityName}}', label: 'Legal Entity' },
        { tag: '{{cin}}', label: 'CIN Number' },
        { tag: '{{tagline}}', label: 'Tagline' },
        { tag: '{{officeAddress}}', label: 'Office Address' },
        { tag: '{{contactPhone}}', label: 'Contact Phone' },
        { tag: '{{contactEmail}}', label: 'Contact Email' },
        { tag: '{{website}}', label: 'Website' },
      ]},
      { group: 'Candidate', tags: [
        { tag: '{{candidateName}}', label: 'Candidate Name' },
        { tag: '{{candidateAddress}}', label: 'Postal Address' },
        { tag: '{{candidateEmail}}', label: 'Email' },
        { tag: '{{candidatePhone}}', label: 'Phone' },
      ]},
      { group: 'Offer', tags: [
        { tag: '{{jobTitle}}', label: 'Job Title' },
        { tag: '{{offeredSalary}}', label: 'Offered CTC (formatted)' },
        { tag: '{{annualCtc}}', label: 'Annual CTC' },
        { tag: '{{monthlyCtc}}', label: 'Monthly CTC' },
        { tag: '{{issuedDate}}', label: 'Issued Date' },
        { tag: '{{joiningDate}}', label: 'Joining Date' },
        { tag: '{{reportingTime}}', label: 'Reporting Time' },
        { tag: '{{salaryTable}}', label: 'Full Salary Annexure Table' },
      ]},
      { group: 'Policy', tags: [
        { tag: '{{probationMonths}}', label: 'Probation (months)' },
        { tag: '{{probationNoticeMonths}}', label: 'Notice During Probation' },
        { tag: '{{noticePeriodMonths}}', label: 'Notice Period (months)' },
        { tag: '{{terminationNoticeMonths}}', label: 'Termination Notice' },
        { tag: '{{bondMonths}}', label: 'Service Bond (months)' },
        { tag: '{{trainingBondMonths}}', label: 'Training Bond (months)' },
        { tag: '{{liquidatedDamages}}', label: 'Liquidated Damages' },
        { tag: '{{casualLeaveDays}}', label: 'Casual Leave Days' },
        { tag: '{{sickLeaveDays}}', label: 'Sick Leave Days' },
        { tag: '{{workingHoursText}}', label: 'Working Hours' },
        { tag: '{{monthlyWorkHours}}', label: 'Monthly Work Hours' },
        { tag: '{{healthCoverAmount}}', label: 'Health Cover (lower)' },
        { tag: '{{healthCoverAmountAlt}}', label: 'Health Cover (upper)' },
        { tag: '{{costRecoveryFullMonths}}', label: 'Full Cost Recovery (months)' },
        { tag: '{{costRecoveryHalfMonths}}', label: 'Partial Recovery (months)' },
        { tag: '{{costRecoveryHalfPercent}}', label: 'Partial Recovery (%)' },
      ]},
    ];
  }

  /**
   * Renders the company's active template against representative sample data so
   * System Settings can show a true preview — same merge path as a real offer,
   * just without touching any application record.
   */
  async previewTemplate(companyId: number): Promise<{ html: string; header: string; footer: string }> {
    const settings = await this.prisma.systemSetting.findUnique({ where: { companyId } });
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });

    const sample = {
      fullName: 'Saanvi Sharma',
      address: 'B-809, Rajnans Appartment, Ahinsa Khand-1,\nOpposite Aditya Mall, Indirapuram,\nGhaziabad, Uttar Pradesh, 201014',
      email: 'saanvi.sharma@example.com',
      phone: '+91 98765 43210',
      offeredSalary: 300000,
      joiningDate: new Date(Date.now() + 7 * 86400000),
      job: { title: 'Software Engineer', company },
    };

    return this.generateHtmlFromSettings(settings, sample);
  }

  async generate(applicationId: number, companyId: number) {
    const application = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, companyId },
      include: { job: { include: { company: true } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (!['OFFERED', 'HIRED'].includes(application.status)) {
      throw new BadRequestException('An offer letter can only be generated for an OFFERED or HIRED application.');
    }

    const settings = await this.prisma.systemSetting.findUnique({ where: { companyId } });
    const { html, header, footer } = await this.generateHtmlFromSettings(settings, application);

    const { buffer, isPdf } = await this.htmlToPdf(html, header, footer);
    const pdfUrl = await this.uploadPdf(buffer, isPdf, applicationId);

    const accessToken = crypto.randomBytes(24).toString('hex');

    return this.prisma.offerLetter.upsert({
      where: { applicationId },
      create: {
        applicationId,
        companyId,
        status: 'SENT',
        pdfUrl,
        accessToken,
        issuedAt: new Date(),
      },
      update: {
        status: 'SENT',
        pdfUrl,
        accessToken,
        issuedAt: new Date(),
        respondedAt: null,
      },
    });
  }

  // ═══════════════════════════════════════════
  // SIGNING ACCESS (password gate)
  // ═══════════════════════════════════════════

  /**
   * Derives the document password from data already on the application, so it
   * works for candidates who applied before any of this existed:
   *   surname (letters only, lowercased) + last 4 digits of phone
   *   e.g. "Pritish Agnihotri" / "+91 98765 43210"  ->  "agnihotri3210"
   *
   * Returns null when the application lacks the parts needed to form one — the
   * caller then lets the link token alone gate access rather than locking the
   * candidate out of a document they can never open.
   */
  private derivePassword(application: { fullName?: string | null; phone?: string | null }): string | null {
    const nameParts = (application.fullName || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(p => p.replace(/[^a-zA-Z]/g, ''))
      .filter(Boolean);
    const surname = nameParts.length ? nameParts[nameParts.length - 1].toLowerCase() : '';

    const digits = (application.phone || '').replace(/\D/g, '');
    const last4 = digits.length >= 4 ? digits.slice(-4) : '';

    if (!surname || !last4) return null;
    return `${surname}${last4}`;
  }

  /** Normalises candidate input before comparison — spaces and case are forgiven. */
  private normalisePassword(input: string): string {
    return (input || '').replace(/\s+/g, '').toLowerCase();
  }

  /**
   * What the candidate is told to enter, without revealing the answer.
   * Shown on the unlock screen as a hint.
   */
  private passwordHint(application: { fullName?: string | null; phone?: string | null }): string {
    const digits = (application.phone || '').replace(/\D/g, '');
    const masked = digits.length >= 4 ? `••••${digits.slice(-4).replace(/./g, '•')}` : '••••';
    return `Your surname in lowercase, followed by the last 4 digits of your phone number (e.g. surname${masked.slice(-4)})`;
  }

  /** Metadata for the unlock screen — safe to expose without the password. */
  async getAccessInfo(token: string) {
    const letter = await this.prisma.offerLetter.findUnique({
      where: { accessToken: token },
      include: { application: { select: { fullName: true, phone: true, job: { select: { title: true } } } } },
    });
    if (!letter) throw new NotFoundException('Offer letter not found');

    const requiresPassword = this.derivePassword(letter.application) !== null;

    return {
      candidateName: letter.application.fullName,
      jobTitle: letter.application.job?.title,
      status: letter.status,
      requiresPassword,
      passwordHint: requiresPassword ? this.passwordHint(letter.application) : null,
      alreadySigned: letter.status === 'ACCEPTED' || letter.status === 'DECLINED',
    };
  }

  /** Verifies the password and records the unlock on the audit trail. */
  async unlock(token: string, password: string) {
    const letter = await this.prisma.offerLetter.findUnique({
      where: { accessToken: token },
      include: { application: { select: { fullName: true, phone: true } } },
    });
    if (!letter) throw new NotFoundException('Offer letter not found');

    const expected = this.derivePassword(letter.application);

    // No derivable password (missing name or phone) -> the link token is the gate.
    if (expected !== null) {
      if (this.normalisePassword(password) !== expected) {
        await this.prisma.offerLetter.update({
          where: { id: letter.id },
          data: { unlockAttempts: { increment: 1 } },
        });
        throw new BadRequestException('That does not match our records. Please check and try again.');
      }
    }

    await this.prisma.offerLetter.update({
      where: { id: letter.id },
      data: {
        unlockedAt: letter.unlockedAt ?? new Date(),
        viewedAt: letter.viewedAt ?? new Date(),
      },
    });

    return { ok: true };
  }

  /**
   * The rendered document for the signing viewer. Served as HTML (not the PDF)
   * so the client can anchor signature fields onto real DOM nodes — the final
   * signed PDF is still produced server-side from this same template.
   */
  async getSigningDocument(token: string, password: string) {
    const letter = await this.prisma.offerLetter.findUnique({
      where: { accessToken: token },
      include: {
        application: {
          include: { job: { include: { company: true } } },
        },
      },
    });
    if (!letter) throw new NotFoundException('Offer letter not found');

    const expected = this.derivePassword(letter.application);
    if (expected !== null && this.normalisePassword(password) !== expected) {
      throw new BadRequestException('Document is locked.');
    }

    const settings = await this.prisma.systemSetting.findUnique({ where: { companyId: letter.companyId } });
    const { html, header, footer } = await this.generateHtmlFromSettings(
      settings, letter.application, letter.issuedAt || new Date(),
    );

    return {
      html,
      header,
      footer,
      status: letter.status,
      candidateName: letter.application.fullName,
      jobTitle: letter.application.job?.title,
      companyName: letter.application.job?.company?.name,
      signedPdfUrl: letter.countersignedPdfUrl || letter.pdfUrl,
      respondedAt: letter.respondedAt,
    };
  }

  async getByToken(token: string) {
    const letter = await this.prisma.offerLetter.findUnique({
      where: { accessToken: token },
      include: {
        application: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            offeredSalary: true,
            joiningDate: true,
            job: {
              select: {
                title: true,
                type: true,
                workLocationType: true,
                company: {
                  select: {
                    name: true,
                    logoUrl: true,
                    domain: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!letter) throw new NotFoundException('Offer letter not found');
    return letter;
  }

  async respond(
    token: string,
    decision: 'ACCEPTED' | 'DECLINED',
    signatureName?: string,
    ip?: string,
    userAgent?: string,
    signatureImage?: string,
    signatureType?: string,
  ) {
    const letter = await this.prisma.offerLetter.findUnique({ 
      where: { accessToken: token },
      include: { 
        application: { 
          include: { job: { include: { company: true } } } 
        } 
      }
    });
    if (!letter) throw new NotFoundException('Offer letter not found');
    if (letter.status === 'ACCEPTED' || letter.status === 'DECLINED') {
      throw new BadRequestException(`This offer has already been ${letter.status.toLowerCase()}.`);
    }

    if (decision === 'ACCEPTED') {
      if (!signatureName) throw new BadRequestException('A legally binding typed signature is required to accept this offer.');
      
      // Update with signature first
      const updatedLetter = await this.prisma.offerLetter.update({
        where: { id: letter.id },
        data: {
          status: decision,
          respondedAt: new Date(),
          signatureName,
          signatureIp: ip,
          signatureUserAgent: userAgent,
          ...(signatureImage && { signatureImage }),
          ...(signatureType && { signatureType }),
        },
      });

      // Generate Countersigned PDF
      try {
        const settings = await this.prisma.systemSetting.findUnique({ where: { companyId: letter.companyId } });
        const { html, header, footer } = await this.generateHtmlFromSettings(
          settings,
          letter.application,
          letter.issuedAt || new Date(),
        );
        let merged = html;

        // Signature block placed on the document itself, then a separate
        // Certificate of Completion page mirroring what DocuSign issues.
        const sigMark = signatureImage
          ? `<img src="${signatureImage}" style="max-height:56px;max-width:250px;object-fit:contain;" />`
          : `<span style="font-family:'Brush Script MT',cursive;font-size:26px;color:#1e3a8a;">${signatureName}</span>`;

        merged += `
        <div style="page-break-inside:avoid; margin-top:34px; padding-top:18px; border-top:1px solid #e5e7eb; font-family:'Helvetica Neue',Arial,sans-serif; max-width:760px; margin-left:auto; margin-right:auto;">
          <p style="margin:0 0 14px; font-size:11px; color:#6b7280;">Accepted and electronically signed by the candidate:</p>
          <div style="display:inline-block; min-width:260px;">
            <div style="min-height:58px; display:flex; align-items:flex-end;">${sigMark}</div>
            <div style="border-top:1px solid #9ca3af; padding-top:6px; margin-top:4px;">
              <p style="margin:0; font-weight:700; font-size:11.5px; color:#111827;">${signatureName}</p>
              <p style="margin:2px 0 0; font-size:10px; color:#6b7280;">Signed ${updatedLetter.respondedAt?.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            </div>
          </div>
        </div>`;

        merged += this.buildCertificateOfCompletion({
          signatureName,
          signatureMark: sigMark,
          signedAt: updatedLetter.respondedAt,
          issuedAt: letter.issuedAt,
          viewedAt: letter.viewedAt,
          unlockedAt: letter.unlockedAt,
          ip,
          userAgent,
          companyName: letter.application.job.company.name,
          candidateEmail: letter.application.email,
          documentTitle: `Offer of Employment — ${letter.application.job.title}`,
          envelopeId: letter.accessToken,
        });

        const { buffer, isPdf } = await this.htmlToPdf(merged, header, footer);
        const countersignedPdfUrl = await this.uploadPdf(buffer, isPdf, letter.applicationId);

        if (countersignedPdfUrl) {
          await this.prisma.offerLetter.update({
            where: { id: letter.id },
            data: { countersignedPdfUrl }
          });
        }
      } catch (e) {
        this.logger.error('Failed to generate countersigned PDF', e);
      }

      return updatedLetter;
    }

    // Handle Decline
    return this.prisma.offerLetter.update({
      where: { id: letter.id },
      data: { status: decision, respondedAt: new Date() },
    });
  }
  private async generateHtmlFromSettings(
    settings: any,
    application: any,
    issuedDate?: Date,
  ): Promise<{ html: string; header: string; footer: string }> {
    const company = application.job.company;
    const cfg = { ...CONFIG_DEFAULTS, ...((settings?.offerLetterConfig as OfferLetterConfig) || {}) };

    const fmtDate = (d?: Date | null) =>
      d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    const annualCtc = Number(application.offeredSalary) || 0;
    const breakup = annualCtc > 0 ? this.buildSalaryBreakup(annualCtc, cfg) : [];

    // Flat scalars so a .docx template can lay out its own annexure table.
    const salaryFields: Record<string, string> = {};
    breakup.forEach((r, i) => {
      salaryFields[`salaryRow${i + 1}Label`] = r.label;
      salaryFields[`salaryRow${i + 1}Monthly`] = this.inr(r.monthly);
      salaryFields[`salaryRow${i + 1}Annual`] = this.inr(r.annual);
    });

    const fields: Record<string, string> = {
      // Identity
      companyName: company.name,
      legalEntityName: cfg.legalEntityName || company.name,
      cin: cfg.cin || '',
      tagline: cfg.tagline || '',
      officeAddress: cfg.officeAddress || '',
      contactPhone: cfg.contactPhone || '',
      contactEmail: cfg.contactEmail || '',
      website: cfg.website || '',

      // Candidate
      candidateName: application.fullName,
      candidateAddress: application.address || application.currentLocation || '',
      candidateEmail: application.email || '',
      candidatePhone: application.phone || '',

      // Offer
      jobTitle: application.job.title,
      offeredSalary: annualCtc > 0 ? `INR ${this.inr(annualCtc)}/- CTC` : 'as discussed',
      annualCtc: this.inr(annualCtc),
      monthlyCtc: this.inr(annualCtc / 12),
      issuedDate: fmtDate(issuedDate || new Date()),
      // Falls back to a readable phrase so a letter issued before the joining date
      // is agreed still reads correctly ("join on your date of joining at 9:30 AM").
      joiningDate: application.joiningDate ? fmtDate(application.joiningDate) : 'your date of joining',
      reportingTime: cfg.reportingTime,

      // Policy constants
      probationMonths: String(cfg.probationMonths),
      probationNoticeMonths: String(cfg.probationNoticeMonths),
      noticePeriodMonths: String(cfg.noticePeriodMonths),
      terminationNoticeMonths: String(cfg.terminationNoticeMonths),
      bondMonths: String(cfg.bondMonths),
      liquidatedDamages: this.inr(cfg.liquidatedDamages),
      casualLeaveDays: String(cfg.casualLeaveDays),
      sickLeaveDays: String(cfg.sickLeaveDays),
      workingHoursText: cfg.workingHoursText,
      monthlyWorkHours: String(cfg.monthlyWorkHours),
      healthCoverAmount: this.inr(cfg.healthCoverAmount),
      healthCoverAmountAlt: this.inr(cfg.healthCoverAmountAlt),
      costRecoveryFullMonths: String(cfg.costRecoveryFullMonths),
      costRecoveryHalfMonths: String(cfg.costRecoveryHalfMonths),
      costRecoveryHalfPercent: String(cfg.costRecoveryHalfPercent),
      trainingBondMonths: String(cfg.trainingBondMonths),

      ...salaryFields,
    };

    const logoDataUri = await this.getLogoDataUri(company?.logoUrl);
    const header = this.buildHeaderHtml(company, cfg, logoDataUri);
    const footer = this.buildFooterHtml(cfg);

    if (settings?.offerLetterTemplateDocxUrl) {
      try {
        const response = await axios.get(settings.offerLetterTemplateDocxUrl, { responseType: 'arraybuffer' });
        const zip = new PizZip(response.data);
        // Docxtemplater defaults to single-brace {field} delimiters, but the whole
        // product (System Settings help text, the HTML template path) documents
        // {{field}}. Align the .docx engine with that so one syntax works everywhere.
        const doc = new Docxtemplater(zip, {
          paragraphLoop: true,
          linebreaks: true,
          delimiters: { start: '{{', end: '}}' },
        });

        doc.render(fields);
        
        const buf = doc.getZip().generate({ type: 'nodebuffer' });
        const result = await mammoth.convertToHtml({ buffer: buf });
        
        // mammoth emits semantic HTML only — Word headers/footers, fonts and table
        // borders are dropped. The letterhead is re-applied via the Puppeteer header
        // and footer templates so a .docx upload still comes out branded.
        return {
          html: `<div style="font-family: Arial, sans-serif; color: #172b4d; font-size: 12px; line-height: 1.6;">${result.value}</div>`,
          header,
          footer,
        };
      } catch (err) {
        this.logger.error('Failed to process .docx template, falling back to HTML', err);
      }
    }

    const templateHtml = settings?.offerLetterTemplateHtml || DEFAULT_OFFER_LETTER_TEMPLATE;
    const merged = this.mergeTemplate(templateHtml, fields);

    // {{salaryTable}} is HTML, so it is substituted after the plain scalar merge.
    const withTable = merged.replace(
      /{{\s*salaryTable\s*}}/g,
      breakup.length ? this.renderSalaryTable(breakup) : '<p><em>Salary details to be shared separately.</em></p>',
    );

    return { html: withTable, header, footer };
  }

  /**
   * Puppeteer renders headerTemplate/footerTemplate in an isolated context with no
   * network access, so a remote <img src="https://…"> silently fails and shows a
   * broken-image icon on every page. Inlining the logo as a data URI is the only
   * reliable way to get it into the running header. Cached per URL since a single
   * letter render would otherwise refetch it, and it rarely changes.
   */
  private logoCache = new Map<string, string | null>();

  private async getLogoDataUri(logoUrl?: string | null): Promise<string | null> {
    if (!logoUrl) return null;
    if (logoUrl.startsWith('data:')) return logoUrl;      // already inlined
    if (this.logoCache.has(logoUrl)) return this.logoCache.get(logoUrl)!;

    try {
      const res = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 8000 });
      const mime = res.headers['content-type'] || 'image/png';
      const dataUri = `data:${mime};base64,${Buffer.from(res.data).toString('base64')}`;
      this.logoCache.set(logoUrl, dataUri);
      return dataUri;
    } catch (err: any) {
      // Non-fatal: the header falls back to the company name in text.
      this.logger.warn(`Could not inline company logo for the offer letter header: ${err.message}`);
      this.logoCache.set(logoUrl, null);
      return null;
    }
  }

  /**
   * Certificate of Completion — the audit page an e-sign platform appends after
   * signing. Records the envelope id, the signer, their adopted signature, and
   * the timestamped event history (sent → opened → signed) with IP and device.
   */
  private buildCertificateOfCompletion(d: {
    signatureName?: string;
    signatureMark: string;
    signedAt?: Date | null;
    issuedAt?: Date | null;
    viewedAt?: Date | null;
    unlockedAt?: Date | null;
    ip?: string;
    userAgent?: string;
    companyName: string;
    candidateEmail?: string | null;
    documentTitle: string;
    envelopeId: string;
  }): string {
    const ts = (v?: Date | null) =>
      v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

    const event = (label: string, when?: Date | null, detail = '') => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#111827;white-space:nowrap;">${label}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#374151;white-space:nowrap;">${ts(when)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;">${detail}</td>
      </tr>`;

    const meta = (label: string, value: string) => `
      <tr>
        <td style="padding:7px 0;color:#6b7280;width:150px;vertical-align:top;">${label}</td>
        <td style="padding:7px 0;color:#111827;font-weight:600;word-break:break-word;">${value || '—'}</td>
      </tr>`;

    return `
    <div style="page-break-before:always; font-family:'Helvetica Neue',Arial,sans-serif; max-width:760px; margin:0 auto; color:#1f2937; font-size:11px;">

      <div style="border-left:3px solid #ff5500; padding-left:12px; margin-bottom:18px;">
        <h3 style="font-size:13px; margin:0 0 3px; color:#111827; text-transform:uppercase; letter-spacing:0.07em;">Certificate of Completion</h3>
        <p style="margin:0; color:#6b7280; font-size:10.5px;">Electronic signature audit record</p>
      </div>

      <table style="width:100%; border-collapse:collapse; margin-bottom:20px; font-size:10.5px;">
        ${meta('Envelope ID', d.envelopeId)}
        ${meta('Document', d.documentTitle)}
        ${meta('Issued by', d.companyName)}
        ${meta('Signer', `${d.signatureName || '—'}${d.candidateEmail ? ` &lt;${d.candidateEmail}&gt;` : ''}`)}
        ${meta('Status', 'Completed — signed and accepted')}
      </table>

      <div style="border:1px solid #e5e7eb; border-radius:6px; padding:14px 16px; margin-bottom:20px; page-break-inside:avoid;">
        <p style="margin:0 0 10px; font-size:9.5px; text-transform:uppercase; letter-spacing:0.07em; color:#6b7280; font-weight:700;">Adopted signature</p>
        <div style="min-height:56px; display:flex; align-items:flex-end;">${d.signatureMark}</div>
        <div style="border-top:1px solid #d1d5db; margin-top:6px; padding-top:6px;">
          <p style="margin:0; font-weight:700; color:#111827;">${d.signatureName || ''}</p>
        </div>
      </div>

      <p style="margin:0 0 8px; font-size:9.5px; text-transform:uppercase; letter-spacing:0.07em; color:#6b7280; font-weight:700;">Event history</p>
      <table style="width:100%; border-collapse:collapse; border:1px solid #e5e7eb; font-size:10.5px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:9px 12px;text-align:left;border-bottom:2px solid #ff5500;font-size:9.5px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Event</th>
            <th style="padding:9px 12px;text-align:left;border-bottom:2px solid #ff5500;font-size:9.5px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Timestamp</th>
            <th style="padding:9px 12px;text-align:left;border-bottom:2px solid #ff5500;font-size:9.5px;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Details</th>
          </tr>
        </thead>
        <tbody>
          ${event('Envelope sent', d.issuedAt, 'Offer letter issued to candidate')}
          ${event('Identity verified', d.unlockedAt, 'Document password accepted')}
          ${event('Document viewed', d.viewedAt, 'Opened in signing session')}
          ${event('Signed &amp; accepted', d.signedAt, `IP ${d.ip || 'unknown'}`)}
        </tbody>
      </table>

      <p style="margin:14px 0 0; font-size:9px; color:#9ca3af; line-height:1.6;">
        Signing device: ${d.userAgent || 'Unknown'}
      </p>
      <p style="margin:8px 0 0; font-size:9px; color:#9ca3af; line-height:1.6;">
        This certificate is generated by ${d.companyName} and forms part of the signed record. The
        electronic signature above was applied by the named signer and is legally binding.
      </p>
    </div>`;
  }

  private buildHeaderHtml(company: any, cfg: any, logoDataUri?: string | null): string {
    const logo = logoDataUri
      ? `<img src="${logoDataUri}" style="height:38px;object-fit:contain;" />`
      : `<span style="font-size:15px;font-weight:700;color:#0f172a;">${company?.name || ''}</span>`;

    return `<div style="width:100%;font-family:Arial,sans-serif;padding:0 10mm;box-sizing:border-box;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #ff5500;padding-bottom:7px;">
        <div>${logo}</div>
        <div style="font-size:8px;color:#9ca3af;text-align:right;letter-spacing:0.04em;">${cfg.tagline || ''}</div>
      </div>
    </div>`;
  }

  private buildFooterHtml(cfg: any): string {
    const line1 = [cfg.legalEntityName, cfg.cin ? `CIN No. ${cfg.cin}` : '']
      .filter(Boolean)
      .join('&nbsp;&nbsp;|&nbsp;&nbsp;');
    const line2 = [cfg.contactPhone, cfg.website, cfg.contactEmail].filter(Boolean).join('&nbsp;&nbsp;|&nbsp;&nbsp;');

    return `<div style="width:100%;font-family:Arial,sans-serif;padding:0 10mm;box-sizing:border-box;font-size:7.5px;color:#475569;">
      <div style="border-top:1px solid #cbd5e1;padding-top:5px;text-align:center;">
        <div style="font-weight:700;">${line1}</div>
        <div style="margin-top:2px;">${line2}</div>
        <div style="margin-top:2px;color:#94a3b8;">${cfg.officeAddress || ''}</div>
        <div style="margin-top:3px;color:#94a3b8;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
      </div>
    </div>`;
  }
  private mergeTemplate(html: string, fields: Record<string, string>): string {
    let out = html;
    for (const [key, value] of Object.entries(fields)) {
      out = out.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value);
    }
    return out;
  }

  private inr(n: number): string {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
  }

  /**
   * Derives the full CTC → net-take-home breakup shown in the offer letter annexure.
   *
   * Balancing works the way payroll sheets do: Gross is whatever remains of CTC after
   * the employer's PF contribution, and "Other Allowance" absorbs the difference so the
   * component rows always sum exactly to Gross.
   */
  private buildSalaryBreakup(annualCtc: number, cfg: Required<OfferLetterConfig> | any): SalaryRow[] {
    const monthlyCtc = annualCtc / 12;

    const basic = monthlyCtc * (cfg.basicPercentOfCtc / 100);
    const hra = basic * (cfg.hraPercentOfBasic / 100);
    const ta = cfg.travellingAllowance;
    const medical = cfg.medicalAllowance;

    const employerPf = cfg.pfBase * (cfg.pfPercent / 100);
    const employerEsic = basic * (cfg.employerEsicPercent / 100);

    const gross = monthlyCtc - employerPf;
    const other = gross - basic - hra - ta - medical;

    const employeePf = cfg.pfBase * (cfg.pfPercent / 100);
    const employeeEsic = basic * (cfg.employeeEsicPercent / 100);
    const net = gross - employeePf - employeeEsic;

    const row = (label: string, monthly: number, opts: Partial<SalaryRow> = {}): SalaryRow => ({
      label,
      monthly,
      annual: monthly * 12,
      ...opts,
    });

    return [
      row('CTC', monthlyCtc, { emphasis: true }),
      row(`Employer PF (${cfg.pfPercent}% of PF Base)`, employerPf),
      row(`Employer ESIC (${cfg.employerEsicPercent}%)`, employerEsic, { group: true }),
      row(`Basic Salary (${cfg.basicPercentOfCtc}% of CTC)`, basic),
      row(`House Rent Allowance – HRA (${cfg.hraPercentOfBasic}% of Basic)`, hra),
      row('Travelling Allowance', ta),
      row('Medical Allowance', medical),
      row('Other Allowance (Balancing)', other),
      row('Gross Salary', gross, { emphasis: true, group: true }),
      row(`Employee PF (${cfg.pfPercent}% of PF Base)`, employeePf),
      row(`Employee ESIC (${cfg.employeeEsicPercent}%)`, employeeEsic),
      row('Net Take Home Salary', net, { emphasis: true }),
    ];
  }

  private renderSalaryTable(rows: SalaryRow[]): string {
    const body = rows
      .map((r, i) => {
        // Emphasis rows (CTC / Gross / Net) get a tinted band; the rest alternate
        // subtly so long numeric columns stay easy to track across.
        const bg = r.emphasis ? 'background:#fff7ed;' : (i % 2 ? 'background:#fafafa;' : '');
        const weight = r.emphasis ? 'font-weight:700;color:#111827;' : 'color:#374151;';
        const border = r.group
          ? 'border-bottom:1.5px solid #d1d5db;'
          : 'border-bottom:1px solid #f3f4f6;';
        const num = 'text-align:right;font-variant-numeric:tabular-nums;';
        return `<tr style="${bg}">
          <td style="padding:8px 12px;${border}${weight}">${r.label}</td>
          <td style="padding:8px 12px;${border}${weight}${num}">${this.inr(r.monthly)}</td>
          <td style="padding:8px 12px;${border}${weight}${num}">${this.inr(r.annual)}</td>
        </tr>`;
      })
      .join('');

    const th = 'padding:9px 12px;border-bottom:2px solid #ff5500;font-size:9.5px;'
      + 'text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;font-weight:700;';

    return `<table style="width:100%;border-collapse:collapse;font-size:10.5px;margin-top:12px;
        border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;page-break-inside:avoid;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="${th}text-align:left;">Component</th>
          <th style="${th}text-align:right;width:105px;">Monthly (₹)</th>
          <th style="${th}text-align:right;width:105px;">Annual (₹)</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  private async htmlToPdf(
    htmlContent: string,
    header?: string,
    footer?: string,
  ): Promise<{ buffer: Buffer; isPdf: boolean }> {
    const hasChrome = !!(header || footer);
    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: hasChrome,
        headerTemplate: header || '<span></span>',
        footerTemplate: footer || '<span></span>',
        // Extra top/bottom room so the repeating letterhead and footer bar don't
        // collide with body copy. Without header/footer the original 10mm applies.
        margin: hasChrome
          ? { top: '26mm', right: '12mm', bottom: '24mm', left: '12mm' }
          : { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });
      await browser.close();
      return { buffer: Buffer.from(pdfBuffer), isPdf: true };
    } catch (e) {
      // Degrading to raw HTML silently produced files named "offer-letter-*.html".
      // Keep the fallback (better than losing the offer) but log it as an error and
      // inline the letterhead so the artifact is still presentable.
      this.logger.error(
        'Puppeteer unavailable — offer letter falling back to HTML instead of PDF. ' +
          'Install puppeteer to restore PDF output.',
        e instanceof Error ? e.stack : String(e),
      );
      const inlined = `${header || ''}${htmlContent}${footer || ''}`;
      return { buffer: Buffer.from(inlined, 'utf-8'), isPdf: false };
    }
  }

  private async uploadPdf(buffer: Buffer, isPdf: boolean, applicationId: number): Promise<string | null> {
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
      this.logger.warn('ImageKit not configured; offer letter PDF will not be persisted to a URL');
      return null;
    }

    try {
      const filename = `offer-letter-${applicationId}-${Date.now()}.${isPdf ? 'pdf' : 'html'}`;
      const form = new FormData();
      form.append('file', buffer.toString('base64'));
      form.append('fileName', filename);
      form.append('folder', '/offer_letters');

      const authHeader = 'Basic ' + Buffer.from(privateKey + ':').toString('base64');
      const response = await axios.post('https://upload.imagekit.io/api/v1/files/upload', form, {
        headers: { ...form.getHeaders(), Authorization: authHeader },
      });
      return response.data.url;
    } catch (error: any) {
      this.logger.error('Failed to upload offer letter PDF', error.response?.data || error.message);
      return null;
    }
  }
}
