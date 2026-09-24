#!/usr/bin/env python3
"""Export payslip history from the CES Tech payslip admin.

    python payslip_history.py --storage-state auth/payslip.json
    python payslip_history.py --month "August 2026"

This is a different source from Workway, and on early evidence a better one.
Workway had no salary at all for twelve people; several of them have payslips
here. Where both have a figure they mostly agree to within a few hundred
rupees — the difference being that these are what was actually PAID, after
proration, rather than what the structure says should be.

So the point of this export is not only to fill gaps. It is to have a second
opinion on the salaries already imported into NEX, from a system that issued
real payslips rather than one that described an intent.

Reads /api/payslips, not the rendered table. The table showed four totals; the
API carries the whole payslip -- basic, HRA, travel, medical, special, any
custom lines, and EPF/ESI/TDS/advance/unpaid-days on the other side -- which is
what NEX needs to store line items rather than a single number per side.

Output: out_finance/payslip-history.json and payslip-history.csv.

THIS WRITES PAY DATA TO DISK. out_finance/ and auth/ are gitignored; keep them
that way.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from pathlib import Path

log = logging.getLogger("payslip.history")
BASE = "https://payslip.ces-pl.com"

# One row of the table. The employee cell holds the name and an "ID: 20241"
# code stacked together, so it is split rather than taken whole.
ROWS_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const money = s => {
    const t = clean(s).replace(/[₹,]/g, '');
    return t === '' || t === '-' ? '' : t;
  };
  return [...document.querySelectorAll('tbody tr')].map(tr => {
    const td = [...tr.querySelectorAll('td')].map(x => clean(x.innerText));
    if (td.length < 9) return null;
    // "RM Rohit Maurya ID: 20241" -> name and code. The leading initials are
    // the avatar's text, which innerText picks up as part of the cell.
    const who = td[0];
    const m = who.match(/^(?:[A-Z]{1,3}\s)?(.*?)\s*ID:\s*(\S+)\s*$/);
    return {
      employee: m ? m[1] : who,
      employee_code: m ? m[2] : '',
      email: td[1],
      period: td[2],
      slip_no: td[3],
      annual_ctc: money(td[4]),
      gross_earnings: money(td[5]),
      total_deductions: money(td[6]),
      net_salary: money(td[7]),
      status: td[8],
    };
  }).filter(Boolean);
}
"""

# "Showing 1 to 25 of 52 records" — the only statement of how many there are.
TOTAL_RE = re.compile(r"of\s+([\d,]+)\s+records", re.I)


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
    p.add_argument("--storage-state", default="auth/payslip.json")
    p.add_argument("--out", default="out_finance/payslip-history.json")
    p.add_argument("--month", help='filter to one period, e.g. "August 2026"')
    p.add_argument("--max-pages", type=int, default=50)
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s — create one with:\n"
                  "  python scrape.py --login %s/ --storage-state %s", state, BASE, state)
        return 4

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    rows: list[dict] = []
    reported_total = None

    # Each earning/deduction field, and the label NEX should store it under.
    EARNINGS = [
        ("basic", "Basic Salary"),
        ("hra", "House Rent Allowance (HRA)"),
        ("travelAllowance", "Travel Allowance"),
        ("medicalAllowance", "Medical Allowance"),
        ("specialAllowance", "Special Allowance"),
    ]
    DEDUCTIONS = [
        ("epf", "Provident Fund (EPF)"),
        ("esi", "Employee State Insurance (ESI)"),
        ("tds", "Tax Deducted at Source (TDS)"),
        ("advanceSalary", "Advance Salary"),
        # The proration for days not worked. It is already inside
        # totalDeductions, so it travels as a line rather than as a separate
        # loss-of-pay figure that would be counted twice.
        ("unpaidDaysAmount", "Unpaid Days Deduction"),
    ]

    def flatten(rec: dict) -> dict:
        emp = rec.get("employee") or {}
        money = lambda k: float(rec.get(k) or 0)
        items = []
        for key, label in EARNINGS:
            if money(key):
                items.append({"name": label, "type": "EARNING", "amount": money(key)})
        for c in rec.get("customEarnings") or []:
            amt = float(c.get("amount") or 0)
            if amt:
                items.append({"name": c.get("name") or "Other Earning", "type": "EARNING", "amount": amt})
        for key, label in DEDUCTIONS:
            if money(key):
                items.append({"name": label, "type": "DEDUCTION", "amount": money(key)})
        for c in rec.get("customDeductions") or []:
            amt = float(c.get("amount") or 0)
            if amt:
                items.append({"name": c.get("name") or "Other Deduction", "type": "DEDUCTION", "amount": amt})

        return {
            "employee": emp.get("name") or "",
            "employee_code": str(rec.get("employeeId") or "").strip(),
            "email": emp.get("email") or "",
            "designation": emp.get("designation") or "",
            "period": f"{rec.get('month')} {rec.get('year')}".strip(),
            "month_name": rec.get("month"),
            "year": rec.get("year"),
            "slip_no": rec.get("salarySlipNo") or "",
            "annual_ctc": money("ctc"),
            "gross_earnings": money("grossEarnings"),
            "total_deductions": money("totalDeductions"),
            "net_salary": money("netPay"),
            "no_of_days": rec.get("noOfDays"),
            "status": rec.get("emailStatus") or "",
            "source_id": rec.get("_id"),
            "items": items,
        }

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()
        page.goto(f"{BASE}/history", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1500)
        if "login" in page.url.lower():
            log.error("redirected to a login page — the saved session has expired")
            b.close()
            return 4

        # Paged rather than one huge request: the server decides the ceiling on
        # `limit`, and asking for everything at once tends to be the thing that
        # quietly returns a truncated page.
        page_no = 1
        while page_no <= args.max_pages:
            r = ctx.request.get(f"{BASE}/api/payslips?page={page_no}&limit=100",
                                headers={"Accept": "application/json"}, timeout=60000)
            if r.status != 200:
                log.error("api/payslips page %d returned HTTP %s", page_no, r.status)
                break
            payload = r.json()
            batch = payload.get("items") or []
            if reported_total is None:
                reported_total = payload.get("total")
                log.info("the API reports %s payslip(s) in all", reported_total)
            if not batch:
                break
            rows.extend(flatten(x) for x in batch)
            log.info("page %d: %d record(s)  (total so far %d)", page_no, len(batch), len(rows))
            if reported_total is not None and len(rows) >= reported_total:
                break
            page_no += 1

        b.close()

    if args.month:
        before = len(rows)
        rows = [r for r in rows if r["period"].strip().lower() == args.month.strip().lower()]
        log.info("filtered to %s: %d of %d row(s)", args.month, len(rows), before)

    # Say so when the page's own count and what was collected disagree, rather
    # than reporting a clean number for a partial scrape.
    if reported_total is not None and not args.month and len(rows) != reported_total:
        log.warning("collected %d row(s) but the page reports %d — pagination may have stopped early",
                    len(rows), reported_total)

    periods = {}
    for r in rows:
        periods[r["period"]] = periods.get(r["period"], 0) + 1

    out.write_text(json.dumps({"rows": rows, "reported_total": reported_total},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    dump_csv(out.parent / "payslip-history.csv", rows)

    log.info("periods: %s", "  ".join(f"{k} ({v})" for k, v in sorted(periods.items())))
    log.info("done: %d payslip(s) -> %s", len(rows), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
