#!/usr/bin/env python3
"""Scrape CES Tech (Worksuite) Jobs and every tab of each job.

Reads the Jobs list (all pages), then for each job pulls the Profile tab's
label/value fields plus the Candidate, Interview, Offer Letter and History tabs.

    python workway_jobs.py --storage-state auth/cestech-hr.json

Output: out_hr/jobs.json (one object per job with a `tabs` section), plus
out_hr/jobs.csv and out_hr/tabs_jobs/<tab>.csv for straightforward DB import.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from workway_common import TABLE_JS, clean, slug, table_to_records

log = logging.getLogger("workway.jobs")
BASE = "https://cestech.workway.pro"
TABS = ["candidate", "interview", "offerletter", "history"]

# The jobs list is a DataTable; select the largest page size so every row renders.
LIST_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const rows = [];
  document.querySelectorAll('tbody tr').forEach(tr => {
    const a = tr.querySelector('a[href*="/account/jobs/"]');
    const m = a && a.getAttribute('href').match(/jobs\/(\d+)/);
    if (!m) return;
    const tds = [...tr.querySelectorAll('td')].map(td => clean(td.innerText));
    rows.push({ id: m[1], cells: tds });
  });
  return rows;
}
"""

# Job Profile tab: label/value pairs live in col-12 rows with exactly two <p>s.
JOB_PROFILE_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const pairs = [];
  let descriptionHtml = '';
  // Rows are "<p>Label</p><value>" where the value is a <p> for plain fields but a
  // <div class="ql-editor"> for the rich-text Description — accept either.
  document.querySelectorAll('div').forEach(row => {
    const kids = [...row.children].filter(e => e.tagName === 'P' || e.tagName === 'DIV');
    if (kids.length !== 2 || kids[0].tagName !== 'P') return;
    const label = clean(kids[0].innerText);
    if (!label) return;
    pairs.push([label, clean(kids[1].innerText)]);
    if (/^description$/i.test(label)) descriptionHtml = kids[1].innerHTML;
  });
  // Headline counters on the profile (Openings / In Progress / ... )
  const stats = {};
  document.querySelectorAll('.card, .b-shadow-4').forEach(c => {
    const t = clean(c.innerText);
    const m = t.match(/^(Openings|In Progress|Interview scheduled|Offer Released)\s+(\d+)/i);
    if (m) stats[m[1]] = parseInt(m[2], 10);
  });
  const h = document.querySelector('.card h2, .card h3, h2, h3');
  return { pairs, descriptionHtml, stats, heading: h ? clean(h.innerText) : '' };
}
"""

# Candidate rows link to /account/job-applications/<id> — the rich application record.
CANDIDATE_IDS_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = [], seen = new Set();
  document.querySelectorAll('tbody tr').forEach(tr => {
    const a = [...tr.querySelectorAll('a[href]')]
      .find(x => /\/account\/job-applications\/\d+(\?|$)/.test(x.getAttribute('href') || ''));
    const m = a && a.getAttribute('href').match(/job-applications\/(\d+)/);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    // The candidate's name is the row's link text (the app page heading is the breadcrumb).
    const tds = [...tr.querySelectorAll('td')];
    const name = clean(a.innerText) || clean(tds[1] ? tds[1].innerText : '');
    out.push({ id: m[1], name });
  });
  return out;
}
"""

# One job application: label/value pairs plus the candidate name and resume file.
APP_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const pairs = [];
  document.querySelectorAll('div').forEach(row => {
    const kids = [...row.children].filter(e => ['P','DIV','SPAN'].includes(e.tagName));
    if (kids.length !== 2 || kids[0].tagName !== 'P') return;
    const label = clean(kids[0].innerText);
    if (label && label.length < 40) pairs.push([label, clean(kids[1].innerText)]);
  });
  const h = document.querySelector('h2, h3, .card-title, .f-21');
  const resume = [...document.querySelectorAll('a[href]')]
    .map(a => a.getAttribute('href') || '')
    .find(h => /application-files|cloudfront/.test(h)) || '';
  return { pairs, name: h ? clean(h.innerText) : '', resume };
}
"""

HISTORY_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  document.querySelectorAll('li, .timeline-item, .activity-item, .card-body p').forEach(el => {
    const t = clean(el.innerText);
    if (t && t.length > 5 && t.length < 300) out.push(t);
  });
  return [...new Set(out)].slice(0, 100);
}
"""


