import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import { colors } from '../theme/ds';

/**
 * The navy→blue hero gradient as a background layer. Fills its parent (which
 * should have `overflow: 'hidden'` and a border radius).
 *
 * Two iOS details it handles (17 Oct 2026):
 *  - it measures itself and draws in exact pixels; a "100%" Svg in an absolute
 *    overlay could be laid out before the card had a size and stay a small
 *    square in the corner;
 *  - each instance has its own gradient id; iOS skips a gradient whose id is
 *    used by another mounted Svg (Attendance and Leaves mount the same screen).
 */
export default function GradientBg({
  from = colors.heroFrom, via = colors.heroVia, to = colors.heroTo, glow = true,
}: { from?: string; via?: string; to?: string; glow?: boolean }) {
  const gid = useRef(`heroGrad-${Math.random().toString(36).slice(2, 9)}`).current;
  const [size, setSize] = useState({ w: 0, h: 0 });

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
      }}
    >
      {size.w > 0 && size.h > 0 && (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2={size.w} y2={size.h} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={from} />
              <Stop offset="0.55" stopColor={via} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width={size.w} height={size.h} fill={`url(#${gid})`} />
          {glow && <Circle cx={size.w * 0.9} cy={size.h * 0.15} r="85" fill="#FFFFFF" fillOpacity="0.07" />}
          {glow && <Circle cx={size.w * 0.12} cy={size.h * 0.9} r="65" fill={colors.heroGlow} fillOpacity="0.08" />}
        </Svg>
      )}
    </View>
  );
}
