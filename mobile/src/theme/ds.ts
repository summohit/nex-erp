/**
 * MIRA mobile design system, taken from the redesigned Timesheet screen
 * (ESS → Timesheets, Oct 2026). New and redesigned screens build on these
 * tokens so they look like one app.
 *
 * Look: slate neutrals, one blue accent (#1373E5), a navy→blue gradient hero
 * per screen, white cards with a hairline border and a very soft shadow,
 * heavy weights (800/900) for numbers and titles, pills for every status.
 */
import { StyleSheet } from 'react-native';

export const colors = {
  // Brand
  primary: '#1373E5',
  primaryDeep: '#1D4ED8',
  primarySoft: '#EFF6FF',
  primaryBorder: '#BFDBFE',
  primaryRing: '#93C5FD',

  // Hero gradient (top-left → bottom-right) and its decorative circles
  heroFrom: '#0F172A',
  heroVia: '#1E3A8A',
  heroTo: '#1373E5',
  heroGlow: '#38BDF8',
  heroTextSoft: '#BAE6FD',
  heroTextMuted: 'rgba(224, 242, 254, 0.85)',
  heroOverline: 'rgba(186, 230, 253, 0.85)',
  glassBg: 'rgba(255, 255, 255, 0.1)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',

  // Neutrals (slate)
  bg: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  borderSoft: '#F1F5F9',
  track: '#E2E8F0',
  text: '#0F172A',
  textBody: '#334155',
  textSecondary: '#475569',
  textMuted: '#64748B',
  textFaint: '#94A3B8',
  shadow: '#0F172A',
};

/** Every status pill: text/icon colour, fill, border. */
export const status = {
  success: { fg: '#10B981', strong: '#047857', bg: '#ECFDF5', border: '#A7F3D0' },
  warning: { fg: '#D97706', strong: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  danger: { fg: '#EF4444', strong: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  violet: { fg: '#7C3AED', strong: '#6D28D9', bg: '#F3E8FF', border: '#DDD6FE' },
  info: { fg: '#0284C7', strong: '#0369A1', bg: '#F0F9FF', border: '#BAE6FD' },
  teal: { fg: '#0D9488', strong: '#0F766E', bg: '#F0FDFA', border: '#99F6E4' },
  neutral: { fg: '#64748B', strong: '#475569', bg: '#F1F5F9', border: '#E2E8F0' },
};

/** Type scale: [size, weight]. Numbers use tabular figures. */
export const type = {
  heroNumber: { fontSize: 30, fontWeight: '900' as const, fontVariant: ['tabular-nums' as const] },
  statNumber: { fontSize: 16, fontWeight: '900' as const, fontVariant: ['tabular-nums' as const] },
  cardTitle: { fontSize: 15, fontWeight: '800' as const },
  itemTitle: { fontSize: 14.5, fontWeight: '800' as const },
  body: { fontSize: 13, fontWeight: '500' as const },
  meta: { fontSize: 12.5, fontWeight: '700' as const },
  hint: { fontSize: 11.5, fontWeight: '500' as const },
  pill: { fontSize: 11, fontWeight: '800' as const },
  overline: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.7 },
};

export const space = { xs: 4, sm: 6, md: 8, lg: 10, xl: 12, xxl: 14, page: 16, hero: 18 };

export const radius = { xs: 6, sm: 8, md: 10, lg: 12, xl: 14, card: 18, section: 22, hero: 24, pill: 999 };

export const shadow = {
  hero: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 16, elevation: 5 },
  card: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  raised: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
};

/** Shared building blocks. Compose with `[ds.card, local]`. */
export const ds = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  pageContent: { padding: space.page, paddingBottom: 110 },

  // Hero: gradient card at the top of a screen (draw the gradient with react-native-svg)
  hero: { borderRadius: radius.hero, overflow: 'hidden', marginBottom: space.page, ...shadow.hero },
  heroInner: { padding: space.hero },
  heroOverline: { ...type.overline, color: colors.heroOverline, marginBottom: 2 },
  heroNumber: { ...type.heroNumber, color: '#FFFFFF' },
  heroUnit: { fontSize: 14, fontWeight: '700', color: colors.heroTextSoft },
  heroStrip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.glassBg,
    borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.14)', borderRadius: 16, paddingVertical: space.lg,
  },
  heroStatCol: { flex: 1, alignItems: 'center' },
  heroStatDivider: { width: 1, height: 24, backgroundColor: 'rgba(255, 255, 255, 0.15)' },
  heroStatValue: { ...type.statNumber, color: '#FFFFFF' },
  heroStatLabel: { fontSize: 10, fontWeight: '700', color: colors.heroTextMuted, marginTop: 1 },
  heroButton: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFF',
    paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.lg,
  },
  heroButtonText: { fontSize: 12.5, fontWeight: '800', color: colors.text },

  // Section card (a titled block) and list card (one row)
  section: {
    backgroundColor: colors.card, borderRadius: radius.section, paddingVertical: space.xxl,
    marginBottom: space.page, borderWidth: 1, borderColor: colors.border, ...shadow.card,
  },
  sectionHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: space.page, marginBottom: space.lg,
  },
  sectionTitle: { ...type.cardTitle, color: colors.text },
  sectionHint: { ...type.hint, color: colors.textFaint },
  listCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.card,
    padding: space.xl, borderWidth: 1, borderColor: colors.border, gap: space.xl,
  },
  dateBox: {
    width: 48, height: 52, borderRadius: radius.xl, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  dateBoxNum: { fontSize: 16, fontWeight: '900', color: colors.text },
  dateBoxDay: { fontSize: 10, fontWeight: '700', color: colors.textMuted },

  // Segmented control: grey track, white raised active segment
  segmented: { flexDirection: 'row', backgroundColor: colors.track, borderRadius: radius.xl, padding: 4, marginBottom: space.xxl },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  segmentActive: { backgroundColor: '#FFFFFF', ...shadow.raised },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  segmentTextActive: { color: colors.text, fontWeight: '800' },

  // Pills and buttons
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.md,
    paddingVertical: 2.5, borderRadius: radius.pill, borderWidth: 1,
  },
  pillText: { ...type.pill },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bg, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.sm,
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: colors.textBody },
  softButton: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft,
    borderWidth: 1, borderColor: colors.primaryBorder, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.md,
  },
  softButtonText: { fontSize: 11.5, fontWeight: '800', color: colors.primary },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: colors.primary, paddingHorizontal: space.page, paddingVertical: space.lg, borderRadius: radius.lg,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },

  // Empty state: white card, soft-blue icon tile, title, one line, one action
  empty: {
    padding: 28, alignItems: 'center', backgroundColor: colors.card, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  emptyIcon: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.lg,
  },
  emptyTitle: { ...type.cardTitle, color: colors.text, marginBottom: 4 },
  emptyText: { color: colors.textMuted, fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginBottom: space.xxl },
});
