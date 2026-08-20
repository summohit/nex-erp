import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';

export const PulseSkeleton = ({ style }: { style: any }) => {
  const pulseAnim = React.useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.5, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [pulseAnim]);
  return <Animated.View style={[style, { opacity: pulseAnim, backgroundColor: '#E2E8F0' }]} />;
};

export const GradientBanner = ({ colorStr, index = 0, style, children }: { colorStr?: string; index?: number; style?: any; children?: React.ReactNode }) => {
  const colors = useMemo(() => {
    if (colorStr) {
      if (colorStr.startsWith('linear-gradient')) {
        const matches = colorStr.match(/#(?:[0-9a-fA-F]{3}){1,2}/g);
        if (matches && matches.length >= 2) {
          return [matches[0], matches[1]];
        }
      } else if (colorStr.startsWith('#')) {
        return [colorStr, colorStr];
      }
    }
    const fallbackGradients = [
      ['#8b5cf6', '#ec4899'],
      ['#3b82f6', '#06b6d4'],
      ['#10b981', '#059669'],
      ['#f59e0b', '#d97706'],
      ['#ef4444', '#f43f5e'],
      ['#6366f1', '#8b5cf6']
    ];
    return fallbackGradients[index % fallbackGradients.length];
  }, [colorStr, index]);

  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <Svg height="100%" width="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`grad-${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors[0]} stopOpacity="1" />
            <Stop offset="100%" stopColor={colors[1]} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#grad-${index})`} />
      </Svg>
      {children}
    </View>
  );
};
