# Play Store listing assets — NEX ERP

Generated graphics for the Google Play listing of `com.cestech.nexerp`.

## What's here

| File | Size | Play Console field |
| --- | --- | --- |
| `play-store/app-icon-512.png` | 512 × 512 | App icon |
| `play-store/feature-graphic-1024x500.png` | 1024 × 500 | Feature graphic |
| `play-store/screenshots-phone/01-dashboard.png` | 1080 × 1920 | Phone screenshots |
| `play-store/screenshots-phone/02-attendance.png` | 1080 × 1920 | Phone screenshots |
| `play-store/screenshots-phone/03-field-visits.png` | 1080 × 1920 | Phone screenshots |
| `play-store/screenshots-phone/04-payslip.png` | 1080 × 1920 | Phone screenshots |
| `play-store/screenshots-phone-captioned/*.png` (4) | 1080 × 1920 | Phone screenshots (marketing variant) |

Two screenshot sets are provided — upload **one** of them. `screenshots-phone/`
is the plain app captures; `screenshots-phone-captioned/` puts each screen in a
device frame on a branded panel with a headline, which typically converts better
on the listing. The captioned set is the recommended one.

All PNGs are opaque, well under Play's limits (1 MB for the icon, 8 MB per
screenshot), and the screenshots are exactly 9:16 — the tallest ratio Play
accepts for phones.

## How they were made

The screenshots are pixel-faithful recreations of the app's own screens: the
same colours, radii, spacing and lucide icons the React Native code uses, laid
out in HTML at 360 × 640 dp and captured at 3× through headless Chrome. They are
not captures of a running build — the sample employee, projects and amounts are
made up. Swap in real device captures before launch if you'd rather ship those;
see "Capturing from a real device" below.

The icon and feature graphic reuse the real brand mark from
`frontend/public/icon.png`, so store and product stay in step.

## Regenerating

Requires Google Chrome and the mobile `node_modules` installed.

```bash
cd mobile && bash store-assets/src/build.sh
```

Sources live in `src/`: `screens.js` builds the four phone screens,
`captioned.js` wraps those into the headlined marketing panels, `brand.js`
builds the icon and feature graphic, and `icons.js` re-extracts lucide icon
paths from `node_modules` so the artwork follows the app's icon set.

Headlines live in the `PANELS` array at the top of `src/captioned.js` — edit the
`eyebrow`, `head` and `sub` strings there and re-run the build to reword them.

## Capturing from a real device

If you want genuine captures instead, run a debug build against a seeded
account and pull frames off the emulator:

```bash
adb exec-out screencap -p > 01-dashboard.png
```

Crop or scale to 1080 × 1920 before uploading, and keep the same four screens so
the listing story stays the same.
