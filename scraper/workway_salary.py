#!/usr/bin/env python3
"""Scrape CES Tech (Worksuite) salary data.

Two levels, because the money lives in the second one:

  * the LIST  - /account/employee-salary via its DataTables endpoint. One row
                per employee: cycle, salary group, whether payroll may generate
                for them, and the net monthly figure. The whole company in one
                request, past the 10-row page size.
  * the SHEET - /account/employee-salary/edit-salary/<id> per employee. This is
                where the structure is: annual CTC, each earning component with
                its calculation type ("50 % of CTC"), the monthly and annual
                amount of each, cost to company, and the deductions.

The list alone is not enough to rebuild anybody's pay. A net monthly figure
cannot be split back into basic, allowances and TDS, and NEX models salary as
components (SalaryStructure / SalaryComponent), so the per-employee sheet is
the part that actually migrates.

    python workway_salary.py --storage-state auth/cestech-finance.json

Output: out_finance/salaries.json  { list: [...], sheets: [...] }
plus out_finance/salary-list.csv and out_finance/salary-components.csv.

  --inspect <id>   save one sheet's raw HTML to out_finance/ and stop. The
                   extractor below reads the form generically, and this is how
                   you check what it actually found against what is on screen.
  --limit N        only fetch N sheets — worth doing once before all of them.

THIS FILE WRITES SALARIES TO DISK. out_finance/ is gitignored (as is auth/),
and it should stay that way. Do not move the output somewhere tracked.
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

from workway_jobs import html_to_value  # same DataTables cell flattening

log = logging.getLogger("workway.salary")
BASE = "https://cestech.workway.pro"

# The edit link in each row's action column is the only place the sheet id
# appears, so the action HTML is parsed before it is thrown away.
_EDIT_ID = re.compile(r"/employee-salary/edit-salary/(\d+)")


# Read a salary sheet.
#
# Everything lives inside #components, and the page distinguishes its two kinds
# of row by the width of the first cell: a COMPONENT row opens with .col-md-3
# (label, calculation, monthly, annual), a TOTAL row opens with .col-md-6
# (Cost To Company, Total Deductions). An <h3> reading "Earnings" or
# "Deductions" switches which section the rows after it belong to.
#
# Within a cell the amount is a visible <input value="518,750.00"> where the
# figure is editable and a <label> where it is derived. Both can appear beside
# a hidden input, and the hidden one is not always the same number -- Special
# Allowance carries the MONTHLY value in the annual cell's hidden field -- so
# the visible value wins and hidden inputs are ignored entirely.
#
# The first attempt at this walked every .row on the page and let nested
# containers match, which turned the whole document into one "component".
# Scoping to #components and requiring the cell shape is what fixes it.
SHEET_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const money = s => clean(s).replace(/[₹,]/g, '');

  // A cell's value: the visible field if it has one, otherwise its text.
  // Hidden inputs are skipped -- see the note above about Special Allowance.
  const cellValue = el => {
    if (!el) return '';
    const parts = [];
    el.querySelectorAll('input, select').forEach(f => {
      if (f.type === 'hidden') return;
      if (f.tagName === 'SELECT') {
        const o = f.options[f.selectedIndex];
        parts.push(clean(o ? o.text : f.value));
      } else {
        parts.push(clean(f.value));
      }
    });
    if (parts.length) return parts.filter(Boolean).join(' ');
    return clean(el.innerText);
  };

  const out = {
    user_id: (document.querySelector('#user_id') || {}).value || '',
    annual_ctc: money((document.querySelector('#annual_salary') || {}).value || ''),
    employee: '', designation: '',
    earnings: [], deductions: [], totals: {},
  };

  const nameEl = document.querySelector('h5 a.text-darkest-grey');
  if (nameEl) {
    out.employee = clean(nameEl.textContent);
    const d = nameEl.closest('h5') && nameEl.closest('h5').nextElementSibling;
    if (d) out.designation = clean(d.textContent);
  }

  const root = document.querySelector('#components');
  if (!root) return out;

  let bucket = 'earnings';
  // Headings and rows together, in document order, so a heading always applies
  // to the rows that follow it.
  root.querySelectorAll('h3, h4, .row').forEach(node => {
    if (node.tagName === 'H3' || node.tagName === 'H4') {
      const t = clean(node.textContent);
      if (/^earnings$/i.test(t)) bucket = 'earnings';
      else if (/^deductions$/i.test(t)) bucket = 'deductions';
      return;
    }

    const wide = node.querySelector(':scope > .col-md-6');
    const cells = [...node.querySelectorAll(':scope > [class*="col-md-"]')];
    if (cells.length < 3) return;

    // Outer wrappers are rows too, and their children are full-width
    // .col-md-12 blocks holding the heading and the real rows. One of those
    // matched on the last run and produced a component called "Earnings"
    // whose annual amount was the text of every row beneath it. A real row
    // starts at .col-md-3 (component) or .col-md-6 (total); nothing else.
    if (!cells[0].className.match(/\bcol-md-(3|6)\b/)) return;

    const label = clean(cells[0].innerText).split('\n')[0];
    if (!label) return;

    if (wide) {
      out.totals[label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = {
        monthly: money(cellValue(cells[1])),
        annual: money(cellValue(cells[2])),
      };
      return;
    }

    if (cells.length < 4) return;
    out[bucket].push({
      component: label,
      calculation: cellValue(cells[1]),
      monthly: money(cellValue(cells[2])),
      annual: money(cellValue(cells[3])),
    });
  });

  return out;
}
"""


