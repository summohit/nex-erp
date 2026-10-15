import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Modal,
} from 'react-native';
import { History, X, Plus, Minus } from 'lucide-react-native';
import { leaveService, LeaveBalance, CompOffPerson } from '../../api/leaveService';
import { theme } from '../../theme/theme';

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
        <View style={styles.summary}>
          <Text style={styles.summaryLabel}>Remaining leaves</Text>
          <Text style={styles.summaryValue}>{n(remaining)}</Text>
          <Text style={styles.summarySub}>{year} · all leave types</Text>
        </View>

        {loading ? <ActivityIndicator style={styles.loader} color={theme.colors.primary} /> : (
          <>
            {active.map(card)}
            {empty.length > 0 && <Text style={styles.section}>Not allotted this year</Text>}
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

/** The web's "My Comp-off History" drawer, as a full-height sheet. */
function CompOffHistorySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<CompOffPerson | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    leaveService.getMyCompOffHistory(year).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [visible, year]);

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

        <View style={styles.years}>
          {[thisYear - 1, thisYear].map((y) => (
            <TouchableOpacity key={y} style={[styles.yearChip, y === year && styles.yearOn]} onPress={() => setYear(y)}>
              <Text style={[styles.yearText, y === year && styles.yearTextOn]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>

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
            )) : <Text style={styles.none}>Not used yet in {year}.</Text>}
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
  body: { padding: 16, paddingBottom: 120, gap: 10 },
  loader: { marginTop: 30 },
  summary: { backgroundColor: '#EFF6FF', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#DBEAFE' },
  summaryLabel: { fontSize: 13, color: '#1E40AF', fontWeight: '600' },
  summaryValue: { fontSize: 32, fontWeight: '800', color: '#1373e5', marginTop: 2 },
  summarySub: { fontSize: 12, color: '#475569' },
  section: { marginTop: 8, fontSize: 12, fontWeight: '700', color: '#64748B', textTransform: 'uppercase' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: theme.colors.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#16A34A' },
  dotUnpaid: { backgroundColor: '#0EA5E9' },
  typeName: { flex: 1, fontSize: 15, fontWeight: '700', color: theme.colors.textPrimary },
  historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#EFF6FF' },
  historyText: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#F1F5F9', marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#1373e5' },
  barOver: { backgroundColor: '#DC2626' },
  stats: { flexDirection: 'row', marginTop: 10 },
  stat: { flex: 1 },
  statValue: { fontSize: 16, fontWeight: '700', color: theme.colors.textPrimary },
  statStrong: { color: '#15803D' },
  statDanger: { color: '#DC2626' },
  statLabel: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 1 },
  sheet: { flex: 1, backgroundColor: '#F8FAFC', paddingTop: 54 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: theme.colors.textPrimary },
  sheetSub: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 2 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center' },
  years: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 12 },
  yearChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: theme.colors.border },
  yearOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  yearText: { fontWeight: '700', color: '#475569' },
  yearTextOn: { color: '#fff' },
  sheetBody: { padding: 16, paddingBottom: 60 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '47%', flexGrow: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border },
  tileOn: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  tileLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', textTransform: 'uppercase' },
  tileValue: { fontSize: 24, fontWeight: '800', color: theme.colors.textPrimary, marginTop: 4 },
  tileValueOn: { color: '#15803D' },
  tileSub: { fontSize: 12, color: theme.colors.textSecondary },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, marginBottom: 6 },
  listTitle: { fontSize: 13, fontWeight: '800', color: theme.colors.textPrimary, textTransform: 'uppercase' },
  entry: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.colors.border, marginBottom: 8 },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  entryDate: { fontWeight: '700', color: theme.colors.textPrimary },
  entryDays: { fontWeight: '700', color: '#15803D' },
  entryReason: { fontSize: 13, color: theme.colors.textSecondary, marginTop: 3 },
  entryMeta: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2 },
  none: { fontSize: 13, color: theme.colors.textSecondary, padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1' },
});
