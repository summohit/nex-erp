import {
  DOCUMENT_HINTS, OPTIONAL_DOCUMENTS, PREVIOUS_EMPLOYMENT_DOCUMENTS, REQUIRED_DOCUMENTS,
} from './profile-documents';

/**
 * Which documents are required, set by HR / Super Admin in Settings (16 Nov
 * 2026). One list drives the onboarding checklist, the profile reminder, HR's
 * report and every upload dropdown. Stored on SystemSetting.documentPolicy;
 * null means the built-in defaults below (the rules as they were before).
 */
export type DocRequirement = 'ALL' | 'EXPERIENCED' | 'OPTIONAL';

export interface DocumentRule {
  type: string;
  /** ALL = everyone; EXPERIENCED = not interns, not a first job; OPTIONAL = never required. */
  required: DocRequirement;
  /** How many files of this type make it complete (e.g. Aadhaar front + back = 2). */
  count: number;
  /** Shown to the employee under the name, e.g. "Last 3 months' payslips". */
  hint?: string;
  /** Off = hidden from upload lists and never required; kept so old files keep their type. */
  active: boolean;
}

export const DEFAULT_DOCUMENT_POLICY: DocumentRule[] = [
  ...REQUIRED_DOCUMENTS.map((t) => ({ type: t, required: 'ALL' as const })),
  ...PREVIOUS_EMPLOYMENT_DOCUMENTS.map((t) => ({ type: t, required: 'EXPERIENCED' as const })),
  ...OPTIONAL_DOCUMENTS.filter((t) => t !== 'Other').map((t) => ({ type: t, required: 'OPTIONAL' as const })),
].map((r) => ({ ...r, count: 1, active: true, ...(DOCUMENT_HINTS[r.type] ? { hint: DOCUMENT_HINTS[r.type] } : {}) }));

/** Cleans what was stored or sent; anything unreadable falls back to the defaults. */
export function normaliseDocumentPolicy(raw: unknown): DocumentRule[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_DOCUMENT_POLICY;
  const seen = new Set<string>();
  const out: DocumentRule[] = [];
  for (const r of raw as any[]) {
    const type = String(r?.type ?? '').trim().slice(0, 80);
    if (!type || type.toLowerCase() === 'other' || seen.has(type.toLowerCase())) continue;
    seen.add(type.toLowerCase());
    const required: DocRequirement = ['ALL', 'EXPERIENCED', 'OPTIONAL'].includes(r?.required) ? r.required : 'OPTIONAL';
    const count = Math.min(10, Math.max(1, Math.floor(Number(r?.count) || 1)));
    const hint = String(r?.hint ?? '').trim().slice(0, 120);
    out.push({ type, required, count, active: r?.active !== false, ...(hint ? { hint } : {}) });
  }
  return out.length ? out : DEFAULT_DOCUMENT_POLICY;
}

export async function loadDocumentPolicy(prisma: any, companyId: number): Promise<DocumentRule[]> {
  const row = await prisma.systemSetting.findUnique({ where: { companyId }, select: { documentPolicy: true } });
  return normaliseDocumentPolicy(row?.documentPolicy);
}

/** The rules that apply to this person. */
export function requiredRulesFor(policy: DocumentRule[], who: { intern: boolean; firstJob: boolean }): DocumentRule[] {
  return policy.filter((r) => r.active && (r.required === 'ALL' || (r.required === 'EXPERIENCED' && !who.intern && !who.firstJob)));
}

/** Each required rule with how many files are on file, and whether that is enough. */
export function documentProgress(
  rules: DocumentRule[],
  documents: { documentType?: string | null }[],
  /** Types the Super Admin waived for this person (approved DocumentWaiver). */
  waived: Iterable<string> = [],
) {
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d.documentType ?? '', (counts.get(d.documentType ?? '') ?? 0) + 1);
  const waivedSet = new Set(waived);
  return rules.map((r) => {
    const have = counts.get(r.type) ?? 0;
    const isWaived = waivedSet.has(r.type);
    return { ...r, have, waived: isWaived, done: isWaived || have >= r.count };
  });
}

/** Upload dropdown order: active types, then "Other" last. */
export function uploadTypes(policy: DocumentRule[]): string[] {
  return [...policy.filter((r) => r.active).map((r) => r.type), 'Other'];
}
