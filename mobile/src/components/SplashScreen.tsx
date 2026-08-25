import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useAuthStore } from '../store/authStore';

const { width: SCREEN_W } = Dimensions.get('window');
const LOGO_SIZE = 84; // matches the native bootsplash logo width for a seamless handoff

/** Three sequenced dots — calmer than a spinner, reads as "working". */
function LoadingDots() {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const animations = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    animations.forEach(a => a.start());
    return () => animations.forEach(a => a.stop());
  }, []);

  return (
    <View style={styles.dotsRow}>
      {dots.map((dot, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            { opacity: dot, transform: [{ scale: dot.interpolate({ inputRange: [0.3, 1], outputRange: [0.8, 1] }) }] },
          ]}
        />
      ))}
    </View>
  );
}

export default function SplashScreen() {
  const company = useAuthStore(s => s.company);

  // Logo starts at rest (scale 1, opaque) so it lines up exactly with the
  // native bootsplash frame — nothing visibly "jumps" at the handoff.
  const breathe = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const content = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Soft halo fades in behind the logo
    Animated.timing(glow, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Wordmark + tagline + dots rise into place
    Animated.timing(content, {
      toValue: 1,
      duration: 600,
      delay: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    // Slow breathing on the logo
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    // Expanding ring pulse
    const ringLoop = Animated.loop(
      Animated.timing(ring, {
        toValue: 1,
        duration: 2400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    );

    breatheLoop.start();
    ringLoop.start();
    return () => {
      breatheLoop.stop();
      ringLoop.stop();
    };
  }, []);

  const logoScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.28, 0] });
  const contentTranslate = content.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />

      {/* Centred stack */}
      <View style={styles.center}>
        <View style={styles.logoStage}>
          {/* Concentric halos build a soft radial warmth without a gradient dep */}
          <Animated.View style={[styles.halo, styles.haloWash, { opacity: glow }]} />
          <Animated.View style={[styles.halo, styles.haloOuter, { opacity: glow }]} />
          <Animated.View style={[styles.halo, styles.haloInner, { opacity: glow }]} />

          {/* Pulse ring */}
          <Animated.View
            style={[
              styles.halo,
              styles.ring,
              { opacity: ringOpacity, transform: [{ scale: ringScale }] },
            ]}
          />

          <Animated.Image
            source={require('../assets/app_icon.png')}
            style={[styles.logo, { transform: [{ scale: logoScale }] }]}
            resizeMode="contain"
          />
        </View>

        {/* Wordmark block — absolutely placed so the logo never shifts */}
        <Animated.View
          style={[
            styles.wordmarkBlock,
            { opacity: content, transform: [{ translateY: contentTranslate }] },
          ]}
        >
          <Text style={styles.wordmark}>CES WORK</Text>
          <View style={styles.rule} />
          <Text style={styles.tagline}>Enterprise Workspace</Text>
        </Animated.View>
      </View>

      {/* Footer */}
      <Animated.View
        style={[
          styles.footer,
          { opacity: content, transform: [{ translateY: contentTranslate }] },
        ]}
      >
        <LoadingDots />
        {company?.name ? <Text style={styles.company}>{company.name}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoStage: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    borderRadius: 999,
  },
  haloWash: {
    width: SCREEN_W * 1.5,
    height: SCREEN_W * 1.5,
    backgroundColor: 'rgba(226, 94, 62, 0.028)',
  },
  haloOuter: {
    width: LOGO_SIZE * 2.5,
    height: LOGO_SIZE * 2.5,
    backgroundColor: 'rgba(226, 94, 62, 0.045)',
  },
  haloInner: {
    width: LOGO_SIZE * 1.65,
    height: LOGO_SIZE * 1.65,
    backgroundColor: 'rgba(226, 94, 62, 0.06)',
  },
  ring: {
    width: LOGO_SIZE * 1.35,
    height: LOGO_SIZE * 1.35,
    borderWidth: 1.5,
    borderColor: '#E25E3E',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
  wordmarkBlock: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    marginTop: LOGO_SIZE / 2 + 34,
    alignItems: 'center',
  },
  wordmark: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 6,
    // optical correction for the trailing letter-space
    marginLeft: 6,
  },
  rule: {
    width: 34,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: '#E25E3E',
    marginTop: 12,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 56,
    alignItems: 'center',
    gap: 18,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#E25E3E',
  },
  company: {
    fontSize: 11,
    fontWeight: '600',
    color: '#CBD5E1',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
});
