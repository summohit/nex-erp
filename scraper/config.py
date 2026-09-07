"""Configuration model for the scraper.

A run is described either by a YAML file (`--config`) or by ad-hoc CLI flags.
Both paths produce a `SiteConfig`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

TEXT = "text"
HTML = "html"
INNER_HTML = "inner_html"


class ConfigError(ValueError):
    """Raised when a config file is structurally invalid."""


@dataclass
class FieldSpec:
    """How to pull one value out of an item element.

    selector: CSS selector, relative to the item element. Empty means the item
              element itself.
    attr:     "text" (default), "html", "inner_html", or an attribute name such
              as "href" / "src" / "data-id".
    regex:    optional pattern; when it has a capture group, group(1) is kept,
              otherwise the whole match.
    multiple: collect every match instead of the first, joined by `join`.
    required: drop the whole item when this field comes out empty.
    """

    name: str
    selector: str = ""
    attr: str = TEXT
    regex: str | None = None
    default: str = ""
    multiple: bool = False
    join: str = " | "
    required: bool = False
    cast: str | None = None  # "int" | "float" | None

    def __post_init__(self) -> None:
        if self.regex is not None:
            try:
                self._pattern = re.compile(self.regex)
            except re.error as exc:  # pragma: no cover - config-time failure
                raise ConfigError(f"field '{self.name}': bad regex: {exc}") from exc
        else:
            self._pattern = None
        if self.cast not in (None, "int", "float"):
            raise ConfigError(f"field '{self.name}': cast must be int, float or omitted")

    @property
    def pattern(self) -> re.Pattern[str] | None:
        return self._pattern

    @classmethod
    def from_dict(cls, name: str, raw: Any) -> "FieldSpec":
        # Shorthand: `title: h2.name@href`
        if isinstance(raw, str):
            selector, attr = _split_selector(raw)
            return cls(name=name, selector=selector, attr=attr)
        if not isinstance(raw, dict):
            raise ConfigError(f"field '{name}': expected a string or a mapping")
        raw = dict(raw)
        if "selector" in raw and "@" in str(raw["selector"]) and "attr" not in raw:
            raw["selector"], raw["attr"] = _split_selector(str(raw["selector"]))
        unknown = set(raw) - {f.name for f in field_names(cls)}
        if unknown:
            raise ConfigError(f"field '{name}': unknown keys {sorted(unknown)}")
        return cls(name=name, **raw)


def field_names(cls):  # small helper so FieldSpec.from_dict can validate keys
    from dataclasses import fields as _fields

    return [f for f in _fields(cls) if f.name != "name"]


def _split_selector(raw: str) -> tuple[str, str]:
    """`a.title@href` -> ("a.title", "href"); `h2` -> ("h2", "text")."""
    if "@" not in raw:
        return raw.strip(), TEXT
    selector, _, attr = raw.rpartition("@")
    return selector.strip(), (attr.strip() or TEXT)


@dataclass
class Pagination:
    """How to advance past the first screen of results.

    mode:
      none         - single page only
      next_button  - click `selector` until it disappears or is disabled
      url_template - format `template` with {page}, walking start..start+max_pages
      scroll       - infinite scroll: scroll to the bottom until nothing new loads
    """

    mode: str = "none"
    selector: str = ""
    template: str = ""
    start_page: int = 1
    step: int = 1
    max_pages: int = 1
    scroll_pause_ms: int = 1200
    max_scrolls: int = 50

    def __post_init__(self) -> None:
        allowed = {"none", "next_button", "url_template", "scroll"}
        if self.mode not in allowed:
            raise ConfigError(f"pagination.mode must be one of {sorted(allowed)}")
        if self.mode == "next_button" and not self.selector:
            raise ConfigError("pagination.mode 'next_button' needs a selector")
        if self.mode == "url_template":
            if not self.template:
                raise ConfigError("pagination.mode 'url_template' needs a template")
            if "{page}" not in self.template:
                raise ConfigError("pagination.template must contain '{page}'")


@dataclass
class DetailSpec:
    """Optionally open each item's link and pull more fields from that page."""

    link_field: str
    fields: list[FieldSpec] = field(default_factory=list)
    wait_for: str = ""
    wait_ms: int = 0


