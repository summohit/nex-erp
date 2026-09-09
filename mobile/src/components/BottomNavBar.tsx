import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated } from 'react-native';
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
  const iconScale = useRef(new Animated.Value(isFocused ? 1 : 0.95)).current;
  const pillScale = useRef(new Animated.Value(isFocused ? 1 : 0.4)).current;
  const pillOpacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(iconScale, {
        toValue: isFocused ? 1 : 0.95,
        useNativeDriver: true,
        friction: 6,
        tension: 160,
      }),
      Animated.spring(pillScale, {
        toValue: isFocused ? 1 : 0.4,
        useNativeDriver: true,
        friction: 6,
        tension: 160,
      }),
      Animated.timing(pillOpacity, {
        toValue: isFocused ? 1 : 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isFocused, iconScale, pillScale, pillOpacity]);

  const handlePressIn = () => {
    Animated.spring(iconScale, { toValue: 0.88, useNativeDriver: true, friction: 5, tension: 200 }).start();
  };

  const handlePressOut = () => {
    Animated.spring(iconScale, { toValue: isFocused ? 1 : 0.95, useNativeDriver: true, friction: 5, tension: 160 }).start();
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={0.8}
      style={styles.tabItem}
    >
      {/* Squircle Icon Badge */}
      <Animated.View
        style={[
          styles.iconSquircle,
          isFocused ? styles.iconSquircleActive : styles.iconSquircleInactive,
          { transform: [{ scale: iconScale }] },
        ]}
      >
        <Icon
          size={21}
          color={isFocused ? '#FFFFFF' : '#64748B'}
          strokeWidth={isFocused ? 2.3 : 1.9}
        />
      </Animated.View>

      {/* Tab Label */}
      <Text style={[styles.tabLabel, isFocused ? styles.tabLabelActive : styles.tabLabelInactive]}>
        {label}
      </Text>

      {/* Rounded bottom indicator pill */}
      {isFocused ? (
        <Animated.View
          style={[
            styles.activeIndicatorPill,
            { opacity: pillOpacity, transform: [{ scaleX: pillScale }] },
          ]}
        />
      ) : (
        <View style={styles.indicatorPlaceholder} />
      )}
    </TouchableOpacity>
  );
}

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

  const handlePress = (routeName: string) => {
    if (onTabPress) {
      onTabPress(routeName);
      return;
    }
    navigation.navigate('MainTabs', { screen: routeName });
  };

  return (
    <View style={[styles.wrapper, { paddingBottom: bottomMargin }]}>
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
    paddingHorizontal: 16,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  floatingBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    paddingVertical: 8,
    paddingHorizontal: 6,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 12,
    borderWidth: Platform.OS === 'ios' ? 1 : 0,
    borderColor: 'rgba(226, 232, 240, 0.8)',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  iconSquircle: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSquircleInactive: {
    backgroundColor: '#F8FAFC',
  },
  iconSquircleActive: {
    backgroundColor: '#E25E3E',
    shadowColor: '#E25E3E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  tabLabel: {
    fontSize: 11,
    letterSpacing: 0.1,
    marginTop: 3,
  },
  tabLabelActive: {
    color: '#E25E3E',
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: '#64748B',
    fontWeight: '500',
  },
  activeIndicatorPill: {
    width: 22,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#E25E3E',
    marginTop: 3,
  },
  indicatorPlaceholder: {
    height: 3.5,
    marginTop: 3,
  },
});
