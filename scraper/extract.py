"""Pull field values out of a DOM element according to a FieldSpec."""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urljoin

from config import HTML, INNER_HTML, TEXT, FieldSpec

log = logging.getLogger("scraper.extract")

# Attributes whose values are URLs and so get resolved against the page URL.
URL_ATTRS = {"href", "src", "data-href", "data-src", "action", "poster"}

_WS = re.compile(r"\s+")
_NUM = re.compile(r"-?\d+(?:[.,]\d+)?")


def extract_item(scope: Any, specs: list[FieldSpec], base_url: str) -> dict[str, str]:
    """Extract one record. `scope` is an ElementHandle (or the Page for detail pages)."""
    record: dict[str, str] = {}
    for spec in specs:
        try:
            value = _extract_field(scope, spec, base_url)
        except Exception as exc:  # a broken selector must not kill the run
            log.debug("field %r failed: %s", spec.name, exc)
            value = ""
        record[spec.name] = value if value != "" else spec.default
    return record


def _extract_field(scope: Any, spec: FieldSpec, base_url: str) -> str:
    if spec.multiple:
        nodes = scope.query_selector_all(spec.selector) if spec.selector else [scope]
        values = [v for v in (_read(n, spec, base_url) for n in nodes) if v]
        raw = spec.join.join(values)
    else:
        node = scope.query_selector(spec.selector) if spec.selector else scope
        raw = _read(node, spec, base_url) if node else ""
    return _post_process(raw, spec)


def _read(node: Any, spec: FieldSpec, base_url: str) -> str:
    if node is None:
        return ""
    attr = spec.attr
    if attr == TEXT:
        value = node.inner_text() or node.text_content() or ""
    elif attr == INNER_HTML:
        value = node.inner_html() or ""
    elif attr == HTML:
        value = node.evaluate("el => el.outerHTML") or ""
    else:
        value = node.get_attribute(attr) or ""
        if value and attr in URL_ATTRS:
            value = urljoin(base_url, value)
    return value


def _post_process(raw: str, spec: FieldSpec) -> str:
    value = _WS.sub(" ", raw).strip() if spec.attr in (TEXT,) else raw.strip()
    if spec.pattern is not None:
        match = spec.pattern.search(value)
        if not match:
            return ""
        value = match.group(1) if match.groups() else match.group(0)
        value = value.strip()
    if spec.cast:
        value = _cast(value, spec.cast)
    return value


def _cast(value: str, kind: str) -> str:
    match = _NUM.search(value.replace(",", "") if value.count(",") and "." in value else value)
    if not match:
        return ""
    number = match.group(0).replace(",", ".")
    try:
        return str(int(float(number))) if kind == "int" else str(float(number))
    except ValueError:
        return ""
