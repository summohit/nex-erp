#!/usr/bin/env python3
"""Export the CES Tech (Worksuite) employee list to CSV/JSON.

The employees page is a server-side DataTable, so rather than parsing the
rendered HTML this talks to the JSON endpoint the page itself calls. That is
markedly more robust -- no CSS selectors to break on a redesign -- and it returns
fields the visible table does not show (probation/notice dates, roles, IDs).

Authentication reuses a session saved by `scrape.py --login`:

    python scrape.py --login https://cestech.workway.pro/login \
                     --storage-state auth/cestech.json
    python workway.py

NOTE: the endpoint only ever returns employees your account is allowed to see.
An ordinary employee login sees exactly one row -- itself. A full export needs
an HR/admin account.
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import re
import sys
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))

from output import Sink

log = logging.getLogger("workway")

DEFAULT_BASE = "https://cestech.workway.pro"
ENDPOINT = "/account/employees"

# Columns the DataTable declares; the server needs them to build its query.
DT_COLUMNS = [
    "check", "DT_RowIndex", "id", "employee_id", "name", "employment_type",
    "employee_name", "email", "role", "current_role_name", "mobile",
    "designation_name", "department_name", "reporting_to", "joining_date",
    "status", "action",
]

# (output column, source key) for values that arrive clean.
PLAIN_FIELDS = [
    ("id", "id"),
    ("name", "employee_name"),
    ("salutation", "salutation"),
    ("gender", "gender"),
    ("email", "email"),
    ("mobile", "mobile_with_phonecode"),
    ("designation", "designation_name"),
    ("department", "department_name"),
    ("current_role", "current_role_name"),
    ("reporting_to", "reporting_to"),
    ("joining_date", "joining_date"),
    ("created_at", "created_at"),
    ("image_url", "image_url"),
]

# Keys lifted out of the nested `employee_detail` object.
DETAIL_FIELDS = [
    ("employment_type", "employment_type"),
    ("probation_end_date", "probation_end_date"),
    ("notice_period_end_date", "notice_period_end_date"),
    ("internship_end_date", "internship_end_date"),
]

COLUMNS = (
    ["employee_code"]
    + [name for name, _ in PLAIN_FIELDS]
    + ["status"]
    + [name for name, _ in DETAIL_FIELDS]
    + ["roles", "profile_url"]
)

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_HREF = re.compile(r'href="([^"]+)"')


def strip_html(value: object) -> str:
    """Several columns arrive as rendered HTML; keep only their text."""
    if value is None:
        return ""
    text = html.unescape(_TAG.sub(" ", str(value)))
    return _WS.sub(" ", text).strip()


def first_href(value: object) -> str:
    match = _HREF.search(str(value or ""))
    return match.group(1) if match else ""


def flatten(row: dict) -> dict[str, str]:
    out: dict[str, str] = {"employee_code": strip_html(row.get("employee_id"))}

    for name, key in PLAIN_FIELDS:
        value = row.get(key)
        out[name] = "" if value is None else str(value)

    out["status"] = strip_html(row.get("status"))

    detail = row.get("employee_detail") or {}
    if not isinstance(detail, dict):
        detail = {}
    for name, key in DETAIL_FIELDS:
        value = detail.get(key)
        out[name] = "" if value is None else str(value)

    roles = row.get("roles") or []
    out["roles"] = ", ".join(
        r.get("display_name", "") for r in roles if isinstance(r, dict)
    ) if isinstance(roles, list) else ""

    out["profile_url"] = first_href(row.get("employee_id")) or first_href(row.get("name"))

    # reporting_to is a plain name at the top level but an object inside detail;
    # prefer whichever actually carries a name.
    if not out["reporting_to"]:
        manager = detail.get("reporting_to")
        if isinstance(manager, dict):
            out["reporting_to"] = str(manager.get("name") or "")
    return out


def build_url(base: str, args: argparse.Namespace, start: int, length: int) -> str:
    params: dict[str, object] = {}
    for i, col in enumerate(DT_COLUMNS):
        params[f"columns[{i}][data]"] = col
    params.update({
        "draw": 1,
        "start": start,
        "length": length,
        "order[0][column]": 2,
        "order[0][dir]": "asc",
        "search[value]": args.search,
        "searchText": args.search,
        "status": args.status,
        "employee": "all",
        "role": args.role,
        "gender": "all",
        "designation": args.designation,
        "department": args.department,
        "employmentType": args.employment_type,
        "startDate": "",
        "endDate": "",
        "lastStartDate": "",
        "lastEndDate": "",
    })
    return f"{base.rstrip('/')}{ENDPOINT}?{urlencode(params)}"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech.json",
                   help="session file from `scrape.py --login` (default: %(default)s)")
    p.add_argument("--base-url", default=DEFAULT_BASE)
    p.add_argument("--out", default="out/cestech-employees.csv",
                   help="output path; .csv, .json or .jsonl (default: %(default)s)")
    p.add_argument("--format", choices=["csv", "json", "jsonl"])
    p.add_argument("--status", default="all", help="active | inactive | all (default: all)")
    p.add_argument("--department", default="all")
    p.add_argument("--designation", default="all")
    p.add_argument("--role", default="all")
    p.add_argument("--employment-type", default="all")
    p.add_argument("--search", default="", help="free-text filter")
    p.add_argument("--page-size", type=int, default=100)
    p.add_argument("--max-records", type=int, default=0, help="0 = all")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s. Create one with:\n"
                  "  python scrape.py --login %s/login --storage-state %s",
                  state, args.base_url.rstrip("/"), state)
        return 4

    fmt = args.format or Path(args.out).suffix.lstrip(".").lower() or "csv"
    sink = Sink(args.out, fmt, COLUMNS, dedupe_on=["id"], max_items=args.max_records)

    from playwright.sync_api import sync_playwright

    total_expected = None
    try:
        with sync_playwright() as pw:
            request = pw.request.new_context(
                storage_state=str(state),
                extra_http_headers={
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                },
            )
            start = 0
            while True:
                url = build_url(args.base_url, args, start, args.page_size)
                response = request.get(url, timeout=60_000)
                if response.status != 200:
                    log.error("HTTP %s from the employees endpoint", response.status)
                    sink.abandon()
                    return 1
                try:
                    payload = response.json()
                except Exception:
                    body = response.text()[:200].lower()
                    if "<html" in body or "login" in body:
                        log.error("got a login page instead of JSON -- the session has "
                                  "expired. Refresh it with:\n"
                                  "  python scrape.py --login %s/login --storage-state %s",
                                  args.base_url.rstrip("/"), state)
                        sink.abandon()
                        return 4
                    log.error("unexpected non-JSON response: %s", body)
                    sink.abandon()
                    return 1

                rows = payload.get("data") or []
                if total_expected is None:
                    total_expected = payload.get("recordsFiltered", 0)
                    log.info("server reports %s employee(s) visible to this account",
                             total_expected)
                for row in rows:
                    sink.add(flatten(row))
                log.info("fetched %d row(s) (offset %d), %d stored so far",
                         len(rows), start, sink.count)

                start += args.page_size
                if not rows or sink.full or start >= (total_expected or 0):
                    break
            request.dispose()
    except KeyboardInterrupt:
        log.warning("interrupted")
        path = sink.finalize()
        log.info("wrote %d record(s) to %s", sink.count, path)
        return 130
    except Exception as exc:
        sink.abandon()
        log.error("export failed: %s", exc)
        return 1

    path = sink.finalize()
    log.info("done: %d employee(s) -> %s", sink.count, path)

    if sink.count <= 1:
        log.warning(
            "only %d employee returned. Worksuite scopes this list to what your "
            "ROLE may see -- a plain employee account sees just itself. For a full "
            "export, log in with an HR/admin account:\n"
            "  python scrape.py --login %s/login --storage-state %s",
            sink.count, args.base_url.rstrip("/"), state)
    return 0 if sink.count else 1


if __name__ == "__main__":
    raise SystemExit(main())
