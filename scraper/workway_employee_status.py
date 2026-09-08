#!/usr/bin/env python3
"""Scrape each CES Tech (Worksuite) employee's Active / Inactive status.

The employee list defaults to `status=active`, which is why the main export only
ever saw part of the roll. Requesting `status=all` returns everyone with a
per-row `status` column, and that column is what this reads.

    python workway_employee_status.py --storage-state auth/cestech-hr.json

Output: out_hr/employee-status.json  [{workway_id, employee_code, name, email, status}]
plus out_hr/employee-status.csv.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from workway_jobs import html_to_value

log = logging.getLogger("workway.empstatus")
BASE = "https://cestech.workway.pro"


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-hr.json")
    p.add_argument("--out", default="out_hr/employee-status.json")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s", state)
        return 4

    from playwright.sync_api import sync_playwright

    rows: list[dict] = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        tmpl: dict[str, str] = {}
        page.on("response", lambda r: tmpl.setdefault("url", r.url)
                if "draw=" in r.url and "/account/employees" in r.url else None)
        page.goto(f"{BASE}/account/employees", wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(3000)

        url = tmpl.get("url", "")
        if not url:
            log.error("could not capture the employees DataTables endpoint")
            b.close()
            return 5

        url = re.sub(r"([?&])status=[^&]*", r"\1status=all", url)
        url = re.sub(r"([?&])length=-?\d+", r"\1length=2000", url)
        r = ctx.request.get(url, headers={
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01"}, timeout=90000)
        if r.status != 200:
            log.error("employees endpoint returned HTTP %s", r.status)
            b.close()
            return 5

        payload = r.json()
        for row in payload.get("data", []):
            if not isinstance(row, dict):
                continue
            rows.append({
                "workway_id": html_to_value(row.get("id")),
                "employee_code": html_to_value(row.get("employee_id")),
                "name": html_to_value(row.get("employee_name")),
                "email": html_to_value(row.get("email")),
                "status": html_to_value(row.get("status")),
            })
        log.info("employees: %d of %d reported", len(rows), payload.get("recordsTotal"))
        b.close()

    log.info("status breakdown: %s", dict(Counter(r["status"] for r in rows)))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    csv_path = out.parent / "employee-status.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["workway_id", "employee_code", "name", "email", "status"])
        w.writeheader()
        w.writerows(rows)
    log.info("wrote %s and %s", out, csv_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
