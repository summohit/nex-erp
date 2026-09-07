#!/usr/bin/env python3
"""Scrape a month of CES Tech (Worksuite) attendance.

Loads the attendance grid for a given month/year, reads every employee x day
cell (status + attendance-id), and for days that have a record fetches the
detail page for clock-in/out times and each punch pair.

    python workway_attendance.py --storage-state auth/cestech-hr.json --month 8 --year 2025

Output: out_hr/attendance-<year>-<month>.json  (one object per employee with a
`records` list), plus a flat CSV. Emails are cross-referenced from roster.json
when present so the importer can match ERP employees.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

log = logging.getLogger("workway.attendance")
BASE = "https://cestech.workway.pro"

# The FontAwesome icon in each cell is the reliable status signal (tooltips carry
# shift/holiday/weekday names, not the status).
GRID_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const ICON = {
    'check': 'PRESENT', 'exclamation-circle': 'LATE', 'star-half-alt': 'HALF_DAY',
    'times': 'ABSENT', 'calendar-week': 'DAY_OFF', 'star': 'HOLIDAY',
    'plane-departure': 'ON_LEAVE', 'plane': 'ON_LEAVE',
  };
  const table = document.querySelector('table');
  if (!table) return { days: [], rows: [] };

  const heads = [...table.querySelectorAll('thead th')].map(th => clean(th.innerText));
  const days = heads.map(h => { const m = h.match(/(\d{1,2})/); return m ? parseInt(m[1], 10) : null; });

  const rows = [];
  table.querySelectorAll('tbody tr').forEach(tr => {
    const tds = [...tr.children];
    const link = tr.querySelector('a[href*="/account/employees/"]');
    const idm = link ? link.getAttribute('href').match(/employees\/(\d+)/) : null;
    const empId = idm ? idm[1] : null;
    const nameEl = tr.querySelector('.media a, .media h4, .media');
    const name = nameEl ? clean(nameEl.innerText).replace(/\s*It's you\s*/i, '') : '';
    if (!empId) return;

    const cells = [];
    tds.forEach((td, i) => {
      const svg = td.querySelector('svg[data-icon]');
      const dayEl = td.querySelector('a[data-attendance-date]');
      // day from the cell's own attribute when present (robust), else column.
      const day = dayEl ? parseInt(dayEl.getAttribute('data-attendance-date'), 10) : days[i];
      if (!day || !svg) return;
      const icon = svg.getAttribute('data-icon');
      const va = td.querySelector('a.view-attendance');
      const aid = va ? va.getAttribute('data-attendance-id') : null;
      const titleEl = td.querySelector('[data-original-title]');
      const note = titleEl ? clean(titleEl.getAttribute('data-original-title')) : '';
      let status = ICON[icon] || 'UNKNOWN';
      // star/calendar are day-off OR a named holiday — the tooltip decides.
      if (icon === 'star' || icon === 'calendar-week') {
        status = /day off|week off/i.test(note) ? 'DAY_OFF' : 'HOLIDAY';
      }
      cells.push({ day, status, attendance_id: aid, note });
    });
    rows.push({ workway_id: empId, name, cells });
  });
  return { days, rows };
}
"""

_DT = re.compile(r"(\d{2}-\d{2}-\d{4})\s+(\d{1,2}:\d{2}\s*[ap]m)", re.I)
_DATE = re.compile(r"Date\s*-\s*(\d{2}-\d{2}-\d{4})", re.I)
_LABEL_DT = re.compile(
    r"(Clock In|Clock Out)[\s\S]{0,240}?(\d{2}-\d{2}-\d{4}\s+\d{1,2}:\d{2}\s*[ap]m)"
    r"([\s\S]{0,240}?\((?:office|home)\))?",
    re.I,
)
_LOC = re.compile(r"([^>\n]*\((?:office|home)\))", re.I)


def _to_text(html: str) -> str:
    """Strip tags so the label/datetime/location sequence is contiguous."""
    import html as _htmllib
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", _htmllib.unescape(text)).strip()