# Read a Salary History table: "# / Amount (Monthly) / Value Type / Date / Action".
#
# Value Type is "initial" for the first figure and "increment" for each raise,
# so the latest row is the pay in force and the rest are the trail that explains
# it. The Action column is a Delete button and is dropped.
HISTORY_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  document.querySelectorAll('table tbody tr').forEach(tr => {
    const td = [...tr.querySelectorAll('td')].map(x => clean(x.innerText));
    // Padding rows carry no sequence number and no amount.
    if (td.length < 4 || !td[0] || !td[1]) return;
    out.push({
      seq: td[0],
      amount_monthly: td[1].replace(/[₹,]/g, ''),
      value_type: td[2],
      date: td[3],
    });
  });
  return out;
}
"""


def dump_csv(path: Path, rows: list[dict]) -> None:
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
        w.writerows(rows)
    log.info("wrote %s (%d rows)", path, len(rows))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-finance.json")
    p.add_argument("--out", default="out_finance/salaries.json")
    p.add_argument("--limit", type=int, default=0, help="only fetch N sheets")
    p.add_argument("--inspect", metavar="ID", help="dump one sheet's raw HTML and stop")
    p.add_argument("--skip-history", action="store_true",
                   help="do not fetch the per-employee Salary History pages")
    p.add_argument("--inspect-history", metavar="ID",
                   help="dump one Salary History page and the XHR it fires, then stop")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s — log in and save one first", state)
        return 4

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    rows: list[dict] = []
    sheets: list[dict] = []
    history: list[dict] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        # ── one sheet, raw, for checking the extractor ───────────────────
        if args.inspect:
            url = f"{BASE}/account/employee-salary/edit-salary/{args.inspect}"
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)
            raw = out.parent / f"sheet-{args.inspect}.html"
            raw.write_text(page.content(), encoding="utf-8")
            got = page.evaluate(SHEET_JS)
            (out.parent / f"sheet-{args.inspect}.json").write_text(
                json.dumps(got, ensure_ascii=False, indent=2), encoding="utf-8")
            log.info("wrote %s and its parsed form — compare them", raw)
            print(json.dumps(got, ensure_ascii=False, indent=2))
            b.close()
            return 0

        # ── one history page, raw, to learn its shape ────────────────────
        #
        # /account/employee-salary/<id> (no "edit-salary") is the Salary
        # History view behind the row menu. It is where the twelve gross-only
        # people's pay actually lives -- their component sheet is blank -- so
        # nothing about them can migrate without reading this.
        if args.inspect_history:
            url = f"{BASE}/account/employee-salary/{args.inspect_history}"
            seen: list[str] = []
            page.on("response", lambda r: seen.append(r.url)
                    if "employee-salary" in r.url and "draw=" in r.url else None)
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2500)
            raw = out.parent / f"history-{args.inspect_history}.html"
            raw.write_text(page.content(), encoding="utf-8")
            log.info("wrote %s", raw)
            if seen:
                log.info("XHR endpoints seen: %s", "  ".join(sorted(set(seen))))
            # Every table on the page, as rows of cells — enough to see what is
            # there before committing to selectors.
            tables = page.evaluate(r"""
            () => [...document.querySelectorAll('table')].map(t => ({
              headers: [...t.querySelectorAll('thead th')]
                         .map(x => (x.innerText||'').replace(/\s+/g,' ').trim()),
              rows: [...t.querySelectorAll('tbody tr')].slice(0, 12).map(tr =>
                     [...tr.querySelectorAll('td')]
                       .map(x => (x.innerText||'').replace(/\s+/g,' ').trim())),
            }))""")
            print(json.dumps(tables, ensure_ascii=False, indent=2))
            b.close()
            return 0

        # ── the list, via its DataTables endpoint ────────────────────────
        tmpl: dict[str, str] = {}
        page.on("response", lambda r: tmpl.setdefault("url", r.url)
                if "draw=" in r.url and "employee-salary" in r.url else None)
        page.goto(f"{BASE}/account/employee-salary", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)

        url = tmpl.get("url", "")
        if not url:
            log.error("could not capture the employee-salary DataTables endpoint")
            b.close()
            return 5

        url = re.sub(r"([?&])length=-?\d+", r"\g<1>length=5000", url)
        if "length=" not in url:
            url += "&length=5000"
        r = ctx.request.get(url, headers={
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01"}, timeout=90000)
        if r.status != 200:
            log.error("salary list endpoint returned HTTP %s", r.status)
            b.close()
            return 5

        payload = r.json()
        log.info("salary rows: %d of %d reported",
                 len(payload.get("data", [])), payload.get("recordsTotal"))

        for raw_row in payload.get("data", []):
            if not isinstance(raw_row, dict):
                continue
            # The sheet id only exists inside the action column's edit link, so
            # it is read before the column is dropped.
            blob = " ".join(str(v) for v in raw_row.values())
            m = _EDIT_ID.search(blob)
            rec = {k: html_to_value(v) for k, v in raw_row.items()
                   if k not in ("check", "action", "DT_RowId", "DT_RowIndex", "color")}
            rec["salary_id"] = m.group(1) if m else ""
            rows.append(rec)

        with_sheet = [x for x in rows if x["salary_id"]]
        log.info("%d row(s) carry a sheet id; %d do not (no salary set yet)",
                 len(with_sheet), len(rows) - len(with_sheet))

        targets = with_sheet[: args.limit] if args.limit else with_sheet
        for i, rec in enumerate(targets, 1):
            sid = rec["salary_id"]
            try:
                # Read it, and if it comes back blank read it again.
                #
                # The amounts are computed by the page's own JS after load, so
                # "networkidle plus a moment" is not a guarantee: two identical
                # full runs disagreed, 210 component rows against 202, with one
                # sheet blank in the second. A blank sheet is indistinguishable
                # from a legitimately empty one -- and there are thirteen of
                # those -- so a silent miss would read as "this person has no
                # salary" and migrate as zero.
                #
                # Retrying only blanks costs one extra load for the genuinely
                # empty sheets and nothing for the rest.
                sheet = {}
                for attempt in (1, 2):
                    page.goto(f"{BASE}/account/employee-salary/edit-salary/{sid}",
                              wait_until="networkidle", timeout=60000)
                    page.wait_for_timeout(1200 * attempt)
                    sheet = page.evaluate(SHEET_JS)
                    if sheet.get("annual_ctc"):
                        break
                    if attempt == 1:
                        log.debug("sheet %s blank on first read — retrying", sid)
                sheet["blank_after_retry"] = not sheet.get("annual_ctc")
            except Exception as exc:
                log.warning("sheet %s failed: %s", sid, exc)
                sheets.append({"salary_id": sid, "_error": str(exc)})
                continue
            sheet["salary_id"] = sid
            sheet["list_name"] = rec.get("name") or rec.get("employee") or ""
            sheets.append(sheet)
            if i % 10 == 0 or i == len(targets):
                log.info("  sheets %d/%d", i, len(targets))

        # ── salary history, for everyone ─────────────────────────────────
        #
        # Not an extra: for the twelve people whose component sheet is blank
        # this is their ONLY pay record, and for the three whose sheet and list
        # figure disagree it is the tie-breaker. Keyed by the same user id --
        # /account/employee-salary/<id>, no "edit-salary" -- and rendered
        # server-side, so there is no endpoint to capture, just a table to read.
        if not args.skip_history:
            hist_targets = rows[: args.limit] if args.limit else rows
            for i, rec in enumerate(hist_targets, 1):
                uid = str(rec.get("id") or rec.get("salary_id") or "")
                if not uid:
                    continue
                try:
                    page.goto(f"{BASE}/account/employee-salary/{uid}",
                              wait_until="networkidle", timeout=60000)
                    page.wait_for_timeout(900)
                    entries = page.evaluate(HISTORY_JS)
                except Exception as exc:
                    log.warning("history %s failed: %s", uid, exc)
                    history.append({"user_id": uid, "_error": str(exc)})
                    continue
                history.append({"user_id": uid,
                                "email": rec.get("email", ""),
                                "entries": entries})
                if i % 10 == 0 or i == len(hist_targets):
                    log.info("  history %d/%d", i, len(hist_targets))

        b.close()

    out.write_text(json.dumps({"list": rows, "sheets": sheets, "history": history},
                              ensure_ascii=False, indent=2), encoding="utf-8")

    dump_csv(out.parent / "salary-list.csv", rows)

    # One row per component, which is the shape SalaryComponent wants.
    flat: list[dict] = []
    for s in sheets:
        for kind in ("earnings", "deductions"):
            for c in s.get(kind, []):
                flat.append({"salary_id": s.get("salary_id"),
                             "employee": s.get("employee") or s.get("list_name", ""),
                             "annual_ctc": s.get("annual_ctc", ""),
                             "kind": kind[:-1], **c})
    dump_csv(out.parent / "salary-components.csv", flat)

    # One row per history entry, oldest first per person.
    hrows: list[dict] = []
    for h in history:
        for e in h.get("entries", []):
            hrows.append({"user_id": h["user_id"], "email": h.get("email", ""), **e})
    dump_csv(out.parent / "salary-history.csv", hrows)

    # The figure in force today: the SUM of every entry, not the last one.
    #
    # An "increment" row holds the RAISE, not the new salary -- Rohit's two
    # rows are 8,000 initial and 2,000 increment for a salary of 10,000. Taking
    # the last row would have paid him 2,000. Summing matches the figure the
    # list itself shows for all 36 people who have one, which is what makes
    # this the reading to trust rather than a guess that happens to fit.
    def money(v) -> float:
        try:
            return float(str(v or "").replace("₹", "").replace(",", "").replace("+", "").strip())
        except ValueError:
            return 0.0

    current: list[dict] = []
    for h in history:
        entries = h.get("entries") or []
        if not entries:
            continue
        seq = lambda e: int(e["seq"]) if str(e["seq"]).isdigit() else 0
        latest = max(entries, key=seq)
        initials = [e for e in entries if e.get("value_type") == "initial"]
        current.append({
            "user_id": h["user_id"], "email": h.get("email", ""),
            "amount_monthly": f"{sum(money(e['amount_monthly']) for e in entries):.2f}",
            "as_of": latest["date"],
            "entries": len(entries),
            # Two "initial" rows is not a pay rise, it is the same figure
            # entered twice -- one person has exactly that, on one date, and
            # their salary reads as double. Flagged rather than silently summed.
            "suspect_duplicate_initial": "yes" if len(initials) > 1 else "",
        })
    dump_csv(out.parent / "salary-current.csv", current)

    log.info("done: %d list row(s), %d sheet(s), %d component row(s), "
             "%d history entr(ies) for %d person(s) -> %s",
             len(rows), len(sheets), len(flat), len(hrows), len(current), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
