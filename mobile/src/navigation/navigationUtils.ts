import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

export const TAB_SCREENS = new Set(['Home', 'Attendance', 'Projects', 'Leaves', 'Profile']);

/**
 * Safely navigates to a screen whether it is a top-level Stack screen
 * or nested inside MainTabs, regardless of where in the component hierarchy
 * or navigator tree this is invoked from.
 */
export function navigateTo(navigation: any, screen: string, params?: any) {
  if (TAB_SCREENS.has(screen)) {
    const routeNames = navigation?.getState?.()?.routeNames;
    // If the current navigator directly hosts this tab (e.g. we are already inside MainTabs)
    if (Array.isArray(routeNames) && routeNames.includes(screen)) {
      navigation.navigate(screen, params);
    } else {
      // If we are in the root stack (or another nested stack), target MainTabs
      navigation.navigate('MainTabs', {
        screen,
        params,
      });
    }
  } else {
    // Stack screen
    navigation.navigate(screen, params);
  }
}
