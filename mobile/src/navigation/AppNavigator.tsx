import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import BootSplash from 'react-native-bootsplash';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { navigationRef } from './navigationUtils';

import { useAuthStore } from '../store/authStore';

import BottomNavBar from '../components/BottomNavBar';

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

// The bar itself lives in components/BottomNavBar so stack screens can render
// the same one. This adapter only supplies the tab navigator's press handling,
// which must emit `tabPress` so screens can intercept it.
function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const activeRoute = state.routes[state.index]?.name;

  return (
    <BottomNavBar
      activeRoute={activeRoute}
      onTabPress={(routeName) => {
        const route = state.routes.find((r) => r.name === routeName);
        if (!route) return;

        const isFocused = state.routes[state.index]?.key === route.key;
        const event = navigation.emit({
          type: 'tabPress',
          target: route.key,
          canPreventDefault: true,
        });

        if (!isFocused && !event.defaultPrevented) {
          navigation.navigate(routeName);
        }
      }}
    />
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
  }, [restoreToken, refreshUserProfile]);

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
    <NavigationContainer ref={navigationRef}>
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


