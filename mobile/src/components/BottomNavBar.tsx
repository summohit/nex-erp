import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated, LayoutAnimation, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Home, FolderKanban, Clock, CalendarDays, UserCircle } from 'lucide-react-native';

/**
 * The five primary destinations in the bottom navigation bar.
 * Using modern contextual Lucide icons matching the executive design system.
 */
export const TABS: {
  name: string;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
}[] = [
  { name: 'Home', label: 'Home', Icon: Home },
  { name: 'Attendance', label: 'Attendance', Icon: Clock },
  { name: 'Projects', label: 'Projects', Icon: FolderKanban },
  { name: 'Leaves', label: 'Leaves', Icon: CalendarDays },
  { name: 'Profile', label: 'Profile', Icon: UserCircle },
];

function TabBarItem({
  isFocused,
  onPress,
  label,
  Icon,
  accessibilityLabel,
  testID,
}: {
  isFocused: boolean;
  onPress: () => void;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const press = useRef(new Animated.Value(1)).current;
  const reveal = useRef(new Animated.Value(isFocused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(reveal, { toValue: isFocused ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [isFocused, reveal]);

  const handlePressIn = () => Animated.spring(press, { toValue: 0.9, useNativeDriver: true, friction: 5, tension: 220 }).start();
  const handlePressOut = () => Animated.spring(press, { toValue: 1, useNativeDriver: true, friction: 5, tension: 160 }).start();

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={0.9}
      style={[styles.tabItem, isFocused && styles.tabItemActive]}
    >
      <Animated.View style={[styles.tabInner, isFocused && styles.tabInnerActive, { transform: [{ scale: press }] }]}>
        <Icon size={isFocused ? 19 : 21} color={isFocused ? NAV.active : NAV.idle} strokeWidth={isFocused ? 2.5 : 2} />
        {isFocused ? (
          <Animated.Text style={[styles.activeLabel, { opacity: reveal }]} numberOfLines={1}>
            {label}
          </Animated.Text>
        ) : (
          <Text style={styles.idleLabel} numberOfLines={1}>{label}</Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

/** Bar colours: the navy of the screen heroes (theme/ds.ts). */
const NAV = {
  bar: '#0F172A',
  barBorder: 'rgba(255,255,255,0.08)',
  active: '#1373E5',
  idle: '#94A3B8',
};

export default function BottomNavBar({
  activeRoute,
  onTabPress,
}: {
  activeRoute?: string | null;
  onTabPress?: (routeName: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const bottomMargin = Platform.OS === 'android' ? Math.max(insets.bottom, 10) : Math.max(insets.bottom, 12);
  const prev = useRef(activeRoute);

  // The active pill widens and the others narrow: animate that layout change.
  if (prev.current !== activeRoute) {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'scaleXY'));
    prev.current = activeRoute;
  }

  const handlePress = (routeName: string) => {
    if (onTabPress) {
      onTabPress(routeName);
      return;
    }
    navigation.navigate('MainTabs', { screen: routeName });
  };

  return (
    <View style={[styles.wrapper, { paddingBottom: bottomMargin }]} pointerEvents="box-none">
      <View style={styles.floatingBar}>
        {TABS.map((tab) => (
          <TabBarItem
            key={tab.name}
            isFocused={activeRoute === tab.name}
            onPress={() => handlePress(tab.name)}
            label={tab.label}
            Icon={tab.Icon}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 14,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  floatingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: NAV.bar,
    borderRadius: 26,
    padding: 6,
    gap: 4,
    borderWidth: 1,
    borderColor: NAV.barBorder,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 14,
  },
  tabItem: {
    flex: 1,
    height: 54,
  },
  tabItemActive: {
    flex: 1.9,
  },
  tabInner: {
    flex: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabInnerActive: {
    flexDirection: 'row',
    gap: 7,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    shadowColor: NAV.active,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  activeLabel: {
    fontSize: 12.5,
    fontWeight: '800',
    color: NAV.bar,
    flexShrink: 1,
  },
  idleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: NAV.idle,
    letterSpacing: 0.1,
  },
});
