#!/usr/bin/env python3
"""Export full Worksuite employee *profile* pages (CES Tech).

The list endpoint (workway.py) gives one row per employee with ~20 fields. Each
employee also has a detail page at /account/employees/<id> whose Profile tab
carries much more -- date of birth, home and business address, marital status,
hourly rate, probation/notice dates, reporting line, and so on.

This reads those profile pages for a set of employee IDs and writes one row each.

    python workway_profile.py --id 3397 --id 3155
    python workway_profile.py --ids-from ids.txt
    python workway_profile.py --from-list            # ids the list endpoint returns

The IDs must come from somewhere you're entitled to: an explicit list, or the
list endpoint (which the server already scopes to your role). This tool does NOT
sweep sequential IDs -- brute-forcing /employees/1, /2, /3 ... to harvest whoever
the permission model happens to expose is ID enumeration, not a feature.

A profile you may not view returns HTTP 403 (or 404 if the ID doesn't exist);
those are logged and skipped, not written.
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from output import Sink

log = logging.getLogger("workway.profile")

DEFAULT_BASE = "https://cestech.workway.pro"

# Extract every label/value row inside the "Profile Info" card. Each row is a
# div holding a light-grey label <p> followed by a dark-grey value <p>.
EXTRACT_JS = r"""
() => {
  // Find the Profile Info card by its header text.
  let card = null;
  for (const h of document.querySelectorAll('.card-header, h4, h5')) {
    if (/profile info/i.test((h.innerText || '').trim())) {
      card = h.closest('.card') || h.parentElement;
      break;
    }
  }
  if (!card) return { ok: false, pairs: [] };

  const pairs = [];
  card.querySelectorAll('div').forEach(row => {
    const ps = row.querySelectorAll(':scope > p');
    if (ps.length === 2) {
      const label = (ps[0].innerText || '').trim();
      const value = (ps[1].innerText || '').trim();
      if (label) pairs.push([label, value]);
    }
  });

  // Reporting-to sits in its own card; grab it too if present.
  let manager = '';
  for (const h of document.querySelectorAll('.card-header, h4, h5')) {
    if (/reporting to/i.test((h.innerText || '').trim())) {
      const c = h.closest('.card') || h.parentElement;
      const name = c && c.querySelector('a, h5, .f-15, .text-dark-grey');
      if (name) manager = (name.innerText || '').trim().replace(/\s+/g, ' ');
      break;
    }
  }
  return { ok: true, pairs, manager, title: document.title };
}
"""

# Map the page's human labels to stable snake_case column names. Anything not
# listed is still kept, slugged automatically -- this just fixes column order and
# naming for the common fields.
LABEL_MAP = {
    "Employee ID": "employee_code",
    "Full Name": "name",
    "Designation": "designation",
    "Department": "department",
    "Gender": "gender",
    "Date of Birth": "date_of_birth",
    "Work Anniversary": "work_anniversary",
    "Email": "email",
    "Mobile": "mobile",
    "Slack Member ID": "slack_member_id",
    "Hourly Rate": "hourly_rate",
    "Address": "address",
    "Business Address": "business_address",
    "Skills": "skills",
    "Language": "language",
    "Marital Status": "marital_status",
    "Marriage Anniversary Date": "marriage_anniversary",
    "Probation End Date": "probation_end_date",
    "Notice Period Start Date": "notice_period_start_date",
    "Notice Period End Date": "notice_period_end_date",
    "Employment Type": "employment_type",
    "Joining Date": "joining_date",
    "Exit Date": "exit_date",
}

PLACEHOLDERS = {"--", "-", "—", ""}
_SLUG = re.compile(r"[^a-z0-9]+")


def slug(label: str) -> str:
    return _SLUG.sub("_", label.lower()).strip("_") or "field"


def clean(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return "" if value in PLACEHOLDERS else value


def resolve_ids(args: argparse.Namespace, request) -> list[str]:
    ids: list[str] = []
    if args.id:
        ids += [str(i) for i in args.id]
    if args.ids_from:
        text = Path(args.ids_from).read_text()
        ids += re.findall(r"\d+", text)
    if args.from_list:
        ids += ids_from_list(args, request)
    # de-dupe, preserve order
    seen, ordered = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            ordered.append(i)
    return ordered


def ids_from_list(args: argparse.Namespace, request) -> list[str]:
    """Pull employee IDs from the DataTable endpoint (already role-scoped)."""
    import argparse as _ap

    from workway import build_url

    dt_args = _ap.Namespace(search="", status="all", role="all", designation="all",
                            department="all", employment_type="all")
    ids, start = [], 0
    while True:
        url = build_url(args.base_url, dt_args, start, 100)
        # The endpoint only returns JSON for an AJAX-looking request; a plain GET
        # gets the HTML page (or a 500) back.
        r = request.get(url, headers={"X-Requested-With": "XMLHttpRequest",
                                      "Accept": "application/json, text/javascript, */*; q=0.01"},
                        timeout=60_000)
        if r.status != 200:
            break
        try:
            payload = r.json()
        except Exception:
            break
        data = payload.get("data", [])
        if not data:
            break
        ids += [str(row.get("id")) for row in data if row.get("id")]
        start += 100
        if start >= payload.get("recordsFiltered", 0):
            break
    return ids


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech.json")
    p.add_argument("--base-url", default=DEFAULT_BASE)
    p.add_argument("--id", type=int, action="append", help="employee id (repeatable)")
    p.add_argument("--ids-from", metavar="FILE", help="read ids from a file (any digits)")
    p.add_argument("--from-list", action="store_true",
                   help="use the ids the list endpoint returns for your account")
    p.add_argument("--out", default="out/cestech-profiles.csv")
    p.add_argument("--format", choices=["csv", "json", "jsonl"])
    p.add_argument("--delay-ms", type=int, default=800)
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

    from playwright.sync_api import sync_playwright

    columns = ["id"] + list(LABEL_MAP.values()) + ["reporting_to", "profile_url"]
    fmt = args.format or Path(args.out).suffix.lstrip(".").lower() or "csv"
    sink = Sink(args.out, fmt, columns, dedupe_on=["id"])

    denied, missing = [], []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()

        ids = resolve_ids(args, ctx.request)
        if not ids:
            log.error("no ids to fetch. Pass --id, --ids-from FILE, or --from-list")
            sink.abandon()
            b.close()
            return 2
        log.info("%d profile(s) to fetch", len(ids))

        for eid in ids:
            url = f"{args.base_url.rstrip('/')}/account/employees/{eid}"
            try:
                resp = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            except Exception as exc:
                log.warning("id %s: load failed (%s)", eid, exc)
                continue

            status = resp.status if resp else 0
            if "/login" in page.url:
                log.error("redirected to login -- session expired. Refresh with:\n"
                          "  python scrape.py --login %s/login --storage-state %s",
                          args.base_url.rstrip("/"), state)
                sink.abandon()
                b.close()
                return 4
            if status == 403:
                denied.append(eid); log.info("id %s: 403 not permitted, skipped", eid); continue
            if status == 404:
                missing.append(eid); log.info("id %s: 404 not found, skipped", eid); continue

            page.wait_for_timeout(args.delay_ms)
            data = page.evaluate(EXTRACT_JS)
            if not data.get("ok"):
                log.warning("id %s: no Profile Info card found", eid)
                continue

            record = {"id": str(eid), "profile_url": url, "reporting_to": clean(data.get("manager", ""))}
            for label, value in data.get("pairs", []):
                col = LABEL_MAP.get(label, slug(label))
                record[col] = clean(value)
            sink.add(record)
            log.info("id %s: %s (%d fields)", eid, record.get("name") or "?", len(record))

        b.close()

    path = sink.finalize()
    log.info("done: %d profile(s) -> %s", sink.count, path)
    if denied:
        log.info("%d id(s) returned 403 (not permitted for this account): %s",
                 len(denied), ", ".join(map(str, denied[:20])))
    if missing:
        log.info("%d id(s) returned 404 (no such employee): %s",
                 len(missing), ", ".join(map(str, missing[:20])))
    return 0 if sink.count else 1


if __name__ == "__main__":
    raise SystemExit(main())
