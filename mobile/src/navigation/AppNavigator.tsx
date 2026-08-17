import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '../store/authStore';

import { Home, Briefcase, Clock, Calendar, UserCircle } from 'lucide-react-native';
import { theme } from '../theme/theme';

import LoginScreen from '../screens/Auth/LoginScreen';
import DashboardScreen from '../screens/Dashboard/DashboardScreen';
import CRMScreen from '../screens/CRM/CRMScreen';
import ProjectsScreen from '../screens/Projects/ProjectsScreen';
import ProjectDetailScreen from '../screens/Projects/ProjectDetailScreen';
import ESSScreen from '../screens/ESS/ESSScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Custom Floating Pill Bottom Tab Bar
function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomMargin = Platform.OS === 'android' ? Math.max(insets.bottom, 12) : insets.bottom || 12;

  return (
    <View style={[styles.floatingTabBarContainer, { bottom: bottomMargin }]}>
      <View style={styles.floatingTabBar}>
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
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              activeOpacity={0.8}
              style={[
                styles.tabItem,
                isFocused && styles.tabItemActive,
              ]}
            >
              <Icon
                size={20}
                color={isFocused ? '#E25E3E' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.tabLabel,
                  isFocused ? styles.tabLabelActive : styles.tabLabelInactive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
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
      <Tab.Screen name="Attendance" component={CRMScreen} />
      <Tab.Screen name="Projects" component={ProjectsScreen} />
      <Tab.Screen name="Leaves" component={ESSScreen} />
      <Tab.Screen name="Profile" component={ESSScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isLoading, token, restoreToken } = useAuthStore();

  useEffect(() => {
    restoreToken();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' }}>
        <ActivityIndicator size="large" color="#E25E3E" />
      </View>
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  floatingTabBarContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  floatingTabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    paddingHorizontal: 4,
    paddingVertical: 4,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#94A3B8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 26,
    marginHorizontal: 2,
  },
  tabItemActive: {
    backgroundColor: '#FFF1EC',
    paddingVertical: 12,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
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

