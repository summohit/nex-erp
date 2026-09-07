"""Crash-resilient result sink.

Every record is appended to a `.partial.jsonl` file the moment it is scraped, so
an interrupted run (Ctrl-C, a site timing out, a laptop lid) still leaves the
rows collected so far on disk. `finalize()` converts that stream into the
requested CSV/JSON output and removes the partial file.
"""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path

log = logging.getLogger("scraper.output")


class Sink:
    def __init__(
        self,
        path: str | Path,
        fmt: str,
        field_names: list[str],
        dedupe_on: list[str] | None = None,
        max_items: int = 0,
    ) -> None:
        self.path = Path(path)
        self.fmt = fmt
        self.field_names = field_names
        self.dedupe_on = dedupe_on or []
        self.max_items = max_items
        self.partial_path = self.path.with_suffix(self.path.suffix + ".partial.jsonl")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._seen: set[tuple[str, ...]] = set()
        self._count = 0
        self._skipped_dupes = 0
        self._handle = self.partial_path.open("w", encoding="utf-8")

    @property
    def count(self) -> int:
        return self._count

    @property
    def skipped_dupes(self) -> int:
        return self._skipped_dupes

    @property
    def full(self) -> bool:
        return bool(self.max_items) and self._count >= self.max_items

    def add(self, record: dict[str, str]) -> bool:
        """Append a record. Returns False if it was a duplicate or the cap is hit."""
        if self.full:
            return False
        if self.dedupe_on:
            key = tuple(record.get(k, "") for k in self.dedupe_on)
            if key in self._seen:
                self._skipped_dupes += 1
                return False
            self._seen.add(key)
        self._handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._handle.flush()
        self._count += 1
        return True

    def finalize(self) -> Path:
        self._handle.close()
        records = self._read_partial()
        columns = list(self.field_names)
        for record in records:  # keep any unexpected keys rather than dropping data
            for key in record:
                if key not in columns:
                    columns.append(key)

        if self.fmt == "csv":
            with self.path.open("w", newline="", encoding="utf-8-sig") as fh:
                writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
                writer.writeheader()
                for record in records:
                    writer.writerow({c: record.get(c, "") for c in columns})
        elif self.fmt == "json":
            self.path.write_text(
                json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        else:  # jsonl
            with self.path.open("w", encoding="utf-8") as fh:
                for record in records:
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")

        self.partial_path.unlink(missing_ok=True)
        return self.path

    def abandon(self) -> None:
        """Close the stream, keeping the partial file only if it holds records."""
        if not self._handle.closed:
            self._handle.close()
        if self._count == 0:
            self.partial_path.unlink(missing_ok=True)
            return
        log.warning("%d partial record(s) kept at %s", self._count, self.partial_path)

    def _read_partial(self) -> list[dict[str, str]]:
        records = []
        with self.partial_path.open(encoding="utf-8") as fh:
            for line_no, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    log.warning("dropping corrupt partial line %d", line_no)
        return records
