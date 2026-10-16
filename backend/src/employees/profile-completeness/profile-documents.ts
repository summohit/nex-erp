/**
 * The documents and details HR asks every employee to have on file (HR's
 * notice of 15 Oct 2026, settled with the product owner on 16 Oct). One
 * list, so the reminder, HR's report and the upload dropdowns cannot
 * disagree about what "complete" means.
 */

/** Required of everyone (except the exempt accounts). */
export const REQUIRED_DOCUMENTS = [
  'Resume / CV',
  'Aadhaar Card',
  'PAN Card',
  'Passport Size Photo',
  '10th Marksheet',
  '12th Marksheet',
  'Graduation Degree',
  'Bank Proof / Cancelled Cheque',
  'Reference Person',
] as const;

/** Required only of people with a previous employer: not interns, not a first job. */
export const PREVIOUS_EMPLOYMENT_DOCUMENTS = [
  'UAN',
  'Relieving / Experience Letter',
  'Payslips',
] as const;

/** Offered in the upload list, never required. */
export const OPTIONAL_DOCUMENTS = [
  'Passport',
  'Post-Graduation Degree',
  'Driving License / Voter ID',
  'Educational Certificate',
  'Form 16 / Tax Proof',
  'Other',
] as const;

/** Every document type, in the order the upload dropdown shows them. */
export const ALL_DOCUMENT_TYPES = [...REQUIRED_DOCUMENTS, ...PREVIOUS_EMPLOYMENT_DOCUMENTS, ...OPTIONAL_DOCUMENTS];

/** What each required type means, for the reminder. */
export const DOCUMENT_HINTS: Record<string, string> = {
  'Payslips': 'Salary slip from your previous employer (one file)',
  'UAN': 'Your UAN number (screenshot or document)',
  'Reference Person': 'Details of a professional reference',
  'Bank Proof / Cancelled Cheque': 'Cancelled cheque or bank proof',
};

/** Accounts the reminder never applies to (HR's instruction, 16 Oct 2026). */
export const EXEMPT_EMAILS = new Set([
  'shailab@ces-pl.com',
  'info@ces-pl.com',
  'surajs@ces-pl.com',
  'hr@ces-pl.com',
]);

/** Interns sit outside previous-employment documents: employment type or designation. */
export function isIntern(employmentType?: string | null, designation?: string | null): boolean {
  return /intern/i.test(employmentType ?? '') || /intern/i.test(designation ?? '');
}
