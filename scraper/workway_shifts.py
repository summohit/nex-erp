#!/usr/bin/env python3
"""Scrape CES Tech (Worksuite) shift definitions and the weekly shift roster.

Two sources, because Workway splits them:

  * shift TYPES  - /account/settings/attendance-settings?tab=shift
                   Two shapes share the table: clock-based shifts carry start /
                   half-day / end times, while duration-only shifts (Comp-Off,
                   Half Day) carry just total and half-day hours.
  * shift ROSTER - /account/shifts, a weekly employee x day grid. A cell is
                   either a shift, "Day Off", or a "+" button meaning nothing is
                   assigned that day. Rows link to /account/employees/{id}, so
                   each row can be tied back to a Workway user id.

    python workway_shifts.py --storage-state auth/cestech-hr.json --weeks 4

Output: out_hr/shifts.json  { types: [...], roster: [...], defaults: [...] }
plus out_hr/shifts.csv and out_hr/shift-roster.csv.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

log = logging.getLogger("workway.shifts")
BASE = "https://cestech.workway.pro"

# The settings table only renders a summary. Every field lives in the row's
# "Update Shift" modal, which has no fetchable route (the edit URLs 500), so the
# modal is opened per row and its form read. The modal traps clicks and will not
# dismiss, hence the reload between rows.
FORM_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = {};
  document.querySelectorAll('.modal input, .modal select, .modal textarea').forEach(el => {
    const name = el.getAttribute('name') || '';
    if (!name) return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    if (['hour', 'minute', 'meridian', '_token', '_method'].includes(name)) return;
    out[name] = el.tagName === 'SELECT'
      ? clean((el.selectedOptions[0] || {}).text)
      : (el.value || '');
  });
  out.__days = [...document.querySelectorAll('.modal input[type=checkbox]')]
    .filter(c => c.checked)
    .map(c => { const p = c.closest('label') || c.parentElement; return clean(p ? p.innerText : ''); })
    .filter(Boolean);
  return out;
}
"""

