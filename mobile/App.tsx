import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { initPushListeners } from './src/native/pushNotifications';
import { navigateTo, navigationRef } from './src/navigation/navigationUtils';

function App(): React.JSX.Element {
  useEffect(() => {
    /*
     * Push listeners live here rather than in a screen, for two reasons.
     *
     * getInitialNotification() resolves exactly once, with whatever launched
     * the app — mounting it inside a screen means a notification tapped from a
     * killed app is read by whichever screen happens to mount first, or missed
     * entirely. And onTokenRefresh has to be running whenever the app is, since
     * a token that rotates unnoticed silently ends all push for that device.
     *
     * Registration itself is NOT here: it belongs to a signed-in session and is
     * done by authStore on login and on token restore.
     */
    const unsubscribe = initPushListeners({
      onOpenedFromNotification: (data) => {
        // The container may not be mounted yet when a tap launched the app from
        // killed — navigating into an unready ref is a no-op crash risk, and
        // the user lands on Home, which is an acceptable fallback.
        if (!navigationRef.isReady()) return;

        // Shift reminders are about clocking, so they go to Attendance. Anything
        // else opens the app without a guess at a route that may not exist.
        const isShiftReminder =
          data?.type === 'ACTION_REQUIRED' || (data?.linkUrl ?? '').includes('attendance');
        if (isShiftReminder) navigateTo(navigationRef, 'Attendance');
      },
    });

    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
    </SafeAreaProvider>
  );
}

export default App;
