#!/usr/bin/env python3
"""Scrape CES Tech (Worksuite) letter templates and generated letters.

Two pages, both DataTables:

  * /account/letter/template - the reusable templates. `description` holds the
    HTML body, with merge tags written as ##EMPLOYEE_NAME## and friends.
  * /account/letter/generate - letters already issued to employees. Each row is
    a rendered snapshot (its own `description`) plus the page margins used, so
    an issued letter never changes when its template is later edited.

    python workway_letters.py --storage-state auth/cestech-hr.json

Output: out_hr/letters.json  { templates: [...], letters: [...], merge_tags: [...] }
plus out_hr/letter-templates.csv and out_hr/letters-issued.csv.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import logging
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from workway_jobs import html_to_value

log = logging.getLogger("workway.letters")
BASE = "https://cestech.workway.pro"

TAG_RE = re.compile(r"##[A-Z_]+##")


def fetch_table(ctx, page, slug: str, drop: set[str]) -> list[dict]:
    """Load a letter page, capture its DataTables URL, then re-request it whole."""
    tmpl: dict[str, str] = {}
    page.on("response", lambda r: tmpl.setdefault("url", r.url)
            if "draw=" in r.url and "/letter" in r.url else None)
    page.goto(f"{BASE}/account/letter/{slug}", wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)

    url = tmpl.get("url", "")
    if not url:
        log.error("could not capture the DataTables endpoint for /letter/%s", slug)
        return []

    url = re.sub(r"([?&])length=-?\d+", r"\g<1>length=2000", url)
    if "length=" not in url:
        url += "&length=2000"
    r = ctx.request.get(url, headers={
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01"}, timeout=90000)
    if r.status != 200:
        log.error("/letter/%s returned HTTP %s", slug, r.status)
        return []

    payload = r.json()
    rows = []
    for row in payload.get("data", []):
        if not isinstance(row, dict):
            continue
        # `description` is the letter body. Keep its HTML rather than flattening
        # it, but unescape once: the endpoint returns it entity-encoded
        # (&lt;p&gt;…), which Worksuite decodes client-side before editing.
        rec = {}
        for k, v in row.items():
            if k in drop:
                continue
            if k == "description":
                rec[k] = html.unescape(v) if isinstance(v, str) else v
            else:
                rec[k] = html_to_value(v)
        # DataTables renders user_id / template_id as display text, so the real
        # ids only survive on the nested relation objects.
        for src, dest in (("user", "user_real_id"), ("template", "template_real_id")):
            obj = row.get(src)
            if isinstance(obj, dict) and obj.get("id") is not None:
                rec[dest] = str(obj["id"])
            elif isinstance(obj, str):
                m = re.search(r"'id':\s*(\d+)", obj)
                if m:
                    rec[dest] = m.group(1)
        rows.append(rec)
    log.info("/letter/%s: %d of %d", slug, len(rows), payload.get("recordsTotal"))
    return rows


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-hr.json")
    p.add_argument("--out", default="out_hr/letters.json")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s", state)
        return 4

    from playwright.sync_api import sync_playwright

    drop = {"action", "DT_RowIndex", "DT_RowId", "check", "deleted_at"}
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        page = ctx.new_page()
        templates = fetch_table(ctx, page, "template", drop)
        letters = fetch_table(ctx, page, "generate", drop)
        b.close()

    tags = Counter()
    for t in templates:
        tags.update(TAG_RE.findall(t.get("description") or ""))
    log.info("merge tags in use: %s", dict(tags.most_common()))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "templates": templates,
        "letters": letters,
        "merge_tags": [{"tag": k, "uses": v} for k, v in tags.most_common()],
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    def dump(path: Path, rows: list[dict], keys: list[str]):
        if not rows:
            return
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        log.info("wrote %s (%d rows)", path, len(rows))

    dump(out.parent / "letter-templates.csv", templates, ["id", "title", "created_at"])
    dump(out.parent / "letters-issued.csv", letters,
         ["id", "employee_name", "name", "template_id", "user_id", "created_at"])
    log.info("done: %d template(s), %d issued letter(s) -> %s", len(templates), len(letters), out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
