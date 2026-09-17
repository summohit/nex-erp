#!/usr/bin/env python3
"""Export CES Tech (Worksuite) time logs — every employee, any date range.

    python workway_timelogs.py --storage-state auth/cestech-hr.json \
        --start 01-01-2024 --end 17-09-2026

Output: out_hr/timelogs-<start>-<end>.json (full records) and a flat CSV.

── Why /account/time-log-report and not /account/timelogs ──────────────────
The Timesheet screen at /account/timelogs is scoped to the signed-in user, and
silently so: it accepts `employee=all` and still answers with only your own
rows, which reads as "the company logged 378 hours" when the real number is
seven times that. The report under Reports › Time Log Report is the
company-wide view of the same records. It is also date-ranged, and defaults to
the current month — so the range has to be passed explicitly or the export
quietly covers a few weeks.

── Breaks ──────────────────────────────────────────────────────────────────
`total_minutes` is already net of breaks; `duration` is the wall-clock span
including them. The two disagree wildly on logs somebody left running for a
fortnight, and the net figure is the one that means work.
"""

from __future__ import annotations

import argparse
import csv
import html as _html
import json
import logging
import re
import sys
import urllib.parse as up
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

log = logging.getLogger("workway.timelogs")

BASE = "https://cestech.workway.pro"
REPORT_URL = f"{BASE}/account/time-log-report"
PAGE_SIZE = 100

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def strip_html(value) -> str:
    """The grid hands back rendered cells; the text inside is what we want."""
    if value is None:
        return ""
    # Unescape AFTER stripping tags: the grid double-encodes, so a project
    # called "IIM POC & Implementation" arrives as "IIM POC &amp; ..." and any
    # name-matching against it silently misses.
    return _WS.sub(" ", _html.unescape(_TAG.sub(" ", str(value)))).strip()


def money(value) -> str:
    return strip_html(value).replace("₹", "").replace(",", "").strip()


def as_dict(value) -> dict:
    """Related records come back as an object, as null, or — for the ones the
    grid renders itself — as an HTML string. Only the object has fields."""
    return value if isinstance(value, dict) else {}


def flatten(row: dict) -> dict:
    """One time log, with the fields an importer needs and nothing rendered."""
    user = as_dict(row.get("user"))
    project = as_dict(row.get("project")) or as_dict(row.get("task_project"))
    task = as_dict(row.get("task"))
    client = as_dict(row.get("client"))
    breaks = row.get("breaks") or []

    return {
        "workway_id": row.get("id"),
        "employee_email": (user.get("email") or "").strip().lower(),
        "employee_name": strip_html(row.get("employee_name") or user.get("name")),
        "workway_user_id": row.get("user_id"),
        "designation": row.get("designation_name") or "",
        # A log can belong to a project task or to a standalone task.
        "project_id": project.get("id"),
        "project_name": strip_html(project.get("project_name") or row.get("project_name")),
        "project_code": row.get("short_code") or "",
        "client_name": strip_html(client.get("name") or client.get("company_name")),
        "task_id": task.get("id"),
        "task_heading": strip_html(row.get("heading") or task.get("heading")),
        "task_code": row.get("task_short_code") or "",
        "start_time": row.get("start_time") or "",
        "end_time": row.get("end_time") or "",
        # Net of breaks — see the module docstring.
        "total_minutes": row.get("total_minutes"),
        "elapsed": row.get("duration") or "",
        "break_count": len(breaks),
        "break_minutes": sum(int(b.get("total_minutes") or 0) for b in breaks),
        "memo": strip_html(row.get("memo")),
        "approved": row.get("approved"),
        "hourly_rate": row.get("hourly_rate"),
        "earnings": money(row.get("earnings")),
    }


def export(storage_state: str, start: str, end: str, out_dir: Path, headless: bool = True):
    from playwright.sync_api import sync_playwright

    rows: list[dict] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_context(storage_state=storage_state).new_page()

        # The grid's own first request is the template: DataTables sends a
        # columns[] array whose indexes its ordering refers to, and a request
        # assembled by hand without it comes back with zero rows rather than an
        # error. Capturing the real one and swapping the range is what makes
        # this robust against the column list changing.
        captured: list[str] = []
        page.on("request", lambda r: captured.append(r.url) if "time-log-report?draw" in r.url else None)
        page.goto(REPORT_URL, wait_until="networkidle", timeout=90_000)
        page.wait_for_timeout(4_000)

        if page.url.rstrip("/").endswith("/login"):
            raise SystemExit(
                "That session has expired. Sign in to Workway yourself and save a fresh "
                "storage state, then re-run."
            )
        if not captured:
            raise SystemExit("The report grid never fetched — the page layout may have changed.")

        template = captured[0]

        def fetch(offset: int, length: int) -> dict:
            parsed = up.urlparse(template)
            query = up.parse_qs(parsed.query, keep_blank_values=True)
            query.update({
                "startDate": [start], "endDate": [end],
                "start": [str(offset)], "length": [str(length)],
                "employee": ["all"], "projectId": ["all"],
                "client": ["all"], "approved": ["all"], "invoice": ["all"],
            })
            url = up.urlunparse(parsed._replace(query=up.urlencode(query, doseq=True)))
            return page.evaluate(
                """async (u) => {
                    const r = await fetch(u, {
                        headers: {'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json'},
                        credentials: 'include',
                    });
                    const t = await r.text();
                    try { return JSON.parse(t); } catch (e) { return { __error: t.slice(0, 300) }; }
                }""",
                url,
            )

        offset = 0
        total = None
        while True:
            payload = fetch(offset, PAGE_SIZE)
            if payload.get("__error"):
                raise SystemExit(f"The report returned something that is not JSON: {payload['__error']}")

            batch = payload.get("data") or []
            total = payload.get("recordsTotal", 0)
            rows.extend(batch)
            log.info("  %d/%d", len(rows), total)

            offset += PAGE_SIZE
            if offset >= total or not batch:
                break
            page.wait_for_timeout(600)  # the export is a favour, not a load test

        browser.close()

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"timelogs-{start}-{end}"
    flat = [flatten(r) for r in rows]

    (out_dir / f"{stem}.json").write_text(json.dumps(flat, indent=1, default=str))

    if flat:
        with (out_dir / f"{stem}.csv").open("w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(flat[0].keys()))
            writer.writeheader()
            writer.writerows(flat)

    log.info("wrote %d logs to %s/%s.{json,csv}", len(flat), out_dir, stem)
    return flat


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--storage-state", default="auth/cestech-hr.json")
    ap.add_argument("--start", required=True, help="dd-mm-yyyy")
    ap.add_argument("--end", required=True, help="dd-mm-yyyy")
    ap.add_argument("--out-dir", default="out_hr", type=Path)
    ap.add_argument("--headed", action="store_true", help="watch the browser work")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    export(args.storage_state, args.start, args.end, args.out_dir, headless=not args.headed)


if __name__ == "__main__":
    main()
