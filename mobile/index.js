/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { getApp } from '@react-native-firebase/app';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import notifee from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { displayRemote, handleNotificationEvent } from './src/native/notificationDisplay';

// Pushes that arrive while the app is closed or in the background: Android
// gets them as data only, so the app draws them (buttons, photo, grouping).
try {
  setBackgroundMessageHandler(getMessaging(getApp()), displayRemote);
} catch {}

// Approve / Reject pressed while the app is closed.
notifee.onBackgroundEvent((event) => handleNotificationEvent(event));

AppRegistry.registerComponent(appName, () => App);
