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
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarButtonTestID}
            onPress={onPress}
            activeOpacity={0.7}
            style={styles.tabItem}
          >
            <View style={[styles.iconWrapper, isFocused && styles.iconWrapperActive]}>
              <Icon
                size={21}
                color={isFocused ? '#E25E3E' : '#64748B'}
                strokeWidth={isFocused ? 2.3 : 1.8}
              />
            </View>
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
      <Tab.Screen name="Profile" component={CRMScreen} />
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
  bottomTabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
    paddingHorizontal: 8,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  iconWrapper: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  iconWrapperActive: {
    backgroundColor: '#FFF1EC',
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
    color: '#64748B',
  },
});

