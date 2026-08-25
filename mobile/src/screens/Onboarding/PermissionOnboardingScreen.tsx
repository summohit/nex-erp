import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  Dimensions, Platform, PermissionsAndroid, StatusBar,
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Camera, Image as ImageIcon, Bell, Check, ChevronRight } from 'lucide-react-native';

export const PERMISSIONS_ONBOARDED_KEY = '@ceswork/permissions_onboarded';

const { width: W, height: H } = Dimensions.get('window');

/* ─── Permission definitions ─────────────────────────────── */
const PERMS = [
  {
    id: 'location',
    color: '#2563EB',
    lightColor: '#DBEAFE',
    ringColor: 'rgba(37,99,235,0.10)',
    Icon: MapPin,
    title: 'Location Access',
    subtitle: 'Know exactly where your work happens',
    description:
      'CES Work uses your GPS to accurately log field visits, calculate travel distance, and verify your clock-in location for attendance records.',
    bullets: [
      'Record GPS route for field visits',
      'Geo-stamp your clock-in & clock-out',
      'Calculate travel distance automatically',
    ],
    androidPermission: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    androidRationale: {
      title: 'Location Permission',
      message: 'CES Work needs your location for field visit tracking and attendance.',
      buttonPositive: 'Allow',
    },
  },
  {
    id: 'camera',
    color: '#E25E3E',
    lightColor: '#FFEDE8',
    ringColor: 'rgba(226,94,62,0.10)',
    Icon: Camera,
    title: 'Camera',
    subtitle: 'Document your work on the ground',
    description:
      'Capture photos at project sites, document work progress in real time, and keep a visual record of every field visit.',
    bullets: [
      'Take photos during field visits',
      'Attach site images to project issues',
      'Update your profile picture',
    ],
    androidPermission: PermissionsAndroid.PERMISSIONS.CAMERA,
    androidRationale: {
      title: 'Camera Permission',
      message: 'CES Work needs camera access to take photos during field visits.',
      buttonPositive: 'Allow',
    },
  },
  {
    id: 'photos',
    color: '#7C3AED',
    lightColor: '#EDE9FE',
    ringColor: 'rgba(124,58,237,0.10)',
    Icon: ImageIcon,
    title: 'Photos & Files',
    subtitle: 'Attach evidence, not just descriptions',
    description:
      'Pick images and files from your gallery to attach to project issues, field visit reports, and work orders — so every record is complete.',
    bullets: [
      'Attach files to project issues',
      'Upload visit photos from gallery',
      'Share documents with your team',
    ],
    androidPermission:
      Number(Platform.Version) >= 33
        ? (PermissionsAndroid.PERMISSIONS as any).READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    androidRationale: {
      title: 'Photos Permission',
      message: 'CES Work needs gallery access to attach photos to your work records.',
      buttonPositive: 'Allow',
    },
  },
  {
    id: 'notifications',
    color: '#D97706',
    lightColor: '#FEF3C7',
    ringColor: 'rgba(217,119,6,0.10)',
    Icon: Bell,
    title: 'Notifications',
    subtitle: 'Never miss a critical update',
    description:
      'Receive real-time alerts for task assignments, leave approvals, payroll updates, and important announcements from your team.',
    bullets: [
      'Instant task & approval alerts',
      'Payroll & payslip notifications',
      'Team announcements & updates',
    ],
    androidPermission:
      Number(Platform.Version) >= 33
        ? (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS
        : null,
    androidRationale: {
      title: 'Notification Permission',
      message: 'Allow CES Work to send you alerts for tasks, approvals and updates.',
      buttonPositive: 'Allow',
    },
  },
];

type Perm = (typeof PERMS)[0];

/* ─── Permission request ─────────────────────────────────── */
async function requestPermission(perm: Perm): Promise<void> {
  if (Platform.OS !== 'android' || !perm.androidPermission) return;
  try {
    await PermissionsAndroid.request(perm.androidPermission, perm.androidRationale);
  } catch (_) {}
}

/* ─── Single slide ───────────────────────────────────────── */
function PermSlide({ item: perm }: { item: Perm }) {
  const { Icon } = perm;
  return (
    <View style={[styles.slide, { width: W }]}>
      {/* Illustration area */}
      <View style={[styles.illustration, { backgroundColor: perm.lightColor }]}>
        <View style={[styles.ringOuter, { backgroundColor: perm.ringColor }]} />
        <View style={[styles.ringInner, { backgroundColor: perm.ringColor }]} />
        <View style={[styles.iconCircle, { backgroundColor: perm.color }]}>
          <Icon size={48} color="#FFFFFF" strokeWidth={1.8} />
        </View>
      </View>
    </View>
  );
}

/* ─── Dot strip ──────────────────────────────────────────── */
function Dots({ active, color }: { active: number; color: string }) {
  return (
    <View style={styles.dotsRow}>
      {PERMS.map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            i === active
              ? { backgroundColor: color, width: 24 }
              : { backgroundColor: '#CBD5E1', width: 7 },
          ]}
        />
      ))}
    </View>
  );
}