_TAG_RE = re.compile(r"<[^>]+>")
_SELECTED_RE = re.compile(r"<option[^>]*\bselected\b[^>]*>([^<]*)</option>", re.I)
_SELVAL_RE = re.compile(r'<select[^>]*\bvalue="([^"]*)"', re.I)


class _SelectedOption(HTMLParser):
    """Find the selected <option>'s text. Regex can't be used here: these options
    carry a data-content attribute containing raw HTML with '>' characters."""

    def __init__(self) -> None:
        super().__init__()
        self.text: str | None = None
        self._capture = False

    def handle_starttag(self, tag, attrs):
        if tag == "option":
            self._capture = any(a[0] == "selected" for a in attrs)

    def handle_data(self, data):
        if self._capture and self.text is None and data.strip():
            self.text = data.strip()

    def handle_endtag(self, tag):
        if tag == "option":
            self._capture = False


def html_to_value(raw) -> str:
    """Flatten a DataTables cell. A <select> cell is a status column, whose plain
    text would be every option concatenated — take the selected one instead."""
    if raw is None:
        return ""
    s = str(raw)
    if "<select" in s.lower():
        p = _SelectedOption()
        try:
            p.feed(s)
        except Exception:
            pass
        if p.text:
            return p.text
        m = _SELVAL_RE.search(s)
        if m:
            return m.group(1).strip()
    import html as _h
    return re.sub(r"\s+", " ", _h.unescape(_TAG_RE.sub(" ", s))).strip()


def fetch_tab_json(request, template: str, job_id: str, tab: str, length: int = 2000) -> list[dict]:
    """Pull a whole job tab from its DataTables endpoint (no 10-row page limit)."""
    url = re.sub(r"/account/jobs/\d+\?", f"/account/jobs/{job_id}?", template)
    # The interview tab filters by a job_id query param as well as the path, so a
    # template captured from another job would keep returning that job's rows.
    url = re.sub(r"([?&])job_id=\d+", rf"\g<1>job_id={job_id}", url)
    url = re.sub(r"([?&])tab=[a-z]+", rf"\g<1>tab={tab}", url)
    url = re.sub(r"([?&])length=-?\d+", rf"\g<1>length={length}", url)
    if "length=" not in url:
        url += f"&length={length}"
    hdr = {"X-Requested-With": "XMLHttpRequest",
           "Accept": "application/json, text/javascript, */*; q=0.01"}
    try:
        r = request.get(url, headers=hdr, timeout=60000)
        if r.status != 200:
            log.warning("job %s tab %s: HTTP %s", job_id, tab, r.status)
            return []
        rows = r.json().get("data", []) or []
    except Exception as exc:
        log.warning("job %s tab %s: %s", job_id, tab, exc)
        return []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        rec = {k: html_to_value(v) for k, v in row.items()
               if k not in ("check", "action", "DT_RowId", "DT_RowIndex", "color")}
        out.append(rec)
    return out


