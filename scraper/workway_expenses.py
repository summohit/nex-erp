#!/usr/bin/env python3
"""Export CES Tech (Worksuite) expenses.

    python workway_expenses.py --storage-state auth/cestech-finance.json
    python workway_expenses.py --limit 20          # a trial run first
    python workway_expenses.py --no-details        # list only, much faster

TWO REQUESTS PER EXPENSE, AND WHY

The DataTables endpoint returns all 795 rows in one call, but not everything on
them: category, project, bank account, description, the bill attachment and who
approved it exist only on the detail view. Category in particular is the field
an accounts system is organised around, so a list-only export is the kind that
has to be done twice -- which is exactly what happened with the payslip export
earlier today.

So each row is fetched again from /account/expenses/<id>, which answers with
the detail markup. That is ~550KB a time and 795 of them, so it is minutes
rather than seconds; --no-details skips it when the totals are all that is
wanted, and --limit takes a handful first.

The page's own Export button is DataTables' client-side Excel writer: it emits
the rows currently rendered, which is 10 of 795. Not a shortcut.

Output: out_finance/workway-expenses.json and workway-expenses.csv.

THIS WRITES FINANCIAL RECORDS TO DISK. out_finance/ and auth/ are gitignored;
keep it that way.
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

log = logging.getLogger("workway.expenses")
BASE = "https://cestech.workway.pro"

# The detail view is label/value pairs. Read as a DOM rather than by regex
# because the labels carry nested markup -- an avatar beside the employee, an
# icon beside the status -- and a text-only match picks those up as values.
DETAIL_JS = r"""
(html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();

  const out = {};
  // Each row renders as a label cell followed by a value cell. Matching on the
  // label's text keeps this working when the column classes change.
  host.querySelectorAll('div, tr').forEach(row => {
    const kids = [...row.children];
    if (kids.length !== 2) return;
    const label = clean(kids[0].innerText);
    if (!label || label.length > 40) return;
    const value = clean(kids[1].innerText);
    if (!(label in out)) out[label] = value;
  });

  // The bill is a link, not text, and the receipt photo an <img>.
  const billLink = host.querySelector('a[href*="/download"], a[href*="bill"], a[download]');
  out.__bill_url = billLink ? billLink.getAttribute('href') : '';
  const img = host.querySelector('img[src*="expense"], .description img, img[src*="upload"]');
  out.__attachment_url = img ? img.getAttribute('src') : '';
  return out;
}
"""

# Labels on the detail view -> the column name in the export.
DETAIL_FIELDS = {
    'Category': 'category',
    'Project': 'project',
    'Bank Account': 'bank_account',
    'Employee': 'employee_detail',
    'Description': 'description',
    'Approved By': 'approved_by',
    'Purchased From': 'purchased_from_detail',
}

PLACEHOLDER = {'--', '-', '', 'N/A'}

# The status cell is a <select> whose markup is broken: the selected option
# reads
#     <option selected value="approved" data-content="<i ...></i> Approved"Approved</option>
# with no ">" closing the tag. Any DOM or tag-stripping parser therefore runs
# the three options together -- the first attempt reported statuses like
# 'Pending">Pending Approved"Approved Rejected">Rejected'. The value attribute
# on the selected option is unambiguous, so it is read directly.
_SELECTED = re.compile(r'<option[^>]*\bselected\b[^>]*value="([^"]+)"', re.I)


def status_of(cell) -> str:
    m = _SELECTED.search(str(cell or ''))
    return m.group(1).strip().capitalize() if m else ''


def tidy(v: str) -> str:
    v = re.sub(r'\s+', ' ', str(v or '')).strip()
    return '' if v in PLACEHOLDER else v


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
    p.add_argument("--out", default="out_finance/workway-expenses.json")
    p.add_argument("--limit", type=int, default=0, help="only fetch N details")
    p.add_argument("--no-details", action="store_true",
                   help="list only — no category, project, description or approver")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s — create one with:\n"
                  "  python scrape.py --login %s/login --storage-state %s", state, BASE, state)
        return 4

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    rows: list[dict] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        tmpl: dict[str, str] = {}
        page.on("response", lambda r: tmpl.setdefault("url", r.url)
                if "draw=" in r.url and "/account/expenses" in r.url else None)
        page.goto(f"{BASE}/account/expenses", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)

        if "login" in page.url.lower():
            log.error("redirected to a login page — the saved session has expired")
            b.close()
            return 4

        url = tmpl.get("url", "")
        if not url:
            log.error("could not capture the expenses DataTables endpoint")
            b.close()
            return 5

        url = re.sub(r"([?&])length=-?\d+", r"\g<1>length=5000", url)
        if "length=" not in url:
            url += "&length=5000"
        r = ctx.request.get(url, headers={
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01"}, timeout=120000)
        if r.status != 200:
            log.error("expenses endpoint returned HTTP %s", r.status)
            b.close()
            return 5

        payload = r.json()
        reported = payload.get("recordsTotal")
        data = payload.get("data") or []
        log.info("list: %d row(s) of %s reported", len(data), reported)

        for raw in data:
            if not isinstance(raw, dict):
                continue
            rec = {
                "id": raw.get("id"),
                "item_name": tidy(html_to_value(raw.get("item_name"))),
                "employee": tidy(html_to_value(raw.get("user_id"))),
                "price": tidy(raw.get("price")),
                "amount": raw.get("default_currency_price"),
                "currency": (raw.get("currency") or {}).get("currency_code"),
                "purchased_from": tidy(raw.get("purchase_from")),
                "purchase_date": tidy(raw.get("purchase_date")),
                "status": status_of(raw.get("status")),
                "project_id": raw.get("project_id"),
                "bill_url": tidy(raw.get("bill_url")),
                "recurring_id": raw.get("expenses_recurring_id"),
            }
            rows.append(rec)

        if not args.no_details:
            targets = rows[: args.limit] if args.limit else rows
            log.info("fetching detail for %d expense(s) — this is the slow part", len(targets))
            for i, rec in enumerate(targets, 1):
                eid = rec.get("id")
                if not eid:
                    continue
                try:
                    dr = ctx.request.get(f"{BASE}/account/expenses/{eid}",
                                         headers={"X-Requested-With": "XMLHttpRequest"},
                                         timeout=60000)
                    if dr.status != 200:
                        rec["_detail_error"] = f"HTTP {dr.status}"
                        continue
                    body = dr.json()
                    detail = page.evaluate(DETAIL_JS, body.get("html") or "")
                except Exception as exc:
                    rec["_detail_error"] = str(exc)[:120]
                    continue

                for label, col in DETAIL_FIELDS.items():
                    if label in detail:
                        rec[col] = tidy(detail[label])
                if detail.get("__attachment_url"):
                    rec["attachment_url"] = detail["__attachment_url"]
                if detail.get("__bill_url") and not rec.get("bill_url"):
                    rec["bill_url"] = detail["__bill_url"]

                if i % 25 == 0 or i == len(targets):
                    log.info("  detail %d/%d", i, len(targets))

        b.close()

    failed = [r for r in rows if r.get("_detail_error")]
    if failed:
        log.warning("%d detail fetch(es) failed — those rows keep their list fields only",
                    len(failed))

    out.write_text(json.dumps({"rows": rows, "reported_total": reported},
                              ensure_ascii=False, indent=2), encoding="utf-8")
    dump_csv(out.parent / "workway-expenses.csv", rows)

    by_status: dict = {}
    total = 0.0
    for r in rows:
        by_status[r.get("status") or "?"] = by_status.get(r.get("status") or "?", 0) + 1
        try:
            total += float(r.get("amount") or 0)
        except (TypeError, ValueError):
            pass
    log.info("status: %s", "  ".join(f"{k} {v}" for k, v in sorted(by_status.items())))
    log.info("total value: %.2f", total)
    if not args.no_details:
        with_cat = sum(1 for r in rows if r.get("category"))
        log.info("with a category: %d of %d", with_cat, len(rows))
    log.info("done: %d expense(s) -> %s", len(rows), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
