#!/usr/bin/env python3
"""Scrape CES Tech (Worksuite) leave data.

Three things, because they live in different places:

  * leave TYPES  - /account/settings/leaves-settings?tab=type
                   (allotment type, no. of leaves, paid status)
  * leave RECORDS- /account/leaves via its DataTables endpoint. The whole company
                   in one request; the per-employee tab caps at 10 rows and also
                   omits reason / approver / half-day type.
  * leave QUOTAS - already captured per employee in cestech-full.json
                   (`leaves_quota`), read here so everything lands in one file.

    python workway_leaves.py --storage-state auth/cestech-hr.json

Output: out_hr/leaves.json  { types: [...], records: [...], quotas: [...] }
plus out_hr/leaves-records.csv and out_hr/leaves-quotas.csv.
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

log = logging.getLogger("workway.leaves")
BASE = "https://cestech.workway.pro"

TYPES_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  document.querySelectorAll('tbody tr').forEach(tr => {
    const td = [...tr.querySelectorAll('td')].map(x => clean(x.innerText));
    if (!td.length || !td[0]) return;
    out.push({
      name: td[0],
      allotment_type: td[1] || '',
      no_of_leaves: td[2] || '',
      monthly_limit: (td[3] || '').replace(/^--$/, ''),
      paid_status: td[4] || '',
      departments: td[5] || '',
      designations: td[6] || '',
    });
  });
  return out;
}
"""


_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_DATE = re.compile(r"(\d{2}-\d{2}-\d{4})")


def parse_related(html: str) -> list[dict]:
    """Rows from the 'View Status' modal: one line per day of a multi-day leave."""
    out = []
    for tr in _TR.findall(html):
        cells = [c for c in (html_to_value(x) for x in _TD.findall(tr)) if c]
        if not cells or not _DATE.match(cells[0]):
            continue
        out.append({
            "leave_date": cells[0],
            "leave_type": cells[1] if len(cells) > 1 else "",
            "paid_label": cells[2] if len(cells) > 2 else "",
            "status": cells[-1],
        })
    return out


def expand_multi_day(request, records: list[dict]) -> list[dict]:
    """A multi-day leave is one list row standing in for N day-rows that share a
    unique_id; its own status reads "View Status". Expand each into real days so
    every leave day carries its own date and status."""
    out: list[dict] = []
    multi = [r for r in records
             if str(r.get("count_multiple_leaves") or "0") not in ("0", "")]
    log.info("expanding %d multi-day leave(s)", len(multi))
    for r in records:
        if str(r.get("count_multiple_leaves") or "0") in ("0", ""):
            out.append(r)
            continue
        lid, uid = r.get("id"), r.get("unique_id")
        try:
            resp = request.get(
                f"{BASE}/account/leaves/view-related-leave/{lid}?uniqueId={uid}",
                headers={"X-Requested-With": "XMLHttpRequest"}, timeout=60000)
            days = parse_related(resp.text()) if resp.status == 200 else []
        except Exception as exc:
            log.warning("related leaves for %s failed: %s", lid, exc)
            days = []
        if not days:
            r["_expand_failed"] = True
            out.append(r)
            continue
        for d in days:
            out.append({**r, "leave_date": d["leave_date"], "status": d["status"],
                        "leave_type": d["leave_type"] or r.get("leave_type", ""),
                        "duration": "Full Day", "_from_multi": r.get("unique_id")})
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-hr.json")
    p.add_argument("--full", default="out_hr/cestech-full.json",
                   help="employee export, read for the per-employee leave quotas")
    p.add_argument("--out", default="out_hr/leaves.json")
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
    records: list[dict] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        # ── leave types ──────────────────────────────────────────────────
        page.goto(f"{BASE}/account/settings/leaves-settings?tab=type",
                  wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2000)
        types = page.evaluate(TYPES_JS)
        log.info("leave types: %d", len(types))

        # ── leave records: capture the DataTables URL, then re-request it all ──
        tmpl: dict[str, str] = {}
        page.on("response", lambda r: tmpl.setdefault("url", r.url)
                if "draw=" in r.url and "/account/leaves" in r.url else None)
        page.goto(f"{BASE}/account/leaves", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(2500)

        url = tmpl.get("url", "")
        if not url:
            log.error("could not capture the leaves DataTables endpoint")
        else:
            url = re.sub(r"([?&])length=-?\d+", r"\g<1>length=5000", url)
            if "length=" not in url:
                url += "&length=5000"
            r = ctx.request.get(url, headers={
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01"}, timeout=90000)
            if r.status != 200:
                log.error("leaves endpoint returned HTTP %s", r.status)
            else:
                payload = r.json()
                log.info("leave records: %d of %d reported",
                         len(payload.get("data", [])), payload.get("recordsTotal"))
                for row in payload.get("data", []):
                    if not isinstance(row, dict):
                        continue
                    rec = {k: html_to_value(v) for k, v in row.items()
                           if k not in ("check", "action", "DT_RowId", "DT_RowIndex",
                                        "color", "manager_status_permission")}
                    records.append(rec)
                records = expand_multi_day(ctx.request, records)
                log.info("after expanding multi-day leaves: %d day-record(s)", len(records))
        b.close()

    # ── quotas (already scraped per employee) ────────────────────────────
    quotas: list[dict] = []
    full = Path(args.full)
    if full.exists():
        for e in json.loads(full.read_text()):
            for q in e.get("leaves_quota", []):
                quotas.append({"workway_employee_id": e.get("id"),
                               "email": (e.get("profile", {}) or {}).get("email", ""),
                               **q})
        log.info("quota rows: %d (from %d employees)", len(quotas),
                 len({q["workway_employee_id"] for q in quotas}))
    else:
        log.warning("%s not found — no quota data", full)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"types": types, "records": records, "quotas": quotas},
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
            w.writeheader(); w.writerows(rows)
        log.info("wrote %s (%d rows)", path, len(rows))

    dump(out.parent / "leaves-records.csv", records)
    dump(out.parent / "leaves-quotas.csv", quotas)
    log.info("done: %d type(s), %d record(s), %d quota row(s) -> %s",
             len(types), len(records), len(quotas), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
