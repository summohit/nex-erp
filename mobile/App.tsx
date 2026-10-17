import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { initPushListeners } from './src/native/pushNotifications';
import { navigateTo, navigationRef } from './src/navigation/navigationUtils';
import { routeForLink } from './src/native/notificationRoutes';
import UpdateGate from './src/components/UpdateGate';

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
        // Open the screen the notification is about (16 Oct 2026). A tap that
        // launched a killed app arrives before navigation is mounted, so it
        // waits for it (up to ~10 s) instead of being dropped.
        const target = routeForLink(data?.linkUrl);
        let tries = 0;
        const go = () => {
          if (navigationRef.isReady()) {
            // Signed out (Login on screen): there is nowhere to go yet.
            try { navigateTo(navigationRef, target.screen, target.params); } catch {}
          } else if (tries++ < 40) {
            setTimeout(go, 250);
          }
        };
        go();
      },
    });

    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <AppNavigator />
      <UpdateGate />
    </SafeAreaProvider>
  );
}

export default App;