def parse_detail(html: str) -> dict:
    """Pull clock in/out and punch logs out of an attendance detail page."""
    html = _to_text(html)
    out: dict = {"clock_in": None, "clock_out": None, "logs": []}
    dm = _DATE.search(html)
    if dm:
        out["date_ddmmyyyy"] = dm.group(1)

    entries = []
    for m in _LABEL_DT.finditer(html):
        label = m.group(1).strip().lower()
        dt = re.sub(r"\s+", " ", m.group(2)).strip()
        loc = ""
        if m.group(3):
            lm = _LOC.search(m.group(3))
            loc = re.sub(r"\s+", " ", lm.group(1)).strip() if lm else ""
        entries.append((label, dt, loc))

    # Pair consecutive clock in -> clock out into logs.
    pending_in = None
    for label, dt, loc in entries:
        if label == "clock in":
            pending_in = (dt, loc)
            if out["clock_in"] is None:
                out["clock_in"] = dt
        elif label == "clock out":
            out["clock_out"] = dt
            if pending_in:
                out["logs"].append({"clock_in": pending_in[0], "in_location": pending_in[1],
                                    "clock_out": dt, "out_location": loc})
                pending_in = None
            else:
                out["logs"].append({"clock_in": None, "in_location": "",
                                    "clock_out": dt, "out_location": loc})
    if pending_in and not any(l["clock_out"] is None for l in out["logs"]):
        out["logs"].append({"clock_in": pending_in[0], "in_location": pending_in[1],
                            "clock_out": None, "out_location": ""})
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-hr.json")
    p.add_argument("--month", type=int, required=True)
    p.add_argument("--year", type=int, required=True)
    p.add_argument("--roster", default="out_hr/roster.json", help="email cross-reference (from workway.py)")
    p.add_argument("--out", default="")
    p.add_argument("--delay-ms", type=int, default=250)
    p.add_argument("--limit-details", type=int, default=0, help="cap detail fetches (testing)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s; run scrape.py --login first", state)
        return 4

    # email cross-reference
    id_to_email: dict[str, str] = {}
    roster_path = Path(args.roster)
    if roster_path.exists():
        for r in json.loads(roster_path.read_text()):
            if r.get("id") and r.get("email"):
                id_to_email[str(r["id"])] = r["email"].lower()
        log.info("roster: %d id->email mappings", len(id_to_email))

    from playwright.sync_api import sync_playwright

    out_path = Path(args.out or f"out_hr/attendance-{args.year}-{args.month:02d}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        page.goto(f"{BASE}/account/attendances", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1000)

        # A correctly loaded month always has calendar-week (Sunday) icons. A wrong
        # or half-rendered load (the grid lagging behind the filter) shows none, so
        # apply the filter and retry until the grid actually reflects the request.
        import datetime as _dt
        is_future = (args.year, args.month) > (_dt.date.today().year, _dt.date.today().month)
        grid = {"rows": [], "days": []}
        for attempt in range(1, 5):
            page.select_option("select[name=month]", str(args.month))
            page.select_option("select[name=year]", str(args.year))
            btn = page.query_selector("#filter-form button[type=submit], #filter-form .btn-primary, "
                                      "#filter-form button, button:has-text('Filter')")
            if btn:
                btn.click()
            else:
                page.evaluate("() => document.getElementById('filter-form')?.submit()")
            page.wait_for_load_state("networkidle", timeout=60000)
            page.wait_for_timeout(2000)

            has_dayoff = page.evaluate("()=>document.querySelectorAll('svg[data-icon=calendar-week]').length")
            got_month = page.evaluate("()=>document.querySelector('select[name=month]')?.value")
            got_year = page.evaluate("()=>document.querySelector('select[name=year]')?.value")
            ok = str(got_month) == str(args.month) and str(got_year) == str(args.year) \
                and (is_future or has_dayoff > 0)
            if ok:
                break
            log.warning("attempt %d: filter month=%s year=%s dayoff-icons=%s (wanted %s/%s); retrying",
                        attempt, got_month, got_year, has_dayoff, args.month, args.year)
            page.wait_for_timeout(1500)

        grid = page.evaluate(GRID_JS)
        log.info("grid: %d employee row(s), %d day column(s)", len(grid["rows"]), len([d for d in grid["days"] if d]))

        # Collect all attendance ids needing a detail fetch.
        detail_ids = []
        for row in grid["rows"]:
            for c in row["cells"]:
                if c["attendance_id"]:
                    detail_ids.append(c["attendance_id"])
        if args.limit_details:
            detail_ids = detail_ids[:args.limit_details]
        log.info("%d day(s) have a record -> fetching detail", len(detail_ids))

        # Fetch details (raw HTML, fast).
        details: dict[str, dict] = {}
        for i, aid in enumerate(detail_ids, 1):
            try:
                r = ctx.request.get(f"{BASE}/account/attendances/{aid}", timeout=45000)
                if r.status == 200:
                    details[aid] = parse_detail(r.text())
            except Exception as exc:
                log.debug("detail %s failed: %s", aid, exc)
            if i % 50 == 0:
                log.info("  fetched %d/%d details", i, len(detail_ids))
            page.wait_for_timeout(args.delay_ms)

        b.close()

    # Assemble output — one record per day 1..N for every employee. Days Workway
    # never rendered a marker for default to ABSENT (untracked = not present).
    import calendar
    days_in_month = calendar.monthrange(args.year, args.month)[1]
    employees = []
    flat_rows = []
    for row in grid["rows"]:
        wid = row["workway_id"]
        email = id_to_email.get(wid, "")
        by_day = {c["day"]: c for c in row["cells"]}
        records = []
        for day in range(1, days_in_month + 1):
            c = by_day.get(day)
            date = f"{args.year}-{args.month:02d}-{day:02d}"
            status = c["status"] if c else "ABSENT"
            rec = {"date": date, "day": day, "status": status,
                   "note": c.get("note", "") if c else "",
                   "attendance_id": c["attendance_id"] if c else None}
            aid = rec["attendance_id"]
            if aid and aid in details:
                d = details[aid]
                rec["clock_in"] = d.get("clock_in")
                rec["clock_out"] = d.get("clock_out")
                rec["logs"] = d.get("logs", [])
            records.append(rec)
            flat_rows.append({"workway_id": wid, "email": email, "name": row["name"],
                              "date": date, "status": status,
                              "clock_in": rec.get("clock_in", ""), "clock_out": rec.get("clock_out", ""),
                              "punches": len(rec.get("logs", []))})
        employees.append({"workway_id": wid, "name": row["name"], "email": email, "records": records})

    out_path.write_text(json.dumps(employees, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_path = out_path.with_suffix(".csv")
    with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["workway_id", "email", "name", "date", "status",
                                           "clock_in", "clock_out", "punches"])
        w.writeheader(); w.writerows(flat_rows)

    worked = sum(1 for r in flat_rows if r["clock_in"])
    log.info("done: %d employee(s), %d day-record(s), %d with clock data -> %s",
             len(employees), len(flat_rows), worked, out_path)
    unmatched = sum(1 for e in employees if not e["email"])
    if unmatched:
        log.warning("%d employee(s) had no email match in roster.json (importer will skip)", unmatched)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
