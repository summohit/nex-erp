#!/usr/bin/env python3
"""Full CES Tech (Worksuite) employee export: list -> each employee -> all tabs.

This walks the whole flow you see in the UI:

  1. the employee list (the DataTable endpoint), to get the set of employee IDs
     your account is allowed to see;
  2. for each employee, the detail page's Profile tab plus every other tab
     (Attendance, Leaves, Leaves Quota, Documents, Emergency Contacts,
     Appreciation, Activity, Immigration).

It writes:
  * out/cestech-full.json     -- one nested object per employee (profile + tabs)
  * out/cestech-employees.csv -- one flat row per employee (profile fields only)
  * with --split-tabs, also out/tabs/<tab>.csv -- one CSV per tab, employee_id
    column included, for loading into a database.

Usage:
  python workway_full.py --from-list                 # everyone the list returns
  python workway_full.py --id 3397 --id 3155         # specific employees
  python workway_full.py --ids-from ids.txt --split-tabs
  python workway_full.py --from-list --tabs profile,leaves,emergency-contacts

Access notes:
  * The list is scoped by your role. A plain employee account returns only
    itself; a full roster needs an HR/admin login.
  * Individual tabs you may not view return HTTP 403 (logged and skipped).
  * This does NOT enumerate sequential IDs -- it only fetches IDs the list
    returns or ones you pass explicitly.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from workway_common import (
    DETAIL_TABS, DOCUMENTS_JS, PROFILE_JS, PROFILE_LABELS, TABLE_JS,
    clean, slug, table_to_records,
)

log = logging.getLogger("workway.full")
DEFAULT_BASE = "https://cestech.workway.pro"
ALL_TABS = ["profile"] + DETAIL_TABS


def re_int(text: str) -> list[str]:
    import re
    return re.findall(r"\d+", text)


def dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for i in items:
        if i not in seen:
            seen.add(i); out.append(i)
    return out


def resolve_ids(args, request) -> list[str]:
    ids: list[str] = []
    if args.id:
        ids += [str(i) for i in args.id]
    if args.ids_from:
        import re
        ids += re.findall(r"\d+", Path(args.ids_from).read_text())
    if args.from_list:
        ids += ids_from_list(args, request)
    seen, ordered = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i); ordered.append(i)
    return ordered


# The DataTable endpoint only returns JSON when the request looks like the
# page's own AJAX call; a plain GET gets the HTML page (or a 500) instead.
AJAX_HEADERS = {
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}


def list_rows(args, request) -> list[dict]:
    """Return every raw employee row the list endpoint gives this account."""
    import argparse as _ap
    from workway import build_url
    dt = _ap.Namespace(search="", status=args.status, role="all", designation="all",
                       department="all", employment_type="all")
    rows, start = [], 0
    while True:
        r = request.get(build_url(args.base_url, dt, start, 100),
                        headers=AJAX_HEADERS, timeout=60_000)
        if r.status != 200:
            log.error("list endpoint returned HTTP %s -- cannot read the roster", r.status)
            break
        try:
            payload = r.json()
        except Exception:
            body = r.text()[:200].lower()
            if "login" in body or "<html" in body:
                raise SessionGone()
            log.error("list endpoint did not return JSON; got: %s", body)
            break
        data = payload.get("data", [])
        if not data:
            break
        rows += [row for row in data if row.get("id")]
        start += 100
        if start >= payload.get("recordsFiltered", 0):
            break
    log.info("list endpoint returned %d employee(s) for this account", len(rows))
    return rows


def ids_from_list(args, request) -> list[str]:
    return [str(row["id"]) for row in list_rows(args, request)]


def fallback_record(eid: str, base: str, row: dict) -> dict:
    """Build an employee record from list-level data when the detail page is 403.

    HR can see everyone in the list even when a few individual profiles are locked,
    so these employees still appear -- just with the summary fields and a flag.
    """
    from workway import flatten
    flat = flatten(row)
    profile = {
        "employee_code": flat.get("employee_code", ""),
        "name": flat.get("name", ""),
        "designation": flat.get("designation", ""),
        "department": flat.get("department", ""),
        "gender": flat.get("gender", ""),
        "email": flat.get("email", ""),
        "mobile": flat.get("mobile", ""),
        "reporting_to": flat.get("reporting_to", ""),
        "joining_date": flat.get("joining_date", ""),
        "employment_type": flat.get("employment_type", ""),
    }
    return {
        "id": eid,
        "profile_url": f"{base}/account/employees/{eid}",
        "detail_accessible": False,
        "profile": {k: v for k, v in profile.items() if v},
    }


def wait_for_tab_content(page, timeout_ms: int = 8000) -> None:
    """Several tabs (emergency contacts, leaves, ...) fill their tables by AJAX
    after the page loads and show a spinner meanwhile. Wait for the DataTables
    processing indicator to clear so we don't extract an empty table."""
    try:
        page.wait_for_load_state("networkidle", timeout=timeout_ms)
    except Exception:
        pass
    try:
        page.wait_for_function(
            "() => { const p = document.querySelector('.dataTables_processing');"
            " return !p || getComputedStyle(p).display === 'none'; }",
            timeout=timeout_ms,
        )
    except Exception:
        pass