@dataclass
class SiteConfig:
    name: str = "scrape"
    start_urls: list[str] = field(default_factory=list)
    item_selector: str = ""
    fields: list[FieldSpec] = field(default_factory=list)
    pagination: Pagination = field(default_factory=Pagination)
    detail: DetailSpec | None = None

    # Page loading
    wait_for: str = ""            # CSS selector to wait for before extracting
    wait_ms: int = 0              # extra settle time after load, milliseconds
    timeout_ms: int = 30_000
    wait_until: str = "domcontentloaded"

    # Politeness / robustness
    delay_ms: int = 1000          # pause between page loads
    jitter_ms: int = 500          # random extra delay, 0..jitter
    retries: int = 3
    max_items: int = 0            # 0 = unlimited
    dedupe_on: list[str] = field(default_factory=list)

    # Browser
    headless: bool = True
    browser: str = "chromium"
    user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
    viewport: dict[str, int] = field(default_factory=lambda: {"width": 1366, "height": 900})
    block_resources: list[str] = field(default_factory=lambda: ["image", "media", "font"])
    obey_robots: bool = True

    # Authentication: a Playwright storage_state JSON saved by `--login`.
    # Holds live session cookies, so it is secrets material -- keep it out of git.
    storage_state: str = ""

    # Output
    output: str = ""              # path; extension picks the format
    output_format: str = ""       # csv | json | jsonl; inferred from `output`

    def __post_init__(self) -> None:
        if not self.start_urls:
            raise ConfigError("start_urls must contain at least one URL")
        if not self.item_selector:
            raise ConfigError("item_selector is required")
        if not self.fields:
            raise ConfigError("at least one field is required")
        if self.browser not in {"chromium", "firefox", "webkit"}:
            raise ConfigError("browser must be chromium, firefox or webkit")
        names = [f.name for f in self.fields]
        dupes = {n for n in names if names.count(n) > 1}
        if dupes:
            raise ConfigError(f"duplicate field names: {sorted(dupes)}")
        if self.detail and self.detail.link_field not in names:
            raise ConfigError(
                f"detail.link_field '{self.detail.link_field}' is not one of the fields"
            )
        unknown_keys = set(self.dedupe_on) - set(names) - {
            f.name for f in (self.detail.fields if self.detail else [])
        }
        if unknown_keys:
            raise ConfigError(f"dedupe_on refers to unknown fields: {sorted(unknown_keys)}")
        if not self.output:
            self.output = f"out/{self.name}.csv"
        if not self.output_format:
            self.output_format = Path(self.output).suffix.lstrip(".").lower() or "csv"
        if self.output_format not in {"csv", "json", "jsonl"}:
            raise ConfigError("output format must be csv, json or jsonl")

    @property
    def all_field_names(self) -> list[str]:
        names = [f.name for f in self.fields]
        if self.detail:
            names += [f.name for f in self.detail.fields if f.name not in names]
        return names


def load_config(path: str | Path) -> SiteConfig:
    path = Path(path)
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path}: invalid YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path}: top level must be a mapping")

    raw.setdefault("name", path.stem)
    if "url" in raw and "start_urls" not in raw:
        raw["start_urls"] = [raw.pop("url")]
    if isinstance(raw.get("start_urls"), str):
        raw["start_urls"] = [raw["start_urls"]]

    raw["fields"] = _parse_fields(raw.get("fields"), where="fields")

    if "pagination" in raw and raw["pagination"] is not None:
        pg = raw["pagination"]
        if not isinstance(pg, dict):
            raise ConfigError("pagination must be a mapping")
        raw["pagination"] = Pagination(**pg)

    if raw.get("detail"):
        det = raw["detail"]
        if not isinstance(det, dict) or "link_field" not in det:
            raise ConfigError("detail must be a mapping with a link_field")
        det = dict(det)
        det["fields"] = _parse_fields(det.get("fields"), where="detail.fields")
        raw["detail"] = DetailSpec(**det)

    known = {f.name for f in _dataclass_fields(SiteConfig)}
    unknown = set(raw) - known
    if unknown:
        raise ConfigError(f"{path}: unknown top-level keys {sorted(unknown)}")
    return SiteConfig(**raw)


def _parse_fields(raw: Any, where: str) -> list[FieldSpec]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [FieldSpec.from_dict(name, spec) for name, spec in raw.items()]
    if isinstance(raw, list):
        out = []
        for entry in raw:
            if not isinstance(entry, dict) or "name" not in entry:
                raise ConfigError(f"{where}: list entries need a 'name' key")
            entry = dict(entry)
            out.append(FieldSpec.from_dict(entry.pop("name"), entry))
        return out
    raise ConfigError(f"{where}: expected a mapping or a list")


def _dataclass_fields(cls):
    from dataclasses import fields as _fields

    return _fields(cls)
