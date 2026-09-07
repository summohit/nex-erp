"""Shared helpers for the Worksuite (CES Tech) exporters."""

from __future__ import annotations

import re

PLACEHOLDERS = {"--", "-", "—", "", "- No record found. -", "Not enough data"}
_SLUG = re.compile(r"[^a-z0-9]+")
_WS = re.compile(r"\s+")

# The employee detail tabs, in the order they appear in the UI.
DETAIL_TABS = [
    "attendance", "leaves", "leaves-quota", "documents",
    "emergency-contacts", "appreciation", "activity", "immigration",
]

# Human profile labels -> stable snake_case column names.
PROFILE_LABELS = {
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


def slug(label: str) -> str:
    return _SLUG.sub("_", label.lower()).strip("_") or "field"


def clean(value: str) -> str:
    value = _WS.sub(" ", str(value or "")).strip()
    return "" if value in PLACEHOLDERS else value


# --- browser-side extractors (passed to page.evaluate) ----------------------

# Read the Profile Info card as label/value pairs, plus the reporting manager.
PROFILE_JS = r"""
() => {
  let card = null;
  for (const h of document.querySelectorAll('.card-header, h4, h5')) {
    if (/profile info/i.test((h.innerText || '').trim())) {
      card = h.closest('.card') || h.parentElement; break;
    }
  }
  const pairs = [];
  if (card) {
    card.querySelectorAll('div').forEach(row => {
      const ps = row.querySelectorAll(':scope > p');
      if (ps.length === 2) {
        const label = (ps[0].innerText || '').trim();
        if (label) pairs.push([label, (ps[1].innerText || '').trim()]);
      }
    });
  }
  let manager = '';
  for (const h of document.querySelectorAll('.card-header, h4, h5')) {
    if (/reporting to/i.test((h.innerText || '').trim())) {
      const c = h.closest('.card') || h.parentElement;
      const n = c && c.querySelector('a, h5, .f-15, .text-dark-grey');
      if (n) manager = (n.innerText || '').trim().replace(/\s+/g, ' ');
      break;
    }
  }
  return { ok: !!card, pairs, manager };
}
"""

# Read every real DataTable on a tab as {columns, rows}. Skips the sidebar and
# "no record found" placeholder rows.
TABLE_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const tables = [];
  document.querySelectorAll('table').forEach(tb => {
    const cols = [...tb.querySelectorAll('thead th')].map(th => clean(th.innerText));
    const rows = [];
    tb.querySelectorAll('tbody tr').forEach(tr => {
      // A status cell renders a <select> of every option; innerText would be all
      // of them concatenated, so take the selected one.
      const cells = [...tr.querySelectorAll('td')].map(td => {
        const sel = td.querySelector('select');
        if (sel) {
          // Candidate rows carry the status as the selected option's text (value is
          // a numeric id); offer rows leave that text blank and put the status in
          // the value ("accept"). Prefer the text, fall back to the value.
          const t = clean((sel.selectedOptions && sel.selectedOptions[0] || {}).text);
          return t || clean(sel.value);
        }
        return clean(td.innerText);
      });
      if (!cells.length) return;
      const joined = cells.join(' ');
      if (/^-?\s*no record found|not enough data|no data available/i.test(joined)) return;
      rows.push(cells);
    });
    if (cols.length || rows.length) tables.push({ cols, rows });
  });
  const empty = /no record found|not enough data|no data available/i.test(document.body.innerText || '');
  return { tables, empty };
}
"""


# Read the Documents tab, which is a grid of cards (not a table). Each card has a
# name, an uploaded-ago label, and a link to the actual file on the CDN.
DOCUMENTS_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const docs = [];
  document.querySelectorAll('.card-title, h4.card-title').forEach(title => {
    const card = title.closest('.card') || title.parentElement;
    if (!card) return;
    const links = [...card.querySelectorAll('a[href]')].map(a => a.getAttribute('href') || '');
    const cdn = links.find(h => /cloudfront|d2dhoseq8bqrlf|employee-docs\/\d+\//.test(h)) || '';
    const dl = links.find(h => /\/download\//.test(h)) || '';
    if (!cdn && !dl) return;
    const src = cdn || dl;
    const ext = (src.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
    docs.push({
      name: clean(title.innerText),
      file_url: cdn,
      download_url: dl,
      file_type: /^[a-z0-9]{1,5}$/.test(ext) ? ext : '',
    });
  });
  const seen = new Set(), out = [];
  for (const d of docs) { const k = d.file_url || d.download_url; if (k && !seen.has(k)) { seen.add(k); out.push(d); } }
  return out;
}
"""


def table_to_records(table: dict, drop_cols=("Action", "#", "")) -> list[dict]:
    """Turn a {cols, rows} capture into a list of dicts keyed by slugged header."""
    cols = table.get("cols") or []
    records = []
    for row in table.get("rows", []):
        if not cols:  # headerless: index the cells
            records.append({f"col_{i}": clean(c) for i, c in enumerate(row)})
            continue
        record = {}
        for i, cell in enumerate(row):
            header = cols[i] if i < len(cols) else f"col_{i}"
            header = header.split("\n")[0].strip()
            if header in drop_cols:
                continue
            record[slug(header)] = clean(cell)
        if any(record.values()):
            records.append(record)
    return records