def extract_documents(page) -> list[dict]:
    return page.evaluate(DOCUMENTS_JS)


def extract_profile(page) -> tuple[dict, str]:
    data = page.evaluate(PROFILE_JS)
    record, manager = {}, clean(data.get("manager", ""))
    for label, value in data.get("pairs", []):
        record[PROFILE_LABELS.get(label, slug(label))] = clean(value)
    return record, manager


def extract_tab(page) -> list[dict]:
    data = page.evaluate(TABLE_JS)
    records: list[dict] = []
    for table in data.get("tables", []):
        records += table_to_records(table)
    return records


def fetch_employee(page, base: str, eid: str, tabs: list[str], delay_ms: int) -> dict | None:
    """Return a nested dict for one employee, or None if not accessible."""
    result: dict = {"id": eid, "profile_url": f"{base}/account/employees/{eid}"}

    # Profile tab first -- it also tells us the page is reachable at all.
    resp = page.goto(result["profile_url"], wait_until="domcontentloaded", timeout=45_000)
    if "/login" in page.url:
        raise SessionGone()
    status = resp.status if resp else 0
    if status in (403, 404):
        log.info("id %s: HTTP %s, skipped", eid, status)
        return None
    page.wait_for_timeout(delay_ms)

    if "profile" in tabs:
        profile, manager = extract_profile(page)
        profile["reporting_to"] = manager
        result["profile"] = profile
        name = profile.get("name") or "?"
    else:
        name = "?"

    for tab in tabs:
        if tab == "profile":
            continue
        url = f"{result['profile_url']}?tab={tab}"
        try:
            r = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            if "/login" in page.url:
                raise SessionGone()
            if r and r.status in (403, 404):
                result[slug(tab)] = []
                continue
            wait_for_tab_content(page)
            page.wait_for_timeout(delay_ms)
            if tab == "documents":
                result[slug(tab)] = extract_documents(page)
            else:
                result[slug(tab)] = extract_tab(page)
        except SessionGone:
            raise
        except Exception as exc:
            log.warning("id %s tab %s: %s", eid, tab, exc)
            result[slug(tab)] = []

    counts = {k: len(v) for k, v in result.items() if isinstance(v, list)}
    log.info("id %s: %s | profile %d field(s), tabs %s",
             eid, name, len(result.get("profile", {})), counts)
    return result


class SessionGone(RuntimeError):
    pass


