import { BadRequestException } from '@nestjs/common';

/**
 * "Edit & approve": an administrator changes a request and approves it in one
 * step. Their edit IS the decision — sending it to a second approver would only
 * add a wait with nobody above them to answer it.
 *
 * What keeps that safe is the record, not another approval: the requested
 * values are never lost, because every edit is written to AuditLog with the
 * value before and after, who made it and why.
 *
 * AuditLog.actorId holds the EMPLOYEE id of the administrator here.
 */
export const APPROVAL_EDIT_ACTION = 'APPROVAL_EDITED';

export type ApprovalEditEntity =
  | 'TaskHoursRequest'
  | 'ProjectBudgetRequest'
  | 'ProjectScopeRequest'
  | 'Issue'
  | 'VisitLocationRequest'
  | 'FieldVisitRequest';

/** Only the fields that actually moved, as { field: { from, to } }. */
export function diffFields(
  before: Record<string, any>,
  after: Record<string, any>,
): Record<string, { from: any; to: any }> {
  const out: Record<string, { from: any; to: any }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (a !== b) out[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return out;
}

function normalise(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Write the edit to the audit log. A no-op when nothing changed, so "Edit &
 * approve" with untouched values reads exactly like a plain approval.
 */
export async function recordApprovalEdit(
  tx: any,
  args: {
    companyId: number;
    actorEmployeeId: number | null;
    entityType: ApprovalEditEntity;
    entityId: number;
    changes: Record<string, { from: any; to: any }>;
    reason?: string | null;
  },
) {
  const fields = Object.keys(args.changes);
  if (!fields.length) return null;
  return tx.auditLog.create({
    data: {
      companyId: args.companyId,
      actorId: args.actorEmployeeId,
      action: APPROVAL_EDIT_ACTION,
      entityType: args.entityType,
      entityId: String(args.entityId),
      oldValue: Object.fromEntries(fields.map((f) => [f, args.changes[f].from])),
      newValue: {
        ...Object.fromEntries(fields.map((f) => [f, args.changes[f].to])),
        _reason: args.reason?.trim() || null,
      },
    },
  });
}

/**
 * A changed value needs a reason, so the requester can read why their request
 * was approved differently from how they asked.
 */
export function requireEditReason(changes: Record<string, unknown>, reason?: string | null) {
  if (Object.keys(changes).length && !reason?.trim()) {
    throw new BadRequestException('Say why you changed the request before approving it.');
  }
}

/** "hours 2 → 1.5, due date 05 Oct → 08 Oct" for notifications. */
export function describeChanges(
  changes: Record<string, { from: any; to: any }>,
  labels: Record<string, string> = {},
): string {
  const fmt = (v: any) => {
    if (v == null || v === '') return '—';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
    const s = String(v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 40 ? `${s.slice(0, 37)}…` : s;
  };
  return Object.entries(changes)
    .map(([k, c]) => `${labels[k] ?? k} ${fmt(c.from)} → ${fmt(c.to)}`)
    .join(', ');
}
