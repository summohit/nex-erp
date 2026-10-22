/**
 * Website Chat office hours. Stored per widget as
 *   { enabled, timezone, days: { mon: { open: "09:30", close: "18:30" } | null, … } }
 * A missing or disabled schedule means the team is always "online".
 */

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayKey = (typeof DAY_KEYS)[number];

export interface OfficeHours {
  enabled: boolean;
  timezone: string;
  days: Partial<Record<DayKey, { open: string; close: string } | null>>;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_LABEL: Record<DayKey, string> = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };

/** Validate what the admin sent; anything malformed is dropped rather than stored. */
export function cleanOfficeHours(raw: any): OfficeHours | null {
  if (!raw || typeof raw !== 'object') return null;
  let timezone = typeof raw.timezone === 'string' ? raw.timezone.slice(0, 60) : 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    timezone = 'Asia/Kolkata';
  }
  const days: OfficeHours['days'] = {};
  for (const d of DAY_KEYS) {
    const v = raw.days?.[d];
    days[d] = v && TIME.test(v.open) && TIME.test(v.close) && v.open < v.close ? { open: v.open, close: v.close } : null;
  }
  return { enabled: !!raw.enabled, timezone, days };
}

/** Weekday key and "HH:mm" for `now` in the schedule's timezone. */
function localNow(timezone: string, now: Date): { day: DayKey; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: get('weekday').toLowerCase().slice(0, 3) as DayKey, time: `${get('hour')}:${get('minute')}` };
}

function label12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Is the team in office right now, and if not, when are they back
 * ("today at 9:30 AM", "Mon at 9:30 AM")? Null schedule → always online.
 */
export function officeStatus(hours: OfficeHours | null, now = new Date()): { online: boolean; backAt: string | null } {
  if (!hours?.enabled) return { online: true, backAt: null };
  const { day, time } = localNow(hours.timezone, now);
  const today = hours.days[day];
  if (today && time >= today.open && time < today.close) return { online: true, backAt: null };
  if (today && time < today.open) return { online: false, backAt: `today at ${label12(today.open)}` };
  const start = DAY_KEYS.indexOf(day);
  for (let i = 1; i <= 7; i++) {
    const key = DAY_KEYS[(start + i) % 7];
    const slot = hours.days[key];
    if (slot) return { online: false, backAt: `${i === 1 ? 'tomorrow' : DAY_LABEL[key]} at ${label12(slot.open)}` };
  }
  // Enabled but no day has hours: treat as offline with no return time.
  return { online: false, backAt: null };
}
