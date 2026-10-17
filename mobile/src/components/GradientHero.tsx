import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GradientBg from './GradientBg';
import { ds, colors } from '../theme/ds';

export interface HeroStat { label: string; value: string | number; color?: string }

/**
 * The navy→blue gradient card at the top of a screen (see theme/ds.ts),
 * shared so every tab draws it the same way: an overline, a big number with
 * its unit, an optional action on the right, and a strip of stats.
 */
export default function GradientHero({
  overline, value, unit, caption, action, stats, children,
}: {
  /** No longer needed (GradientBg makes its own); kept so callers compile. */
  id?: string;
  overline: string;
  value: string | number;
  unit?: string;
  caption?: string;
  action?: React.ReactNode;
  stats?: HeroStat[];
  children?: React.ReactNode;
}) {
  return (
    <View style={ds.hero}>
      <GradientBg />
      <View style={ds.heroInner}>
        <View style={styles.top}>
          <View style={styles.flex}>
            <Text style={ds.heroOverline}>{overline}</Text>
            <View style={styles.scoreRow}>
              <Text style={ds.heroNumber} numberOfLines={1}>{value}</Text>
              {!!unit && <Text style={ds.heroUnit}>{unit}</Text>}
            </View>
            {!!caption && <Text style={styles.caption} numberOfLines={1}>{caption}</Text>}
          </View>
          {action}
        </View>
        {children}
        {!!stats?.length && (
          <View style={ds.heroStrip}>
            {stats.map((st, i) => (
              <React.Fragment key={st.label}>
                {i > 0 && <View style={ds.heroStatDivider} />}
                <View style={ds.heroStatCol}>
                  <Text style={[ds.heroStatValue, st.color ? { color: st.color } : null]}>{st.value}</Text>
                  <Text style={ds.heroStatLabel}>{st.label}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, gap: 12 },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  caption: { fontSize: 12, fontWeight: '600', color: colors.heroTextSoft, marginTop: 2 },
});
