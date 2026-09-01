export const environment = {
  production: true,
  apiUrl: 'https://nex.ces-pl.com/api',
  // Public download link for the Android release build. The APK is ~80MB, so it
  // is served off disk by the backend (see AppDownloadController) rather than
  // committed to the repo — drop the signed build at
  // backend/uploads/app/nex-workspace.apk and it goes live immediately.
  // Leave empty to force the "Coming Soon" state on the landing page.
  androidApkUrl: 'https://nex.ces-pl.com/api/app-download/android'
};