def expand_tables(page) -> None:
    """Set every DataTable on the page to its largest page size so all rows render."""
    try:
        names = page.evaluate(
            "()=>[...document.querySelectorAll('select[name$=\"_length\"]')].map(s=>s.name)")
    except Exception:
        return
    for name in names:
        try:
            opts = page.evaluate(
                f"()=>[...document.querySelectorAll('select[name=\"{name}\"] option')].map(o=>o.value)")
            if opts:
                page.select_option(f'select[name="{name}"]', opts[-1])
                page.wait_for_timeout(1200)
        except Exception as exc:
            log.debug("could not expand %s: %s", name, exc)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--storage-state", default="auth/cestech-hr.json")
    p.add_argument("--out", default="out_hr/jobs.json")
    p.add_argument("--delay-ms", type=int, default=400)
    p.add_argument("--limit", type=int, default=0, help="only first N jobs (testing)")
    p.add_argument("--with-details", action="store_true",
                   help="also open each application page for resume/DOB/notice period "
                        "(adds ~1s per application)")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(levelname)-7s %(name)s: %(message)s")

    state = Path(args.storage_state)
    if not state.exists():
        log.error("no saved session at %s; run scrape.py --login first", state)
        return 4

    from playwright.sync_api import sync_playwright

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    jobs: list[dict] = []

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(storage_state=str(state))
        ctx_request = ctx.request
        page = ctx.new_page()

        page.goto(f"{BASE}/account/jobs", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1500)
        # Show every row rather than paging.
        try:
            opts = page.evaluate("()=>[...document.querySelectorAll('select[name=\"job-table_length\"] option')].map(o=>o.value)")
            if opts:
                page.select_option('select[name="job-table_length"]', opts[-1])
                page.wait_for_timeout(2500)
        except Exception as exc:
            log.warning("could not expand page size: %s", exc)

        listing = page.evaluate(LIST_JS)
        log.info("jobs list: %d job(s)", len(listing))

        # Each tab's DataTable declares its own columns, so capture a request URL
        # per tab — reusing the candidate URL for the interview tab returns HTTP 500.
        templates: dict[str, str] = {}

        def capture(r):
            if "draw=" not in r.url or "tab=" not in r.url:
                return
            t = r.url.split("tab=")[1].split("&")[0]
            templates.setdefault(t, r.url)

        page.on("response", capture)
        for t in ("candidate", "interview", "offerletter"):
            page.goto(f"{BASE}/account/jobs/{listing[0]['id']}?tab={t}",
                      wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)
        log.info("captured DataTables templates for: %s", ", ".join(sorted(templates)) or "none")
        if args.limit:
            listing = listing[:args.limit]

        for i, row in enumerate(listing, 1):
            jid = row["id"]
            cells = row["cells"]
            # columns: [checkbox], Title, Recruiter, Start, End, Status, [action]
            job = {
                "workway_id": jid,
                "title": cells[1] if len(cells) > 1 else "",
                "recruiter": cells[2] if len(cells) > 2 else "",
                "start_date": cells[3] if len(cells) > 3 else "",
                "end_date": cells[4] if len(cells) > 4 else "",
                "status": cells[5] if len(cells) > 5 else "",
                "url": f"{BASE}/account/jobs/{jid}",
            }

            # Profile tab
            try:
                page.goto(job["url"], wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(args.delay_ms)
                prof = page.evaluate(JOB_PROFILE_JS)
                fields = {}
                for label, value in prof.get("pairs", []):
                    fields[slug(label)] = clean(value)
                job["profile"] = fields
                job["description_html"] = prof.get("descriptionHtml", "")
                job["stats"] = prof.get("stats", {})
            except Exception as exc:
                log.warning("job %s profile failed: %s", jid, exc)
                job["profile"] = {}

            # Table tabs come straight from the DataTables endpoint so nothing is
            # capped at the 10-row default page size.
            for tab in ("candidate", "interview", "offerletter"):
                tpl = templates.get(tab)
                job[tab] = fetch_tab_json(ctx_request, tpl, jid, tab) if tpl else []

            # History has no DataTable — read it from the rendered page.
            try:
                page.goto(f"{job['url']}?tab=history", wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(args.delay_ms)
                job["history"] = page.evaluate(HISTORY_JS)
            except Exception as exc:
                log.warning("job %s history failed: %s", jid, exc)
                job["history"] = []

            # Build the importer-facing candidate records from the JSON rows. These
            # already carry name/email/phone/CTC/experience, so the per-application
            # page is only needed for resume, DOB, notice period and cover letter.
            candidates = []
            for row in job.get("candidate", []):
                rec = dict(row)
                rec["application_id"] = int(row.get("id") or 0)
                rec["job_id"] = int(jid)
                rec["full_name"] = row.get("name", "")
                rec["current_status"] = row.get("status", "")
                rec.setdefault("applicant_email", row.get("email", ""))
                rec.setdefault("applicant_phone", row.get("phone", ""))
                candidates.append(rec)

            if args.with_details:
                for rec in candidates:
                    aid = rec["application_id"]
                    if not aid:
                        continue
                    try:
                        resp = page.goto(f"{BASE}/account/job-applications/{aid}",
                                         wait_until="domcontentloaded", timeout=45000)
                        page.wait_for_timeout(args.delay_ms)
                        if resp and resp.status != 200:
                            # Some application pages 500 on Workway's side.
                            rec["_error"] = f"HTTP {resp.status}"
                            continue
                        a = page.evaluate(APP_JS)
                        for k, v in a.get("pairs", []):
                            key = slug(k)
                            if key not in ("full_name",):
                                rec.setdefault(key, clean(v))
                        rec["resume_url"] = a.get("resume", "")
                    except Exception as exc:
                        log.debug("application %s failed: %s", aid, exc)

            job["candidates"] = candidates

            # Flat top-level keys so import-ces-jobs.ts consumes this unchanged.
            prof = job.get("profile", {})
            job["id"] = int(jid)
            job["title_raw"] = job["title"]
            for k in ("category", "sub_category", "department", "total_openings", "job_type",
                      "work_experience", "show_pay_by", "minimum_salary_amount", "rate",
                      "description"):
                job[k] = prof.get(k, "")
            job["recruiter"] = prof.get("recruiter", "") or job.get("recruiter", "")
            # The list's status cell is a dropdown, so its innerText concatenates the
            # options ("Open Closed"). The Profile tab carries a single clean value.
            job["status_list"] = job.get("status", "")
            if prof.get("status"):
                job["status"] = prof["status"]

            jobs.append(job)
            log.info("  [%d/%d] job %s: %s | candidates=%d(app %d) interviews=%d offers=%d",
                     i, len(listing), jid, job["title"][:30],
                     len(job.get("candidate", [])), len(candidates),
                     len(job.get("interview", [])), len(job.get("offerletter", [])))

        b.close()

    out_path.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")

    # Flat jobs CSV
    cols = ["workway_id", "title", "recruiter", "start_date", "end_date", "status", "url"]
    prof_keys: list[str] = []
    for j in jobs:
        for k in j.get("profile", {}):
            if k not in prof_keys:
                prof_keys.append(k)
    with out_path.with_suffix(".csv").open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols + prof_keys, extrasaction="ignore")
        w.writeheader()
        for j in jobs:
            w.writerow({**{c: j.get(c, "") for c in cols}, **j.get("profile", {})})

    # Per-tab CSVs with the job id attached
    tabs_dir = out_path.parent / "tabs_jobs"
    tabs_dir.mkdir(exist_ok=True)
    for tab in ("candidate", "interview", "offerletter"):
        rows = [{"job_workway_id": j["workway_id"], **r} for j in jobs for r in j.get(tab, [])]
        if not rows:
            continue
        keys: list[str] = []
        for r in rows:
            for k in r:
                if k not in keys:
                    keys.append(k)
        with (tabs_dir / f"{tab}.csv").open("w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
            w.writeheader(); w.writerows(rows)
        log.info("wrote %s (%d rows)", tabs_dir / f"{tab}.csv", len(rows))

    log.info("done: %d job(s) -> %s", len(jobs), out_path)
    log.info("  candidates=%d interviews=%d offers=%d",
             sum(len(j.get("candidate", [])) for j in jobs),
             sum(len(j.get("interview", [])) for j in jobs),
             sum(len(j.get("offerletter", [])) for j in jobs))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
