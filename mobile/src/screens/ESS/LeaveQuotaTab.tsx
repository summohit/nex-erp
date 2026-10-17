import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { History, X, Plus, Minus, Calendar } from 'lucide-react-native';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { leaveService, LeaveBalance, CompOffPerson } from '../../api/leaveService';
import { theme } from '../../theme/theme';
import GradientHero from '../../components/GradientHero';
import { ds, colors as dsColors, status as dsStatus, shadow as dsShadow } from '../../theme/ds';

type Row = { id: number; name: string; isPaid: boolean; allocated: number; used: number };

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const isCompOff = (name: string) => /comp/i.test(name);

/**
 * Leave Quota tab of the Attendance screen — the web's "Leaves Quota" table as cards for a phone, one per
 * leave type: allotted, taken, remaining, and over-used. Comp-off types open
 * the comp-off history (what each day was earned for, and where it was used).
 *
 * Built the way the web builds it: every leave type, with this year's balance
 * rows summed per type, so a type with no balance still shows as 0.
 */
export default function LeaveQuotaTab() {
  const year = new Date().getFullYear();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [balances, types] = await Promise.all([
        leaveService.getMyBalances(year),
        leaveService.getLeaveTypes().catch(() => []),
      ]);
      const byType = new Map<number, { allocated: number; used: number }>();
      for (const b of balances as LeaveBalance[]) {
        const t = byType.get(b.leaveTypeId) ?? { allocated: 0, used: 0 };
        t.allocated += b.allocated; t.used += b.used;
        byType.set(b.leaveTypeId, t);
      }
      const list = types.length ? types : (balances as LeaveBalance[]).map((b) => ({ id: b.leaveTypeId, name: b.leaveType.name, isPaid: true }));
      const byName = new Map<string, Row>();
      for (const t of list) {
        const key = t.name.trim().toLowerCase();
        const bal = byType.get(t.id) ?? { allocated: 0, used: 0 };
        const row = byName.get(key);
        if (row) { row.allocated += bal.allocated; row.used += bal.used; }
        else byName.set(key, { id: t.id, name: t.name, isPaid: t.isPaid !== false, ...bal });
      }
      setRows([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => ({
    allocated: rows.reduce((t, r) => t + r.allocated, 0),
    used: rows.reduce((t, r) => t + r.used, 0),
    over: rows.reduce((t, r) => t + Math.max(r.used - r.allocated, 0), 0),
  }), [rows]);
  const remaining = useMemo(() => rows.reduce((s, r) => s + Math.max(r.allocated - r.used, 0), 0), [rows]);
  // Types in use first, empty ones after, so the cards that matter are on top.
  const [active, empty] = useMemo(() => [
    rows.filter((r) => r.allocated > 0 || r.used > 0),
    rows.filter((r) => r.allocated === 0 && r.used === 0),
  ], [rows]);

  const card = (r: Row) => {
    const left = Math.max(r.allocated - r.used, 0);
    const over = Math.max(r.used - r.allocated, 0);
    const pct = r.allocated > 0 ? Math.min(r.used / r.allocated, 1) : r.used > 0 ? 1 : 0;
    return (
      <View key={r.id} style={styles.card}>
        <View style={styles.cardHead}>
          <View style={[styles.dot, !r.isPaid && styles.dotUnpaid]} />
          <Text style={styles.typeName} numberOfLines={1}>{r.name}</Text>
          {isCompOff(r.name) && (
            <TouchableOpacity style={styles.historyBtn} onPress={() => setHistoryOpen(true)}>
              <History size={13} color={theme.colors.primary} />
              <Text style={styles.historyText}>History</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${pct * 100}%` }, over > 0 && styles.barOver]} /></View>
        <View style={styles.stats}>
          <Stat label="Allotted" value={n(r.allocated)} />
          <Stat label="Taken" value={n(r.used)} />
          <Stat label="Remaining" value={n(left)} strong />
          {over > 0 && <Stat label="Over used" value={n(over)} danger />}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <GradientHero
          id="quotaHeroGrad"
          overline={`LEAVE QUOTA · ${year}`}
          value={n(remaining)}
          unit={`/ ${n(totals.allocated)} days left`}
          caption="All leave types"
          stats={[
            { label: 'Allotted', value: n(totals.allocated) },
            { label: 'Taken', value: n(totals.used), color: '#FDE68A' },
            { label: 'Remaining', value: n(remaining), color: '#A7F3D0' },
            { label: 'Over used', value: n(totals.over), color: totals.over > 0 ? '#FECACA' : undefined },
          ]}
        />

        {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
          <>
            {active.length > 0 && (
              <View style={styles.listHeadRow}>
                <Text style={ds.sectionTitle}>Your leave types</Text>
                <Text style={ds.sectionHint}>{active.length} in use</Text>
              </View>
            )}
            {active.map(card)}
            {empty.length > 0 && (
              <View style={styles.listHeadRow}>
                <Text style={ds.sectionTitle}>Not allotted this year</Text>
                <Text style={ds.sectionHint}>{empty.length}</Text>
              </View>
            )}
            {empty.map(card)}
          </>
        )}
      </ScrollView>

      <CompOffHistorySheet visible={historyOpen} onClose={() => setHistoryOpen(false)} />
    </View>
  );
}

function Stat({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, strong && styles.statStrong, danger && styles.statDanger]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const PRESETS = ['Today', 'Last 30 Days', 'This Month', 'Last Month', 'Last 90 Days', 'Last 6 Months', 'Last 1 Year', 'Custom'] as const;
type Preset = typeof PRESETS[number];

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDate = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/** The same presets as the web's Duration filter. */
function presetRange(p: Preset): [Date, Date] | null {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const back = (days: number) => { const d = new Date(now); d.setDate(d.getDate() - days); return d; };
  switch (p) {
    case 'Today': return [new Date(now), new Date(now)];
    case 'Last 30 Days': return [back(29), new Date(now)];
    case 'This Month': return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0)];
    case 'Last Month': return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 0)];
    case 'Last 90 Days': return [back(89), new Date(now)];
    case 'Last 6 Months': { const d = new Date(now); d.setMonth(d.getMonth() - 6); return [d, new Date(now)]; }
    case 'Last 1 Year': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return [d, new Date(now)]; }
    default: return null;
  }
}

/** The web's "My Comp-off History" drawer, as a full-height sheet. */
function CompOffHistorySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>('Last 1 Year');
  const [range, setRange] = useState<[Date, Date]>(() => presetRange('Last 1 Year')!);
  /** Which end of a custom range the date picker is setting, if open. */
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [data, setData] = useState<CompOffPerson | null>(null);
  const [loading, setLoading] = useState(false);

  const from = dayKey(range[0]);
  const to = dayKey(range[1]);
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    leaveService.getMyCompOffHistory({ from, to }).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [visible, from, to]);

  const choose = (p: Preset) => {
    setPreset(p);
    const r = presetRange(p);
    if (r) setRange(r);
    else setPicking('from');
  };

  const onPicked = (d: Date) => {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const side = picking;
    setPicking(null);
    if (side === 'from') {
      setRange(([, end]) => (day > end ? [day, day] : [day, end]));
      // Straight on to the end date, as the web's calendar does.
      setTimeout(() => setPicking('to'), 400);
    } else if (side === 'to') {
      setRange(([start]) => (day < start ? [day, start] : [start, day]));
    }
  };

  const periodText = preset === 'Custom' ? `${shortDate(range[0])} – ${shortDate(range[1])}` : preset.toLowerCase();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHead}>
          <View style={styles.flex}>
            <Text style={styles.sheetTitle}>My Comp-off History</Text>
            <Text style={styles.sheetSub}>What each comp-off was earned for, and where it was used.</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.close}><X size={20} color="#334155" /></TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.years} style={styles.yearsWrap}>
          {PRESETS.map((p) => (
            <TouchableOpacity key={p} style={[styles.yearChip, p === preset && styles.yearOn]} onPress={() => choose(p)}>
              <Text style={[styles.yearText, p === preset && styles.yearTextOn]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <View style={styles.rangeRow}>
          <Calendar size={14} color="#64748B" />
          <TouchableOpacity onPress={() => { setPreset('Custom'); setPicking('from'); }}>
            <Text style={styles.rangeText}>{shortDate(range[0])}</Text>
          </TouchableOpacity>
          <Text style={styles.rangeDash}>to</Text>
          <TouchableOpacity onPress={() => { setPreset('Custom'); setPicking('to'); }}>
            <Text style={styles.rangeText}>{shortDate(range[1])}</Text>
          </TouchableOpacity>
        </View>
        <DateTimePickerModal
          isVisible={picking != null}
          mode="date"
          date={picking === 'to' ? range[1] : range[0]}
          maximumDate={new Date(new Date().getFullYear(), 11, 31)}
          onConfirm={onPicked}
          onCancel={() => setPicking(null)}
        />

        {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
          <ScrollView contentContainerStyle={styles.sheetBody}>
            <View style={styles.tiles}>
              <Tile label="Earned" value={n(data?.allocated ?? 0)} sub="days credit" />
              <Tile label="Used" value={n(data?.used ?? 0)} sub="days taken" />
              <Tile label="Available" value={n(data?.remaining ?? 0)} sub="days left" highlight />
              <Tile label="From work" value={n(data?.earnedFromWork ?? 0)} sub="days worked" />
            </View>

            <View style={styles.listHead}>
              <Plus size={14} color={theme.colors.primary} />
              <Text style={styles.listTitle}>Earned for ({data?.credits.length ?? 0})</Text>
            </View>
            {data?.credits.length ? data.credits.map((c) => (
              <View key={c.id} style={styles.entry}>
                <View style={styles.entryRow}>
                  <Text style={styles.entryDate}>{fmt(c.date || c.creditedOn)}</Text>
                  <Text style={styles.entryDays}>+{n(c.days)} day{c.days === 1 ? '' : 's'}</Text>
                </View>
                <Text style={styles.entryReason}>{c.reason}</Text>
                {(c.clockIn || c.clockOut) && (
                  <Text style={styles.entryMeta}>
                    {[c.clockIn && `In ${c.clockIn}`, c.clockOut && `Out ${c.clockOut}`].filter(Boolean).join(' · ')}
                  </Text>
                )}
                {!!(c.fieldVisit || c.project) && (
                  <Text style={styles.entryMeta}>
                    {c.fieldVisit ? `${c.fieldVisit.number} · ${c.fieldVisit.location}` : c.project}
                  </Text>
                )}
              </View>
            )) : <Text style={styles.none}>No day-by-day record yet.</Text>}

            <View style={styles.listHead}>
              <Minus size={14} color="#DC2626" />
              <Text style={styles.listTitle}>Used on ({data?.used_leaves.length ?? 0})</Text>
            </View>
            {data?.used_leaves.length ? data.used_leaves.map((u) => (
              <View key={u.id} style={styles.entry}>
                <Text style={styles.entryDate}>
                  {u.from.slice(0, 10) === u.to.slice(0, 10) ? fmt(u.from) : `${fmt(u.from)} → ${fmt(u.to)}`}
                  {u.halfDay ? ' · half day' : ''}
                </Text>
                {!!u.reason && <Text style={styles.entryReason}>{u.reason}</Text>}
              </View>
            )) : <Text style={styles.none}>Not used {periodText}.</Text>}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function Tile({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <View style={[styles.tile, highlight && styles.tileOn]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, highlight && styles.tileValueOn]}>{value}</Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingHorizontal: 2 },
  body: { padding: 16, paddingBottom: 120, gap: 10 },
  loader: { marginTop: 30 },
  card: { backgroundColor: dsColors.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: dsColors.border, ...dsShadow.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 4, backgroundColor: dsStatus.success.fg },
  dotUnpaid: { backgroundColor: dsStatus.info.fg },
  typeName: { flex: 1, fontSize: 14.5, fontWeight: '800', color: dsColors.text },
  historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: dsColors.primarySoft, borderWidth: 1, borderColor: dsColors.primaryBorder },
  historyText: { fontSize: 11.5, fontWeight: '800', color: dsColors.primary },
  bar: { height: 6, borderRadius: 999, backgroundColor: dsColors.track, marginTop: 12, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 999, backgroundColor: dsColors.primary },
  barOver: { backgroundColor: dsStatus.danger.fg },
  stats: { flexDirection: 'row', marginTop: 12, backgroundColor: dsColors.bg, borderWidth: 1, borderColor: dsColors.borderSoft, borderRadius: 14, paddingVertical: 8 },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '900', color: dsColors.text, fontVariant: ['tabular-nums'] },
  statStrong: { color: dsStatus.success.strong },
  statDanger: { color: dsStatus.danger.strong },
  statLabel: { fontSize: 10.5, fontWeight: '700', color: dsColors.textMuted, marginTop: 1 },
  sheet: { flex: 1, backgroundColor: dsColors.bg, paddingTop: 54 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: dsColors.text },
  sheetSub: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
  close: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: dsColors.border, alignItems: 'center', justifyContent: 'center' },
  yearsWrap: { flexGrow: 0, marginTop: 12 },
  years: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 10 },
  rangeText: { fontSize: 13, fontWeight: '700', color: theme.colors.primary, textDecorationLine: 'underline' },
  rangeDash: { fontSize: 13, color: '#64748B' },
  yearChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: dsColors.border },
  yearOn: { backgroundColor: dsColors.primary, borderColor: dsColors.primary },
  yearText: { fontSize: 12.5, fontWeight: '700', color: dsColors.textSecondary },
  yearTextOn: { color: '#fff' },
  sheetBody: { padding: 16, paddingBottom: 60 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: dsColors.border },
  tileOn: { backgroundColor: dsStatus.success.bg, borderColor: dsStatus.success.border },
  tileLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: dsColors.textMuted, textTransform: 'uppercase' },
  tileValue: { fontSize: 24, fontWeight: '900', color: dsColors.text, marginTop: 4, fontVariant: ['tabular-nums'] },
  tileValueOn: { color: dsStatus.success.strong },
  tileSub: { fontSize: 12, color: theme.colors.textSecondary },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, marginBottom: 6 },
  listTitle: { fontSize: 15, fontWeight: '800', color: dsColors.text },
  entry: { backgroundColor: '#fff', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: dsColors.border, marginBottom: 8 },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  entryDate: { fontSize: 13.5, fontWeight: '800', color: dsColors.text },
  entryDays: { fontSize: 12, fontWeight: '800', color: dsStatus.success.strong, backgroundColor: dsStatus.success.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  entryReason: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 3 },
  entryMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  none: { fontSize: 12.5, color: dsColors.textMuted, padding: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: dsColors.primaryBorder, backgroundColor: '#fff', textAlign: 'center' },
});
