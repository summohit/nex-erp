export const environment = {
  // Temporarily hidden on the public site. Self-service sign-up and the Android
  // APK download are built and working — these only control whether the landing
  // page and login screen offer them. Flip back to true to restore both.
  publicSignupEnabled: false,
  mobileAppSectionEnabled: false,
  // Tawk.to live chat, careers page only. Both ids come from the Tawk
  // dashboard (Administration → Chat Widget); the embed URL is
  // https://embed.tawk.to/<propertyId>/<widgetId>. Leave either empty and the
  // widget stays off, which is what every non-production build wants.
  tawkPropertyId: '69c3bd8135e8d61c3a87568a',
  tawkWidgetId: '1jki9ogko',
  production: true,
  apiUrl: 'https://mira.ces-pl.com/api',
  // Public download link for the Android release build. The APK is ~80MB, so it
  // is served off disk by the backend (see AppDownloadController) rather than
  // committed to the repo — drop the signed build at
  // backend/uploads/app/nex-workspace.apk and it goes live immediately.
  // Leave empty to force the "Coming Soon" state on the landing page.
  androidApkUrl: 'https://mira.ces-pl.com/api/app-download/android',
};
