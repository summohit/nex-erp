#!/usr/bin/env bash
# Regenerates every Play Store asset in mobile/store-assets/play-store/.
# Run from the mobile/ directory:  bash store-assets/src/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../play-store"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
export SP="$HERE/.build"

mkdir -p "$SP" "$OUT/screenshots-phone" "$OUT/screenshots-phone-captioned"

# Re-extract lucide icon paths from node_modules (keeps icons in step with the app).
node "$HERE/icons.js" "$HERE/icons.json"

shot() { # shot <html> <png> <w> <h> <scale>
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --screenshot="$2" --window-size="$3,$4" --force-device-scale-factor="$5" "$1" >/dev/null 2>&1
}

node "$HERE/screens.js"
for n in s1 s2 s3 s4; do shot "$SP/$n.html" "$SP/$n.png" 360 640 3; done

node "$HERE/captioned.js"
for n in c1 c2 c3 c4; do shot "$SP/$n.html" "$SP/$n.png" 360 640 3; done

node "$HERE/brand.js"
shot "$SP/icon.html"    "$SP/icon-512.png"           512  512 1
shot "$SP/feature.html" "$SP/feature-1024x500.png"  1024  500 1

cp "$SP/icon-512.png"          "$OUT/app-icon-512.png"
cp "$SP/feature-1024x500.png"  "$OUT/feature-graphic-1024x500.png"
cp "$SP/s1.png" "$OUT/screenshots-phone/01-dashboard.png"
cp "$SP/s2.png" "$OUT/screenshots-phone/02-attendance.png"
cp "$SP/s3.png" "$OUT/screenshots-phone/03-field-visits.png"
cp "$SP/s4.png" "$OUT/screenshots-phone/04-payslip.png"

cp "$SP/c1.png" "$OUT/screenshots-phone-captioned/01-clock-in.png"
cp "$SP/c2.png" "$OUT/screenshots-phone-captioned/02-insights.png"
cp "$SP/c3.png" "$OUT/screenshots-phone-captioned/03-field-visits.png"
cp "$SP/c4.png" "$OUT/screenshots-phone-captioned/04-payslips.png"

echo "Assets written to $OUT"
