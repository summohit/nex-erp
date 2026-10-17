import React, { useEffect, useMemo } from 'react';
import { View, Animated } from 'react-native';
import GradientBg from './GradientBg';

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
      ['#8b5cf6', '#6b3fd6'],
      ['#3b82f6', '#06b6d4'],
      ['#10b981', '#059669'],
      ['#6b3fd6', '#6b3fd6'],
      ['#1373e5', '#6b3fd6'],
      ['#6366f1', '#8b5cf6']
    ];
    return fallbackGradients[index % fallbackGradients.length];
  }, [colorStr, index]);

  return (
    <View style={[style, { overflow: 'hidden' }]}>
      <GradientBg from={colors[0]} via={colors[0]} to={colors[1]} glow={false} />
      {children}
    </View>
  );
};
