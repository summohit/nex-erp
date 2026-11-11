# MIRA UI v2 — How We Work

We are redesigning MIRA's screens without disturbing the live app. The current UI (**v1**) stays the default for every user. New designs are built as **v2** copies next to the old files and are switched on per browser with a URL flag. When v2 is complete we flip the default once, and later delete v1.

## The switch

- Add **`?ui=v2`** to any MIRA URL to see the new UI, e.g. `http://localhost:4200/dashboard?ui=v2`. The choice is remembered in that browser.
- Add **`?ui=v1`** to go back to the current UI.
- The setting lives in `frontend/src/app/core/ui-version.ts` (`DEFAULT_UI = 'v1'`). Don't change the default until the switch-over.
- While v2 is on, the page body has the class `ui-v2`. Any global CSS for v2 must sit under `body.ui-v2` so v1 screens are untouched.

## Screens already in v2

| Screen | v1 (live) | v2 (new design) | Where it is chosen |
|---|---|---|---|
| Sidebar | `layout/sidebar/sidebar.*` | `layout/sidebar/sidebar-v2.*` | `main-layout` |
| Header | `layout/header/header.*` | `layout/header/header-v2.*` | `main-layout` |
| Dashboard | `dashboard/dashboard.*` | `dashboard/dashboard-v2.*` | `app.routes.ts` |
| Login / Sign up | `auth/auth.component.*` | `auth/auth-v2.component.*` | `app.routes.ts` |
| Two-factor | `auth/two-factor/two-factor.*` | `auth/two-factor/two-factor-v2.*` | `app.routes.ts` |
| Employee list | `employees/employee-list/employee-list.*` | `employee-list-v2.*` | `app.routes.ts` |

Page width: v1 sidebar 260px (80px collapsed); v2 rail + panel 320px (68px collapsed), set in `frontend/src/styles.css` under `body.ui-v2`.

## Making a new v2 screen

1. **Copy, don't edit.** Copy the screen's three files next to themselves with `-v2` in the name, e.g. `payroll.ts` → `payroll-v2.ts`, `payroll.html` → `payroll-v2.html`, `payroll.css` → `payroll-v2.css`. Same folder, so every relative import keeps working.
2. **Rename inside the copy:** class `PayrollComponent` → `PayrollComponentV2`, selector `app-payroll` → `app-payroll-v2`, and point `templateUrl` / `styleUrls` at the `-v2` files. Also rename any `PayrollComponent.SOMETHING` static references inside it.
3. **Hook it up:**
   - A routed page: in `app.routes.ts`, pick by version:
     `component: isUiV2() ? PayrollComponentV2 : PayrollComponent`
     or for a lazy route:
     `loadComponent: () => isUiV2() ? import('./payroll/payroll-v2').then(m => m.PayrollComponentV2) : import('./payroll/payroll').then(m => m.PayrollComponent)`
   - A layout part (sidebar, header): `@if (v2) { <app-x-v2/> } @else { <app-x/> }` in `main-layout`.
4. **Change only the look.** Keep using the same services, API calls and models as v1. A bug fix or new feature goes into the shared code (or into both versions) so v1 users get it too.
5. **Real data only.** No hard-coded dates, names, counts or sample tasks in v2 — everything comes from the same APIs v1 uses.
6. **Test both:** open the page with `?ui=v1` and `?ui=v2`, and run `npx ng build` before pushing.

## Rules for everyone

- **Never edit the v1 files for a redesign.** v1 is what every user sees on mira.ces-pl.com.
- **Commit small and often.** v2 is off by default, so v2 work can be merged and deployed at any time without users seeing it.
- **Menus and permissions come from the server.** The v2 sidebar reads the same role-filtered menu as v1 — don't write menu items by hand.
- **Page names match the page.** A menu label, a tab and a page title for the same screen use the same words.
- **Accessibility:** icon-only buttons need a visible label on hover and an `aria-label`.
- **Brand:** use the company logo from Company Profile, not a placeholder letter.

## Open items in the current v2

- **Dashboard v2 shows sample content** — a fixed date, sample sprint tasks, support tickets and a heatmap. Replace with real data before switch-over.
- Header v2 and dashboard v2 both show a Clock In button — keep one.
- Check every v2 screen at laptop width and on mobile.

## Switch-over (when v2 is complete)

1. Change `DEFAULT_UI` to `'v2'` in `core/ui-version.ts` and deploy. Everyone gets the new UI; `?ui=v1` is the way back if something breaks.
2. After one to two weeks without problems, delete the v1 files, rename the `-v2` files back to the plain names, and remove the switch.
