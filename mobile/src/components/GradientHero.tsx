import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import { ds, colors } from '../theme/ds';

export interface HeroStat { label: string; value: string | number; color?: string }

/**
 * The navy→blue gradient card at the top of a screen (see theme/ds.ts),
 * shared so every tab draws it the same way: an overline, a big number with
 * its unit, an optional action on the right, and a strip of stats.
 */
export default function GradientHero({
  id, overline, value, unit, caption, action, stats, children,
}: {
  /** Unique per screen: SVG gradient ids are global on Android. */
  id: string;
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
      <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors.heroFrom} />
            <Stop offset="55%" stopColor={colors.heroVia} />
            <Stop offset="100%" stopColor={colors.heroTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
        <Circle cx="90%" cy="15%" r="85" fill="#FFFFFF" fillOpacity="0.07" />
        <Circle cx="12%" cy="90%" r="65" fill={colors.heroGlow} fillOpacity="0.08" />
      </Svg>
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
