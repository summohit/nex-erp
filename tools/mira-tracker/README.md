# MIRA Project Tracker (Excel in OneDrive)

The team works in one shared file:
`~/Library/CloudStorage/OneDrive-ces-pl.com/MIRA Tracker/MIRA Project Tracker.xlsx`
(only the `MIRA Tracker` folder is used; nothing else in OneDrive is touched).

## Daily update (Claude does this when asked "update the tracker")
1. **Sync** – read the team's edits back from OneDrive (the file is the source of truth):
   `python3 sync.py "$TRACKER" data.json`
2. **Add today's work** to `data.json`: new features/fixes from `git log --since=<last update>`,
   new bugs, deploys (Releases), decisions, answered questions; set `as_of` to today and
   refresh `highlights`. Never edit rows the team changed unless asked.
3. **Build** the workbook (charts, dropdowns, dashboard formulas are recreated):
   `python3 build.py "$TRACKER" data.json`
   A dated copy is also kept in `docs/` for the record.

OneDrive uploads the file within seconds; the team sees it on their next open/refresh.
**Only update when nobody has the file open, and wait ~1 minute after it is closed** (Excel for the web saves once more on close) (ask Mohit to close Excel tabs first): if Excel for the web autosaves at the same time, OneDrive keeps '…-mohit’s MacBook Air.xlsx' conflict copies. Compare their editable columns before deleting any. Build ONCE per update (build.py saves to a temp file and swaps it in); several saves within a minute make OneDrive keep a '…-mohit’s MacBook Air.xlsx' conflict copy.

- `build.py` – layout, charts, formulas; data comes from `data.json`.
- `sync.py` – reads the shared Excel back into `data.json`.
- `data.json` – the tracker's data (features, bugs, roadmap, releases, decisions, questions).
