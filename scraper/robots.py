"""robots.txt checking.

Checked once per host and cached. A host that does not serve a robots.txt (or
serves an error) is treated as allowed, which matches how crawlers normally
behave.
"""

from __future__ import annotations

import logging
import urllib.error
import urllib.request
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

log = logging.getLogger("scraper.robots")

_cache: dict[str, RobotFileParser | None] = {}


def allowed(url: str, user_agent: str, timeout: float = 10.0) -> bool:
    parser = _parser_for(url, timeout)
    if parser is None:
        return True
    return parser.can_fetch(user_agent, url)


def crawl_delay(url: str, user_agent: str) -> float | None:
    parser = _cache.get(_origin(url))
    if parser is None:
        return None
    try:
        delay = parser.crawl_delay(user_agent)
    except Exception:
        return None
    return float(delay) if delay is not None else None


def _origin(url: str) -> str:
    parts = urlparse(url)
    return f"{parts.scheme}://{parts.netloc}"


def _parser_for(url: str, timeout: float) -> RobotFileParser | None:
    origin = _origin(url)
    if origin in _cache:
        return _cache[origin]

    robots_url = f"{origin}/robots.txt"
    parser = RobotFileParser()
    parser.set_url(robots_url)
    try:
        request = urllib.request.Request(robots_url, headers={"User-Agent": "python-robotparser"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
        parser.parse(body.splitlines())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
        log.debug("no usable robots.txt at %s (%s); treating as allowed", robots_url, exc)
        _cache[origin] = None
        return None
    _cache[origin] = parser
    return parser
