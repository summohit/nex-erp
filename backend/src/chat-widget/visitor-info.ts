import * as geoip from 'geoip-lite';

/**
 * Visitor details for Website Chat (22 Oct 2026), like Tawk.to shows: where
 * they are (from their IP, looked up offline in the bundled GeoLite2 data, so
 * no visitor IP leaves our server) and what the widget reports about their
 * visit — timezone, language, screen, campaign tags, visits, pages this visit.
 */

/** The visitor's IP as nginx passed it on, else the socket's. */
export function clientIp(req: any): string | null {
  const real = String(req?.headers?.['x-real-ip'] ?? '').trim();
  const fwd = String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
  const ip = (real || fwd || req?.ip || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return ip ? ip.slice(0, 45) : null;
}

export function geoFromIp(ip: string | null): { city: string | null; region: string | null; country: string | null } {
  const g = ip ? geoip.lookup(ip) : null;
  return { city: g?.city || null, region: g?.region || null, country: g?.country || null };
}

const str = (v: any, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: any, max: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Math.round(Number(v)), max) : null);

/** The widget's `context`, trimmed to what we keep. Missing fields are left out. */
export function visitorContext(ctx: any): Record<string, any> {
  if (!ctx || typeof ctx !== 'object') return {};
  const out: Record<string, any> = {};
  const tz = str(ctx.timezone, 64); if (tz) out.visitorTimezone = tz;
  const lang = str(ctx.language, 20); if (lang) out.language = lang;
  const screen = str(ctx.screen, 20); if (screen) out.screen = screen;
  const visits = int(ctx.visitCount, 100000); if (visits !== null) out.visitCount = visits;
  const secs = int(ctx.secondsOnSite, 86400 * 7); if (secs !== null) out.secondsOnSite = secs;
  if (ctx.utm && typeof ctx.utm === 'object') {
    const utm: Record<string, string> = {};
    for (const k of ['source', 'medium', 'campaign', 'term', 'content']) { const v = str(ctx.utm[k], 120); if (v) utm[k] = v; }
    if (Object.keys(utm).length) out.utm = utm;
  }
  if (Array.isArray(ctx.pages)) {
    const pages = ctx.pages.slice(-30).map((p: any) => ({ url: str(p?.url, 500), title: str(p?.title, 200), at: str(p?.at, 40) })).filter((p: any) => p.url);
    if (pages.length) out.pages = pages;
  }
  return out;
}
