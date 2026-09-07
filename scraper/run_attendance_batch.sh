#!/bin/bash
# Scrape + import CES Tech attendance for a range of months.
set -uo pipefail
ROOT="/Users/mohitsingh/Documents/nex-erp"
SCR="$ROOT/scraper"
BK="$ROOT/backend"
PY="$SCR/.venv/bin/python"
TS="$BK/node_modules/.bin/ts-node"

# months: 2025-01 .. 2026-09
MONTHS=()
for y in 2025 2026; do
  last=12; [ "$y" = "2026" ] && last=9
  for m in $(seq 1 $last); do MONTHS+=("$y $m"); done
done

echo "=== batch start: ${#MONTHS[@]} months ==="
for pair in "${MONTHS[@]}"; do
  set -- $pair; Y=$1; M=$2
  MM=$(printf "%02d" "$M")
  echo ">>> $Y-$MM scraping..."
  ( cd "$SCR" && "$PY" workway_attendance.py --month "$M" --year "$Y" >/dev/null 2>&1 )
  f="$SCR/out_hr/attendance-$Y-$MM.json"
  if [ ! -f "$f" ]; then echo "    !! no scrape output for $Y-$MM, skipping"; continue; fi
  rows=$("$PY" -c "import json;print(sum(len(e['records']) for e in json.load(open('$f'))))" 2>/dev/null)
  echo ">>> $Y-$MM importing ($rows day-records)..."
  ( cd "$BK" && "$TS" import-ces-attendance.ts --file "$f" --commit 2>&1 | grep -vE "injected env" | grep -E "attendance rows|punch logs|failed|unmatched" | sed 's/^/    /' )
done
echo "=== batch done ==="
