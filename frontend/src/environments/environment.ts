export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  // Public download link for the Android release build. The APK is ~80MB, so it
  // is served off disk by the backend (see AppDownloadController) rather than
  // committed to the repo — drop the signed build at
  // backend/uploads/app/nex-workspace.apk and it goes live immediately.
  // Leave empty to force the "Coming Soon" state on the landing page.
  androidApkUrl: 'http://localhost:3000/app-download/android'
};
