# MIRA page redesign prompt (UI/UX only, no feature changes)

Copy everything below the line into a new Claude session and add the page name at the end.

---

Redesign the page I name below to the MIRA standard layout. **Change only the look and layout. Do not add, remove or change any feature, API call, permission, data rule or business logic.** Every button, filter, action and pop-up that works today must still work the same way afterwards. Do not commit, deploy or run `ng build`; I test on my local dev server (localhost:4200) and will report errors.

Reference pages that already follow the standard (copy their patterns): `employees/employee-list/employee-list-v2`, `recruitment/job-postings`, `recruitment/candidates`, `recruitment/interviews`, `recruitment/offer-letters`.

## 1. Page header: use the shared component
- Use `<app-page-header>` from `shared/components/page-header/page-header.ts`. Remove the page's own breadcrumb bar, "Back to …" pill and hero/title card.
- Inputs: `icon` (round light-blue icon; add a new key to `iconPaths()` if needed), `section` (parent menu, e.g. "Recruitment"), `heading` (page name), `subtitle` (one short line).
- Back navigation: `[showBack]="true" backLabel="Back to …" (back)="…"`. That is a round ← button inside the header, not a separate pill.
- Buttons go inside the tag, in this order: view switch (Board | Table pills) first, outlined secondary buttons next, the **one** blue primary button last (rightmost). Never a black or dark primary button.

## 2. Filter bar: one row, fixed order
- Order: **Search → main dropdowns (Department, Status, Job, etc.) → date dropdown(s) → "Filters" button (less-used filters) → Clear all**, then "Showing X of Y" pushed to the right.
- Search is always first. No field labels above filters; the placeholder says it ("All departments").
- Dropdowns: `<app-searchable-select>` with `[clearable]="true"`, about 190–220px wide; long values end in "…".
- Dates: `<app-date-preset-filter label="Applied|Joined|Issued|Scheduled…">` (Any time, Today, Yesterday, Last 7 / 30 days, This month, Custom month range). Replace any From/To date boxes or "All / Today / 7d / 30d" pill rows with it.
- More than ~5 filters: put the less-used ones behind a **Filters** button with a count badge and a small panel; show active filters as removable chips if helpful.
- "Clear all": `class="clear-all-filters"` (global style in `styles.css`), shown only while a filter is on, resetting every filter including dates.
- The filter card must sit above the table (`position: relative; z-index: 30; overflow: visible`) so dropdowns are never hidden; check the page wrapper does not have `overflow: hidden`.
- Keep the row on one line (`flex-wrap: nowrap`), wrapping only below ~1100px.
- If filter values are plain properties read inside a `computed()`, make sure changes actually re-filter (signals, or a tick signal).

## 3. Tables: same grid as the Employee Directory
- Use AG Grid (`ag-grid-angular`, `class="ag-theme-quartz"`, `[theme]="'legacy'"`, register `AllCommunityModule`) with `defaultColDef: { sortable: true, filter: true, resizable: true }`.
- Height `calc(100vh - 230px)`, min 480px. Pinned headings. No row checkboxes unless a bulk action actually uses them.
- Pagination: `paginationPageSize` 20, selector `[20, 50, 100, 200]`. For plain HTML tables, use the same footer: "Page Size 20 ▾ · 1 to 20 of N · « ‹ Page 1 of X › »".
- Default view is **Table**; Board/cards stays available through the Board | Table pills.
- Cells: person = photo (or coloured initials if no photo or the photo fails) + name + small grey email; status = soft coloured pill with a dot; dates "12 Nov 2026"; links blue.
- Long text wraps (`wrapText: true, autoHeight: true`), never cut off. Keep short columns (Type, Status, Experience) on one line.
- Row actions are icon buttons (32px, outlined, tooltip and aria-label), not text buttons.
- Clicking a candidate row opens the shared Application Details drawer in place (`<app-candidates [drawerOnly]="true" [openApplicationId]="id">`), not a navigation to another page.

## 4. Cards, stats and colours
- KPI/stat cards: tinted rounded icon box (each tone defined in CSS; no empty boxes), big number, small grey uppercase label. Clicking a card filters the table; the active card gets a blue outline.
- One row of stat cards (scroll sideways if many) rather than wrapping.
- Colours: primary blue `#2563eb`, selected states soft blue `#eff6ff` + `#1d4ed8`. Status tones: blue applied/sent, purple screening, amber interview, orange negotiation, teal offered, green hired/accepted, grey on hold, red rejected/declined.
- Text: sentence case, not ALL CAPS ("Phone screening", not "PHONE_SCREENING"); names in normal case.
- Fonts come from `styles.css`: Outfit for headings (`var(--font-heading)`), Inter for text (`var(--font-body)`). Do not hard-code fonts.
- Remove decorative or fake elements (static "sync active" chips, fallback dummy text such as "Full Stack Engineer" when data is missing).

## 5. Check before finishing
- Every existing action still works: buttons, links, drawers, modals, exports, filters.
- No `| undefined` template errors: use `?.` or `$any()` for optional fields.
- Tell me what changed, page by page, and anything you could not keep identical.

Page to redesign:

## 6. Wording
- View switches always say **Board | Table** (never Grid, Cards, List or Kanban), in that order, as pills in the page header.
- When the second view is a month calendar rather than a table, say **Board | Calendar** (e.g. Holidays).
