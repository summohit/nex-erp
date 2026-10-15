/** Labels and formatting shared by the field visit screens, matching the web. */

export const FV_STATUS: Record<string, { label: string; bg: string; fg: string; border: string; dot: string }> = {
  DRAFT: { label: 'Draft', bg: '#F8FAFC', fg: '#475569', border: '#E2E8F0', dot: '#94A3B8' },
  PENDING_APPROVAL: { label: 'Waiting approval', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', dot: '#F59E0B' },
  APPROVED: { label: 'Approved', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', dot: '#22C55E' },
  REJECTED: { label: 'Rejected', bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA', dot: '#EF4444' },
  CANCELLED: { label: 'Cancelled', bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0', dot: '#94A3B8' },
  COMPLETED: { label: 'Completed', bg: '#EEF2FF', fg: '#4338CA', border: '#C7D2FE', dot: '#6366F1' },
};
export const fvStatus = (s: string) => FV_STATUS[s] || FV_STATUS.DRAFT;

export const initials = (p?: { firstName?: string | null; lastName?: string | null } | null) => {
  if (!p) return 'FV';
  const f = p.firstName ? p.firstName[0] : '';
  const l = p.lastName ? p.lastName[0] : '';
  return (f + l).toUpperCase() || (p.firstName ? p.firstName.slice(0, 2).toUpperCase() : 'FV');
};

/** Timeline actions, for an entry the server did not describe in words. */
export const FV_ACTIVITY: Record<string, string> = {
  CREATED: 'Created',
  UPDATED: 'Edited',
  SUBMITTED: 'Submitted for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn to draft',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Marked complete',
  STATUS_CHANGED: 'Status changed',
  MODIFICATION_REQUESTED: 'Change requested',
  MODIFICATION_APPROVED: 'Change approved',
  MODIFICATION_REJECTED: 'Change rejected',
  MEMBER_ON_LEAVE: 'Member on leave',
  MEMBER_HALF_DAY: 'Member on half day',
};

/** Visit dates are stored as UTC midnight; read them as the calendar day they name. */
export const dateLabel = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "14:30" → "2:30 PM". */
export const timeLabel = (t?: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

/** A clock-in instant as IST wall time. */
export const clockAt = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';

/** When something happened, for the timeline. */
export const whenLabel = (d: string) =>
  new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const range = (r: { startDate: string; endDate: string }) =>
  r.startDate.slice(0, 10) === r.endDate.slice(0, 10) ? dateLabel(r.startDate) : `${dateLabel(r.startDate)} → ${dateLabel(r.endDate)}`;

export const who = (p?: { firstName: string; lastName?: string | null } | null) =>
  (p ? `${p.firstName} ${p.lastName || ''}`.trim() : '');

export const metres = (km?: number | null) =>
  (km == null ? '' : km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`);

export const mapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
