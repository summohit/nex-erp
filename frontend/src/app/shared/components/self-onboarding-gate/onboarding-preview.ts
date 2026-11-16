import { environment } from '../../../../environments/environment';

export type OnboardingPreviewStep = 'password' | 'profile' | 'review';

/**
 * Local-only preview of the self-service onboarding screens (16 Nov 2026), so
 * the look can be checked without an employee who is mid-onboarding:
 *   http://localhost:4200/dashboard?previewOnboarding=profile   (or password, review)
 *
 * Ignored in production builds. Kept in its own small file so the main layout
 * can ask without pulling the whole (deferred) gate into the first download.
 */
export function onboardingPreviewStep(): OnboardingPreviewStep | null {
  if (environment.production) return null;
  const v = new URLSearchParams(window.location.search).get('previewOnboarding');
  return v === 'password' || v === 'profile' || v === 'review' ? v : null;
}