/* ─── Main screen ────────────────────────────────────────── */
export default function PermissionOnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const flatRef = useRef<FlatList>(null);
  const cardAnim = useRef(new Animated.Value(1)).current;

  const perm = PERMS[step];
  const isLast = step === PERMS.length - 1;

  const animateCardChange = useCallback((nextStep: number) => {
    // Fade + slide out
    Animated.timing(cardAnim, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setStep(nextStep);
      // Scroll the illustration FlatList
      flatRef.current?.scrollToIndex({ index: nextStep, animated: true });
      // Fade + slide back in
      Animated.timing(cardAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [cardAnim]);

  const advance = useCallback(() => {
    if (isLast) {
      finish();
    } else {
      animateCardChange(step + 1);
    }
  }, [isLast, step]);

  const finish = async () => {
    await AsyncStorage.setItem(PERMISSIONS_ONBOARDED_KEY, '1');
    onDone();
  };

  const handleAllow = async () => {
    await requestPermission(perm);
    advance();
  };

  const cardTranslate = cardAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />

      {/* Skip all — top right */}
      <TouchableOpacity
        style={[styles.skipAll, { top: insets.top + 12 }]}
        onPress={finish}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.skipAllText}>Skip all</Text>
      </TouchableOpacity>

      {/* Illustration carousel (non-scrollable by user — controlled programmatically) */}
      <FlatList
        ref={flatRef}
        data={PERMS}
        renderItem={({ item }) => <PermSlide item={item} />}
        keyExtractor={i => i.id}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.illustrationList}
        getItemLayout={(_, index) => ({ length: W, offset: W * index, index })}
      />

      {/* Animated content card */}
      <Animated.View
        style={[
          styles.card,
          {
            opacity: cardAnim,
            transform: [{ translateY: cardTranslate }],
            paddingBottom: Math.max(insets.bottom + 16, 28),
          },
        ]}
      >
        {/* Badge */}
        <View style={[styles.badge, { backgroundColor: perm.lightColor }]}>
          <View style={[styles.badgeDot, { backgroundColor: perm.color }]} />
          <Text style={[styles.badgeText, { color: perm.color }]}>App Permission</Text>
        </View>

        <Text style={styles.title}>{perm.title}</Text>
        <Text style={styles.subtitle}>{perm.subtitle}</Text>
        <Text style={styles.description}>{perm.description}</Text>

        {/* Bullets */}
        <View style={styles.bulletList}>
          {perm.bullets.map((b, i) => (
            <View key={i} style={styles.bulletRow}>
              <View style={[styles.bulletIcon, { backgroundColor: perm.color }]}>
                <Check size={10} color="#FFF" strokeWidth={3} />
              </View>
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Progress dots */}
        <Dots active={step} color={perm.color} />

        {/* Allow */}
        <TouchableOpacity
          style={[styles.allowBtn, { backgroundColor: perm.color }]}
          onPress={handleAllow}
          activeOpacity={0.85}
        >
          <Text style={styles.allowText}>{isLast ? 'Get Started' : 'Allow Access'}</Text>
          <ChevronRight size={18} color="#FFF" />
        </TouchableOpacity>

        {/* Not now */}
        <TouchableOpacity style={styles.notNowBtn} onPress={advance}>
          <Text style={styles.notNowText}>{isLast ? 'Maybe later' : 'Not now'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────── */
const ILLUS_H = H * 0.38;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  skipAll: {
    position: 'absolute',
    right: 18,
    zIndex: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.07)',
  },
  skipAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },

  // FlatList holding illustration slides
  illustrationList: {
    height: ILLUS_H,
    flexGrow: 0,
  },
  slide: {
    height: ILLUS_H,
  },
  illustration: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ringOuter: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  ringInner: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
  },
  iconCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 14,
  },

  // Card
  card: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 26,
    paddingTop: 26,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 14,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 3,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 10,
  },
  description: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#475569',
    marginBottom: 16,
  },
  bulletList: {
    gap: 9,
    marginBottom: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bulletIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bulletText: {
    fontSize: 13.5,
    fontWeight: '500',
    color: '#334155',
    flex: 1,
  },

  // Dots
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    marginBottom: 18,
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },

  // Buttons
  allowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 16,
    paddingVertical: 16,
    marginBottom: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
  allowText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  notNowBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  notNowText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
});