def write_outputs(records: list[dict], out_dir: Path, split_tabs: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. nested JSON
    json_path = out_dir / "cestech-full.json"
    json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("wrote %s (%d employees)", json_path, len(records))

    # 2. flat profile CSV
    columns = (["id", "detail_accessible"] + list(PROFILE_LABELS.values())
               + ["reporting_to", "profile_url"])
    csv_path = out_dir / "cestech-employees.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for rec in records:
            flat = {"id": rec["id"], "profile_url": rec.get("profile_url", ""),
                    "detail_accessible": rec.get("detail_accessible", True)}
            flat.update(rec.get("profile", {}))
            writer.writerow(flat)
    log.info("wrote %s", csv_path)

    # 3. one CSV per tab
    if split_tabs:
        tabs_dir = out_dir / "tabs"
        tabs_dir.mkdir(exist_ok=True)
        by_tab: dict[str, list[dict]] = {}
        for rec in records:
            for key, value in rec.items():
                if isinstance(value, list) and value:
                    for row in value:
                        by_tab.setdefault(key, []).append({"employee_id": rec["id"], **row})
        for tab, rows in by_tab.items():
            cols, seen = [], set()
            for row in rows:
                for k in row:
                    if k not in seen:
                        seen.add(k); cols.append(k)
            path = tabs_dir / f"{tab}.csv"
            with path.open("w", newline="", encoding="utf-8-sig") as fh:
                writer = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(rows)
            log.info("wrote %s (%d rows)", path, len(rows))


def checkpoint_path(out_dir: Path) -> Path:
    return out_dir / "cestech-full.checkpoint.jsonl"


def load_checkpoint(out_dir: Path) -> list[dict]:
    """Return employee records already saved by a previous (interrupted) run."""
    path = checkpoint_path(out_dir)
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def append_checkpoint(out_dir: Path, record: dict) -> None:
    """Append one finished employee so a crash never loses more than the current one."""
    path = checkpoint_path(out_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech.json")
    p.add_argument("--base-url", default=DEFAULT_BASE)
    p.add_argument("--id", type=int, action="append")
    p.add_argument("--ids-from", metavar="FILE")
    p.add_argument("--from-list", action="store_true")
    p.add_argument("--status", default="all", help="list filter: active | inactive | all")
    p.add_argument("--tabs", default=",".join(ALL_TABS),
                   help=f"comma-separated subset of: {', '.join(ALL_TABS)}")
    p.add_argument("--out-dir", default="out")
    p.add_argument("--split-tabs", action="store_true", help="also write out/tabs/<tab>.csv")
    p.add_argument("--delay-ms", type=int, default=700)
    p.add_argument("--limit", type=int, default=0, help="cap number of employees (0 = all)")
    p.add_argument("--fresh", action="store_true",
                   help="ignore any existing checkpoint and start the run over")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    base = args.base_url.rstrip("/")
    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s. Create one with:\n"
                  "  python scrape.py --login %s/login --storage-state %s", state, base, state)
        return 4

    tabs = [t.strip() for t in args.tabs.split(",") if t.strip()]
    bad = [t for t in tabs if t not in ALL_TABS]
    if bad:
        log.error("unknown tab(s): %s. Choose from: %s", bad, ", ".join(ALL_TABS))
        return 2

    from playwright.sync_api import sync_playwright

    out_dir = Path(args.out_dir)
    if args.fresh:
        checkpoint_path(out_dir).unlink(missing_ok=True)
    records: list[dict] = load_checkpoint(out_dir)
    done_ids = {str(r.get("id")) for r in records}
    if records:
        log.info("resuming: %d employee(s) already saved in checkpoint (use --fresh to restart)",
                 len(records))
    denied = 0
    completed = False
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ctx = b.new_context(storage_state=str(state))
            page = ctx.new_page()

            row_map: dict[str, dict] = {}
            try:
                if args.from_list:
                    rows = list_rows(args, ctx.request)
                    row_map = {str(r["id"]): r for r in rows}
                    ids = list(row_map.keys())
                    if args.id:
                        ids += [str(i) for i in args.id if str(i) not in row_map]
                    if args.ids_from:
                        ids += re_int(Path(args.ids_from).read_text())
                    ids = dedupe(ids)
                else:
                    ids = resolve_ids(args, ctx.request)
            except SessionGone:
                log.error("redirected to login -- session expired. Refresh with:\n"
                          "  python scrape.py --login %s/login --storage-state %s", base, state)
                b.close(); return 4
            if not ids:
                log.error("no ids to fetch. Pass --from-list, --id, or --ids-from")
                b.close(); return 2
            if args.limit:
                ids = ids[:args.limit]
            todo = [e for e in ids if e not in done_ids]
            log.info("fetching %d employee(s) (%d already done), tabs: %s",
                     len(todo), len(ids) - len(todo), ", ".join(tabs))

            for eid in todo:
                try:
                    rec = fetch_employee(page, base, eid, tabs, args.delay_ms)
                except SessionGone:
                    log.error("redirected to login -- session expired. Refresh with:\n"
                              "  python scrape.py --login %s/login --storage-state %s", base, state)
                    b.close()
                    if records:
                        write_outputs(records, out_dir, args.split_tabs)
                    log.info("checkpoint saved; re-run the same command to resume from here")
                    return 4
                if rec is None:
                    denied += 1
                    row = row_map.get(eid)
                    if row is not None:  # detail locked, but list data is visible
                        rec = fallback_record(eid, base, row)
                        records.append(rec)
                        append_checkpoint(out_dir, rec)
                else:
                    rec["detail_accessible"] = True
                    records.append(rec)
                    append_checkpoint(out_dir, rec)
            completed = True
            b.close()
    except KeyboardInterrupt:
        log.warning("interrupted; writing what was collected (re-run to resume)")

    if not records:
        log.error("no employees fetched (%d denied/missing)", denied)
        return 1
    write_outputs(records, out_dir, args.split_tabs)
    if completed:
        # A clean, complete run consumed the checkpoint -- drop it so the next run
        # starts fresh. An interrupted run keeps it so the same command resumes.
        checkpoint_path(out_dir).unlink(missing_ok=True)
    else:
        log.info("checkpoint kept at %s; re-run the same command to resume",
                 checkpoint_path(out_dir))
    log.info("done: %d employee(s) exported, %d skipped (403/404)", len(records), denied)
    if len(records) <= 1 and args.from_list:
        log.warning("only %d employee returned -- this account's list is scoped to itself. "
                    "Use an HR/admin login for the full roster.", len(records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
