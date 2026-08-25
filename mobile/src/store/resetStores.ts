/**
 * Wipes every user-scoped Zustand store back to its initial state.
 *
 * Zustand stores are in-memory singletons that outlive a logout, so without this
 * the next account to sign in on the same device inherits the previous user's
 * profile, projects, timesheets and notifications until each screen's refetch
 * happens to land — which shows one user another user's data.
 *
 * authStore is deliberately excluded: its logout() already sets the exact signed
 * out state, and resetting it to initial would flip isLoading back to true and
 * bounce the app to the splash screen.
 */
import { useDashboardStore } from './dashboardStore';
import { useFieldVisitStore } from './fieldVisitStore';
import { useLeaveStore } from './leaveStore';
import { useMenuStore } from './menuStore';
import { useProfileStore } from './profileStore';
import { useProjectStore } from './projectStore';
import { useTimesheetStore } from './timesheetStore';

const USER_SCOPED_STORES = [
  useDashboardStore,
  useFieldVisitStore,
  useLeaveStore,
  useMenuStore,
  useProfileStore,
  useProjectStore,
  useTimesheetStore,
];

/** The stores have different state shapes, so reach for the common store API. */
type ResettableStore = {
  setState: (state: unknown, replace: true) => void;
  getInitialState: () => unknown;
};

export function resetUserScopedStores() {
  for (const store of USER_SCOPED_STORES) {
    const api = store as unknown as ResettableStore;
    // `true` replaces the state outright rather than merging, so stale keys are
    // dropped. getInitialState() still carries the actions, so the store stays usable.
    api.setState(api.getInitialState(), true);
  }
}
