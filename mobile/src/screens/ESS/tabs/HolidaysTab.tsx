import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Calendar, PartyPopper, Sun } from 'lucide-react-native';
import { useTimesheetStore } from '../../../store/timesheetStore';
import GradientHero from '../../../components/GradientHero';
import { ds, colors, status } from '../../../theme/ds';

const DAY_MS = 86400000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Company holidays, in the Timesheet design system: a hero with the next
 * holiday and the count, then the year month by month. Past days are dimmed;
 * a Friday or Monday holiday is marked as a long weekend.
 */
export default function HolidaysTab() {
  const { holidays, isLoading, fetchData } = useTimesheetStore();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);

  useEffect(() => {
    if (holidays.length === 0) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once if empty
  }, []);

  const today = startOfDay(new Date());

  const all = useMemo(
    () => holidays
      .map((h: any) => ({ ...h, day: startOfDay(new Date(h.date)) }))
      .filter((h: any) => !Number.isNaN(h.day.getTime()))
      .sort((a: any, b: any) => a.day.getTime() - b.day.getTime()),
    [holidays],
  );
  const years = useMemo(() => [...new Set(all.map((h: any) => h.day.getFullYear()))].sort(), [all]);
  const list = all.filter((h: any) => h.day.getFullYear() === year);
  const upcoming = list.filter((h: any) => h.day >= today);
  const next = all.find((h: any) => h.day >= today);
  const daysToNext = next ? Math.round((next.day.getTime() - today.getTime()) / DAY_MS) : null;
  const longWeekends = list.filter((h: any) => [1, 5].includes(h.day.getDay())).length;

  const byMonth = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const h of list) {
      const k = h.day.getMonth();
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <View style={styles.container}>
      <GradientHero
        id="holidayHeroGrad"
        overline={next ? 'NEXT HOLIDAY' : 'HOLIDAYS'}
        value={next && daysToNext != null ? (daysToNext === 0 ? 'Today' : daysToNext) : list.length}
        unit={next ? (daysToNext === 0 ? undefined : daysToNext === 1 ? 'day to go' : 'days to go') : 'this year'}
        caption={next ? `${next.name} · ${next.day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}` : undefined}
        action={
          <View style={styles.heroIcon}>
            <PartyPopper size={20} color="#FFFFFF" />
          </View>
        }
        stats={[
          { label: `In ${year}`, value: list.length },
          { label: 'Upcoming', value: upcoming.length, color: '#A7F3D0' },
          { label: 'Gone by', value: list.length - upcoming.length },
          { label: 'Long weekends', value: longWeekends, color: '#FDE68A' },
        ]}
      />

      {years.length > 1 && (
        <View style={ds.segmented}>
          {years.map((y) => (
            <TouchableOpacity key={y} style={[ds.segment, y === year && ds.segmentActive]} onPress={() => setYear(y)} activeOpacity={0.85}>
              <Text style={[ds.segmentText, y === year && ds.segmentTextActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isLoading && holidays.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : list.length === 0 ? (
        <View style={ds.empty}>
          <View style={ds.emptyIcon}>
            <Calendar size={22} color={colors.primary} />
          </View>
          <Text style={ds.emptyTitle}>No holidays for {year}</Text>
          <Text style={[ds.emptyText, { marginBottom: 0 }]}>HR has not published the {year} holiday list yet.</Text>
        </View>
      ) : (
        byMonth.map(([month, items]) => (
          <View key={month} style={ds.section}>
            <View style={ds.sectionHead}>
              <Text style={ds.sectionTitle}>
                {new Date(year, month, 1).toLocaleDateString('en-IN', { month: 'long' })}
              </Text>
              <Text style={ds.sectionHint}>{items.length} {items.length === 1 ? 'holiday' : 'holidays'}</Text>
            </View>
            <View style={styles.rows}>
              {items.map((h: any) => {
                const past = h.day < today;
                const isToday = h.day.getTime() === today.getTime();
                const isNext = next && h.id === next.id && !isToday;
                const inDays = Math.round((h.day.getTime() - today.getTime()) / DAY_MS);
                const weekend = h.day.getDay() === 0 || h.day.getDay() === 6;
                const long = h.day.getDay() === 1 || h.day.getDay() === 5;
                return (
                  <View key={h.id} style={[styles.row, past && styles.rowPast, (isToday || isNext) && styles.rowNext]}>
                    <View style={[ds.dateBox, (isToday || isNext) && styles.dateBoxNext]}>
                      <Text style={[ds.dateBoxNum, (isToday || isNext) && { color: colors.primary }]}>{h.day.getDate()}</Text>
                      <Text style={ds.dateBoxDay}>{h.day.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()}</Text>
                    </View>
                    <View style={styles.center}>
                      <Text style={styles.name} numberOfLines={2}>{h.name}</Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.meta}>{h.day.toLocaleDateString('en-IN', { weekday: 'long' })}</Text>
                        {long && !past && (
                          <View style={[ds.pill, { backgroundColor: status.warning.bg, borderColor: status.warning.border }]}>
                            <Sun size={10} color={status.warning.fg} />
                            <Text style={[ds.pillText, { color: status.warning.strong }]}>Long weekend</Text>
                          </View>
                        )}
                        {weekend && (
                          <View style={[ds.pill, { backgroundColor: status.neutral.bg, borderColor: status.neutral.border }]}>
                            <Text style={[ds.pillText, { color: status.neutral.fg }]}>On a weekend</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    {isToday ? (
                      <View style={[ds.pill, { backgroundColor: status.success.bg, borderColor: status.success.border }]}>
                        <Text style={[ds.pillText, { color: status.success.strong }]}>Today</Text>
                      </View>
                    ) : past ? (
                      <Text style={styles.doneText}>Done</Text>
                    ) : (
                      <View style={[ds.pill, isNext
                        ? { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }
                        : { backgroundColor: colors.bg, borderColor: colors.border }]}>
                        <Text style={[ds.pillText, { color: isNext ? colors.primary : colors.textMuted }]}>
                          {inDays === 1 ? 'Tomorrow' : `In ${inDays}d`}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  loader: { marginTop: 40 },
  heroIcon: {
    width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassBg, borderWidth: 1, borderColor: colors.glassBorder,
  },
  rows: { paddingHorizontal: 12, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: '#FFFFFF',
  },
  rowPast: { opacity: 0.55 },
  rowNext: { borderColor: colors.primaryRing, backgroundColor: '#FBFDFF' },
  dateBoxNext: { backgroundColor: colors.primarySoft, borderColor: colors.primaryRing },
  center: { flex: 1, gap: 4 },
  name: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  meta: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  doneText: { fontSize: 11, fontWeight: '800', color: colors.textFaint },
});