ROSTER_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const tb = document.querySelector('table');
  if (!tb) return {headers: [], rows: []};
  const headers = [...tb.querySelectorAll('thead th')].map(th => clean(th.innerText));
  const rows = [...tb.querySelectorAll('tbody tr')].map(tr => {
    const tds = [...tr.querySelectorAll('td')];
    const link = tr.querySelector('a[href*="/account/employees/"]');
    const m = link ? link.getAttribute('href').match(/employees\/(\d+)/) : null;
    return {
      user_id: m ? m[1] : '',
      label: clean(tds[0] ? tds[0].innerText : ''),
      // A day cell holds a shift name, "Day Off", or a "+" button (unassigned).
      days: tds.slice(1).map(td => {
        const txt = clean(td.innerText);
        if (txt) return txt;
        return td.querySelector('.change-shift-week') ? '' : '';
      }),
    };
  });
  return {headers, rows};
}
"""

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_TIME = re.compile(r"(\d{1,2}:\d{2}\s*(?:am|pm))", re.I)


def to_24h(t: str) -> str:
    """'09:30 am' -> '09:30'. Returns '' when there is no parseable time."""
    m = re.match(r"(\d{1,2}):(\d{2})\s*(am|pm)", (t or "").strip(), re.I)
    if not m:
        return ""
    h, mi, ap = int(m.group(1)), m.group(2), m.group(3).lower()
    if ap == "pm" and h != 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    return f"{h:02d}:{mi}"


def parse_form(f: dict) -> dict:
    """One 'Update Shift' modal -> the fields we care about."""
    return {
        "name": f.get("shift_name", ""),
        "short_code": f.get("shift_short_code", ""),
        "color": f.get("color", ""),
        # 'strict' shifts run to a clock; 'flexible' ones only to a total-hours target.
        "shift_type": (f.get("shift_type") or "strict").lower(),
        "start_time": to_24h(f.get("office_start_time", "")),
        "end_time": to_24h(f.get("office_end_time", "")),
        "half_day_time": to_24h(f.get("halfday_mark_time", "")),
        "total_hours": f.get("total_shift_hours", ""),
        "half_day_hours": f.get("halfday_shift_hours", ""),
        "auto_clock_out_hours": f.get("auto_clock_out_time", ""),
        "early_clock_in_minutes": f.get("early_clock_in", ""),
        "late_mark_minutes": f.get("late_mark_duration", ""),
        "max_check_ins": f.get("clockin_in_day", ""),
        "working_days": [d for d in DAYS if d in (f.get("__days") or [])],
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-hr.json")
    p.add_argument("--weeks", type=int, default=4,
                   help="how many consecutive weeks of roster to sample (default 4)")
    p.add_argument("--out", default="out_hr/shifts.json")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s", state)
        return 4

    from playwright.sync_api import sync_playwright

    types: list[dict] = []
    roster: list[dict] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        # ── shift definitions, one modal at a time ───────────────────────
        settings_url = f"{BASE}/account/settings/attendance-settings?tab=shift"
        page.goto(settings_url, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)
        n_rows = len(page.query_selector_all("tbody tr"))
        for i in range(n_rows):
            rows = page.query_selector_all("tbody tr")
            btn = rows[i].query_selector("a, button")
            if not btn:
                continue
            btn.click()
            page.wait_for_timeout(3000)
            types.append(parse_form(page.evaluate(FORM_JS)))
            page.goto(settings_url, wait_until="networkidle", timeout=90000)
            page.wait_for_timeout(2000)
        log.info("shift types: %d", len(types))

        # ── roster, one week at a time ───────────────────────────────────
        monday = date.today() - timedelta(days=date.today().weekday())
        for w in range(args.weeks):
            wk = monday - timedelta(weeks=w)
            url = (f"{BASE}/account/shifts?year={wk.year}&month={wk.month:02d}"
                   f"&department=all&userId=all&view_type=week&week_start_date={wk.isoformat()}")
            page.goto(url, wait_until="networkidle", timeout=90000)
            page.wait_for_timeout(3000)
            g = page.evaluate(ROSTER_JS)
            # Header cells read "8 TUESDAY SEP"; pair them back to real dates.
            dates = [(wk + timedelta(days=i)).isoformat() for i in range(len(g["headers"]) - 1)]
            for row in g["rows"]:
                if not row["user_id"]:
                    continue
                for d, cell in zip(dates, row["days"]):
                    roster.append({"user_id": row["user_id"], "label": row["label"],
                                   "date": d, "cell": cell})
            log.info("week of %s: %d row(s)", wk, len(g["rows"]))
        b.close()

    # ── derive a default shift per employee ──────────────────────────────
    # The ERP holds one shift per employee, so take each person's most frequent
    # named shift across the sampled weeks. A cell may also read "Day Off" or
    # carry a leave type (an approved leave shows in place of the shift), so
    # only count cells that start with a name from the shift settings.
    known = sorted((t["name"] for t in types), key=len, reverse=True)
    per_emp: dict[str, Counter] = defaultdict(Counter)
    labels: dict[str, str] = {}
    non_shift: Counter = Counter()
    for r in roster:
        labels[r["user_id"]] = r["label"]
        cell = r["cell"]
        if not cell or cell.lower().startswith("day off"):
            continue
        name = next((k for k in known if cell.startswith(k)), "")
        if not name:
            non_shift[cell.split(" 0")[0].strip()] += 1
            continue
        per_emp[r["user_id"]][name] += 1
    if non_shift:
        log.info("roster cells that were not shifts (leave markers): %s",
                 dict(non_shift.most_common(6)))

    defaults = []
    for uid, label in labels.items():
        c = per_emp.get(uid)
        top = c.most_common(1)[0] if c else None
        defaults.append({
            "user_id": uid,
            "label": label,
            "shift": top[0] if top else "",
            "days_seen": top[1] if top else 0,
            "distinct_shifts": len(c) if c else 0,
        })
    assigned = sum(1 for d in defaults if d["shift"])
    log.info("roster employees: %d (%d with at least one assigned shift)", len(defaults), assigned)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"types": types, "roster": roster, "defaults": defaults},
                              ensure_ascii=False, indent=2), encoding="utf-8")

    def dump(path: Path, rows: list[dict]):
        if not rows:
            return
        keys: list[str] = []
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
            w.writeheader()
            w.writerows([{k: (", ".join(v) if isinstance(v, list) else v) for k, v in r.items()}
                         for r in rows])
        log.info("wrote %s (%d rows)", path, len(rows))

    dump(out.parent / "shifts.csv", types)
    dump(out.parent / "shift-roster.csv", roster)
    dump(out.parent / "shift-defaults.csv", defaults)
    log.info("done: %d type(s), %d roster cell(s) -> %s", len(types), len(roster), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
