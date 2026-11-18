"""Read the shared tracker (OneDrive) back into data.json.

The team edits the Excel file in OneDrive; that file is the source of truth.
Run this BEFORE adding the day's new items, so nobody's edits are lost:

    python3 sync.py "<OneDrive>/MIRA Tracker/MIRA Project Tracker.xlsx" data.json

Every row on the Modules, Features, Bugs, Roadmap, Releases, Decisions and
Open Questions tabs (including rows the team added) replaces the matching list
in data.json. The Dashboard is never read; it is rebuilt from the data.
"""
import datetime as dt
import json
import sys

from openpyxl import load_workbook

SRC, DATA = sys.argv[1], sys.argv[2]
HEADER_ROW = 4


def iso(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.date().isoformat() if isinstance(v, dt.datetime) else v.isoformat()
    if isinstance(v, str) and v.strip():
        for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return dt.datetime.strptime(v.strip(), fmt).date().isoformat()
            except ValueError:
                pass
        return v.strip()
    return None


def text(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def rows(ws):
    """Data rows under the header, as dicts keyed by header text; blank rows skipped."""
    headers = [c.value for c in ws[HEADER_ROW]]
    for r in ws.iter_rows(min_row=HEADER_ROW + 1, values_only=True):
        if not any(v not in (None, "") for v in r):
            continue
        yield dict(zip(headers, r))


wb = load_workbook(SRC, data_only=True)
data = json.load(open(DATA, encoding="utf-8"))

data["modules"] = [dict(module=text(r["Module"]), area=text(r["Area"]), status=text(r["Status"]),
                        pct=float(r["% Complete"] or 0), works=text(r["What works today"]) or "",
                        gaps=text(r["Known gaps / pending"]) or "—", updated=iso(r["Last major update"]))
                   for r in rows(wb["Modules"]) if text(r["Module"])]

data["features"] = [dict(date=iso(r["Date"]) or data["as_of"], module=text(r["Module"]) or "", feature=text(r["Feature"]),
                         what=text(r["What it does"]) or "", users=text(r["Who uses it"]) or "",
                         status=text(r["Status"]) or "Pending", release=text(r["Release"]) or "—",
                         assignee=text(r["Assigned to"]))
                    for r in rows(wb["Features"]) if text(r["Feature"])]

data["bugs"] = [dict(found=iso(r["Found on"]) or data["as_of"], module=text(r["Module"]) or "", bug=text(r["Bug"]),
                     cause=text(r["Cause"]) or "", fix=text(r["Fix"]) or "", severity=text(r["Severity"]) or "Medium",
                     status=text(r["Status"]) or "Open", fixed_on=iso(r["Fixed on"]), verified=text(r["Verified"]),
                     assignee=text(r["Assigned to"]), steps=text(r.get("How to check (steps)")),
                     screenshot=None)
                for r in rows(wb["Bugs"]) if text(r["Bug"])]
# Keep screenshot file names: the cell shows 'View', the file name lives in data.json.
_prev = {b["bug"]: b.get("screenshot") for b in json.load(open(DATA, encoding="utf-8")).get("bugs", [])}
for b in data["bugs"]:
    b["screenshot"] = _prev.get(b["bug"])

data["roadmap"] = [dict(priority=text(r["Priority"]) or "P2", item=text(r["Item"]), module=text(r["Module"]) or "",
                        why=text(r["Why it matters"]) or "", waiting=text(r["Waiting for"]) or "—",
                        owner=text(r["Owner"]), target=iso(r["Target date"]), status=text(r["Status"]) or "Pending")
                   for r in rows(wb["Roadmap"]) if text(r["Item"])]

data["releases"] = [dict(date=iso(r["Date"]), version=text(r["Version / commit"]) or "—", what=text(r["What's included"]),
                         db=text(r["Database changes"]) or "—", status=text(r["Status"]) or "Live",
                         verified_by=text(r["Verified by"]))
                    for r in rows(wb["Releases"]) if text(r["What's included"])]

data["decisions"] = [dict(date=iso(r["Date"]), area=text(r["Area"]) or "", decision=text(r["Decision"]),
                          details=text(r["Details"]) or "")
                     for r in rows(wb["Decisions"]) if text(r["Decision"])]

data["questions"] = [dict(area=text(r["Area"]) or "", question=text(r["Question"]), why=text(r["Why it matters"]) or "",
                          who=text(r["Who answers"]) or "", answer=text(r["Answer"]), status=text(r["Status"]) or "Open")
                     for r in rows(wb["Open Questions"]) if text(r["Question"])]

if "Work Log" in wb.sheetnames:
    data["worklog"] = [dict(date=iso(r["Date"]), person=text(r["Person"]), type=text(r["Type"]) or "Task",
                            item=text(r["Work item"]), hours=float(r["Hours"]) if isinstance(r["Hours"], (int, float)) else None,
                            notes=text(r["Notes"]))
                       for r in rows(wb["Work Log"]) if text(r["Work item"]) and text(r["Work item"]) != "Total hours"]

json.dump(data, open(DATA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("synced from", SRC, {k: len(v) for k, v in data.items() if isinstance(v, list)})
