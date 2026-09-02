import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import BootSplash from 'react-native-bootsplash';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '../store/authStore';

import { Home, Briefcase, Clock, Calendar, UserCircle } from 'lucide-react-native';
import { theme } from '../theme/theme';

import LoginScreen from '../screens/Auth/LoginScreen';
import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import ProfileScreen from '../screens/Profile/ProfileScreen';
import ProjectsScreen from '../screens/Projects/ProjectsScreen';
import ProjectDetailScreen from '../screens/Projects/ProjectDetailScreen';
import TeamMembersScreen from '../screens/Projects/TeamMembersScreen';
import ESSScreen from '../screens/ESS/ESSScreen';
import CRMScreen from '../screens/CRM/CRMScreen';
import NotificationsScreen from '../screens/Notifications/NotificationsScreen';
import PayslipsScreen from '../screens/Payslips/PayslipsScreen';
import SplashScreen from '../components/SplashScreen';
import FieldVisitScreen from '../screens/FieldVisit/FieldVisitScreen';
import HardwareRequestScreen from '../screens/Assets/HardwareRequestScreen';
import TicketsScreen from '../screens/Tickets/TicketsScreen';
import PermissionOnboardingScreen, { PERMISSIONS_ONBOARDED_KEY } from '../screens/Onboarding/PermissionOnboardingScreen';

// How long the branded splash stays up at minimum, so its animation reads as
// intentional instead of flashing past. Lower this if startup feels slow.
const MIN_SPLASH_MS = 1600;

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Animated tab item with springy icon pop, glowing pill backdrop and gentle lift
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
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const iconScale = useRef(new Animated.Value(isFocused ? 1 : 0.92)).current;
  const lift = useRef(new Animated.Value(isFocused ? -3 : 0)).current;
  const pillOpacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
  const pillScale = useRef(new Animated.Value(isFocused ? 1 : 0.4)).current;
  const dotOpacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(iconScale, {
        toValue: isFocused ? 1 : 0.92,
        friction: 3.5,
        tension: 320,
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: isFocused ? -3 : 0,
        friction: 5,
        tension: 300,
        useNativeDriver: true,
      }),
      Animated.timing(pillOpacity, { toValue: isFocused ? 1 : 0, duration: 200, useNativeDriver: true }),
      Animated.spring(pillScale, {
        toValue: isFocused ? 1 : 0.4,
        friction: 5,
        tension: 260,
        useNativeDriver: true,
      }),
      Animated.timing(dotOpacity, { toValue: isFocused ? 1 : 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, [isFocused]);

  const handlePressIn = () => {
    Animated.spring(iconScale, { toValue: 0.85, speed: 40, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(iconScale, {
      toValue: isFocused ? 1 : 0.92,
      friction: 3.5,
      tension: 300,
      useNativeDriver: true,
    }).start();
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
      activeOpacity={1}
      style={styles.tabItem}
    >
      <Animated.View style={[styles.iconWrapper, { transform: [{ translateY: lift }] }]}>
        <Animated.View
          style={[
            styles.iconPill,
            { opacity: pillOpacity, transform: [{ scale: pillScale }] },
          ]}
        />
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Icon
            size={21}
            color={isFocused ? '#E25E3E' : '#94A3B8'}
            strokeWidth={isFocused ? 2.4 : 1.8}
          />
        </Animated.View>
      </Animated.View>
      <Text style={[styles.tabLabel, isFocused ? styles.tabLabelActive : styles.tabLabelInactive]}>
        {label}
      </Text>
      <Animated.View style={[styles.activeDot, { opacity: dotOpacity }]} />
    </TouchableOpacity>
  );
}

// Custom Sleek Modern Bottom Tab Bar
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Platform.OS === 'android' ? Math.max(insets.bottom, 8) : insets.bottom || 8;

  return (
    <View style={[styles.bottomTabBar, { paddingBottom: bottomPadding }]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        let Icon = Home;
        let label = route.name;

        if (route.name === 'Home') {
          Icon = Home;
          label = 'Home';
        } else if (route.name === 'Attendance') {
          Icon = Clock;
          label = 'Attendance';
        } else if (route.name === 'Projects') {
          Icon = Briefcase;
          label = 'Projects';
        } else if (route.name === 'Leaves') {
          Icon = Calendar;
          label = 'Leaves';
        } else if (route.name === 'Profile') {
          Icon = UserCircle;
          label = 'Profile';
        }

        return (
          <TabBarItem
            key={route.key}
            isFocused={isFocused}
            onPress={onPress}
            label={label}
            Icon={Icon}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarButtonTestID}
          />
        );
      })}
    </View>
  );
}

function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen 
        name="Attendance" 
        component={ESSScreen} 
        initialParams={{ initialTab: 'timesheets' }} 
      />
      <Tab.Screen name="Projects" component={ProjectsScreen} />
      <Tab.Screen 
        name="Leaves" 
        component={ESSScreen} 
        initialParams={{ initialTab: 'leaves' }} 
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isLoading, token, restoreToken, refreshUserProfile } = useAuthStore();
  const [minSplashDone, setMinSplashDone] = useState(false);
  const [permissionsShown, setPermissionsShown] = useState<boolean | null>(null);

  useEffect(() => {
    // Hand off to the animated splash immediately. The JS splash is already
    // painted underneath with the logo at the same size and position, so the
    // native fade-out reads as one continuous screen.
    BootSplash.hide({ fade: true });

    const timer = setTimeout(() => setMinSplashDone(true), MIN_SPLASH_MS);

    // Check if permission onboarding was already completed
    AsyncStorage.getItem(PERMISSIONS_ONBOARDED_KEY)
      .then(val => setPermissionsShown(!!val))
      .catch(() => setPermissionsShown(true)); // default to shown on error

    restoreToken().then(() => {
      if (useAuthStore.getState().token) {
        refreshUserProfile().catch(() => {});
        // Pre-fetch sidebar menus so the drawer is populated immediately
        import('../store/menuStore').then(({ useMenuStore }) => {
          useMenuStore.getState().fetchMenus().catch(() => {});
        });
      }
    });

    return () => clearTimeout(timer);
  }, []);

  if (isLoading || !minSplashDone || permissionsShown === null) {
    return <SplashScreen />;
  }

  // Show permission onboarding once after first login
  if (token && !permissionsShown) {
    return (
      <PermissionOnboardingScreen onDone={() => setPermissionsShown(true)} />
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token == null ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabNavigator} />
            <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
            <Stack.Screen name="TeamMembers" component={TeamMembersScreen} />
            <Stack.Screen name="CRM" component={CRMScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Payslips" component={PayslipsScreen} />
            <Stack.Screen name="FieldVisit" component={FieldVisitScreen} />
            <Stack.Screen name="HardwareRequests" component={HardwareRequestScreen} />
            <Stack.Screen name="Tickets" component={TicketsScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0,
    paddingTop: 10,
    paddingHorizontal: 6,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 12,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  iconWrapper: {
    width: 46,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  iconPill: {
    position: 'absolute',
    width: 42,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF1EC',
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E25E3E',
    marginTop: 3,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  tabLabelActive: {
    color: '#E25E3E',
    fontWeight: '700',
  },
  tabLabelInactive: {
    color: '#94A3B8',
  },
});

