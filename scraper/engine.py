"""Playwright-driven scraping engine.

Handles page loading with retries, the four pagination strategies, optional
detail-page visits, and polite delays between requests.
"""

from __future__ import annotations

import logging
import random
import time
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any

import robots
from config import SiteConfig
from extract import extract_item
from output import Sink

log = logging.getLogger("scraper.engine")


class RobotsDisallowed(RuntimeError):
    pass


class SessionExpired(RuntimeError):
    """The saved login session is no longer valid."""


@dataclass
class Stats:
    pages: int = 0
    items: int = 0
    errors: int = 0
    blocked_urls: list[str] = field(default_factory=list)


class Scraper:
    def __init__(self, config: SiteConfig, sink: Sink) -> None:
        self.config = config
        self.sink = sink
        self.stats = Stats()
        self._last_request_at = 0.0
        self._stop_requested = False

    def request_stop(self) -> None:
        """Ask the run to wind down at the next safe point.

        Raising KeyboardInterrupt straight through Playwright's sync driver
        wedges it, so a Ctrl-C sets this flag instead and the crawl loops return
        normally, letting the browser close cleanly.
        """
        self._stop_requested = True

    @property
    def stopped(self) -> bool:
        return self._stop_requested

    # ------------------------------------------------------------------ run

    def run(self) -> Stats:
        from playwright.sync_api import sync_playwright

        cfg = self.config
        with sync_playwright() as pw:
            browser_type = getattr(pw, cfg.browser)
            browser = browser_type.launch(headless=cfg.headless)
            context_args = {
                "user_agent": cfg.user_agent,
                "viewport": cfg.viewport,
                "ignore_https_errors": False,
            }
            if cfg.storage_state:
                state_path = Path(cfg.storage_state)
                if not state_path.exists():
                    raise SessionExpired(
                        f"no saved session at {state_path}. Create one with:\n"
                        f"  python scrape.py --login <login-url> --storage-state {state_path}"
                    )
                context_args["storage_state"] = str(state_path)
                log.info("using saved session %s", state_path)
            context = browser.new_context(**context_args)
            context.set_default_timeout(cfg.timeout_ms)
            if cfg.block_resources:
                context.route("**/*", self._make_blocker(set(cfg.block_resources)))
            page = context.new_page()
            try:
                for url in cfg.start_urls:
                    if self.sink.full or self._stop_requested:
                        break
                    self._crawl(context, page, url)
            finally:
                context.close()
                browser.close()
        return self.stats

    def _make_blocker(self, blocked: set[str]):
        def handler(route, request):
            if request.resource_type in blocked:
                route.abort()
            else:
                route.continue_()

        return handler

    # ------------------------------------------------------------- crawling

    def _crawl(self, context: Any, page: Any, url: str) -> None:
        mode = self.config.pagination.mode
        if mode == "url_template":
            self._crawl_url_template(context, page, url)
        elif mode == "next_button":
            self._crawl_next_button(context, page, url)
        elif mode == "scroll":
            self._crawl_scroll(context, page, url)
        else:
            if self._load(page, url):
                self._harvest(context, page)

    def _crawl_url_template(self, context: Any, page: Any, base_url: str) -> None:
        pg = self.config.pagination
        page_no = pg.start_page
        for _ in range(max(pg.max_pages, 1)):
            if self.sink.full or self._stop_requested:
                return
            url = pg.template.format(page=page_no)
            if url.startswith("/"):
                from urllib.parse import urljoin

                url = urljoin(base_url, url)
            if not self._load(page, url):
                return
            matched = self._harvest(context, page)
            if matched == 0 and not self._stop_requested:
                log.info("no items on page %d; stopping pagination", page_no)
                return
            page_no += pg.step

    def _crawl_next_button(self, context: Any, page: Any, url: str) -> None:
        pg = self.config.pagination
        if not self._load(page, url):
            return
        for page_index in range(max(pg.max_pages, 1)):
            if self.sink.full or self._stop_requested:
                return
            self._harvest(context, page)
            if page_index == pg.max_pages - 1:
                return
            if not self._click_next(page, pg.selector):
                log.info("no further pages after page %d", page_index + 1)
                return

    def _click_next(self, page: Any, selector: str) -> bool:
        button = page.query_selector(selector)
        if button is None or not button.is_visible() or not button.is_enabled():
            return False
        if (button.get_attribute("aria-disabled") or "").lower() == "true":
            return False
        classes = (button.get_attribute("class") or "").lower()
        if "disabled" in classes:
            return False

        before_url = page.url
        first_item = self._first_item_signature(page)
        self._respect_delay(before_url)
        try:
            button.click()
        except Exception as exc:
            log.warning("clicking next failed: %s", exc)
            return False

        # The click either navigates or swaps content in place; wait for whichever.
        try:
            page.wait_for_load_state("networkidle", timeout=self.config.timeout_ms)
        except Exception:
            pass
        self._settle(page)
        if page.url == before_url and self._first_item_signature(page) == first_item:
            log.info("page content did not change after clicking next; stopping")
            return False
        self.stats.pages += 1
        return True

    def _first_item_signature(self, page: Any) -> str:
        node = page.query_selector(self.config.item_selector)
        if node is None:
            return ""
        try:
            return (node.inner_text() or "")[:200]
        except Exception:
            return ""

    def _crawl_scroll(self, context: Any, page: Any, url: str) -> None:
        pg = self.config.pagination
        if not self._load(page, url):
            return
        previous = 0
        for scroll_no in range(max(pg.max_scrolls, 1)):
            count = len(page.query_selector_all(self.config.item_selector))
            if self._stop_requested:
                break
            if self.config.max_items and count >= self.config.max_items:
                break
            if count == previous and scroll_no > 0:
                log.info("scroll %d added nothing new; stopping", scroll_no)
                break
            previous = count
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(pg.scroll_pause_ms)
        self._harvest(context, page)

    # ----------------------------------------------------------- extraction

    def _harvest(self, context: Any, page: Any) -> int:
        """Extract every item on the current page. Returns the number of elements
        that *matched* -- not the number stored -- so that pagination stops on a
        genuinely empty page rather than on a page of duplicates."""
        cfg = self.config
        elements = page.query_selector_all(cfg.item_selector)
        log.info("%d item(s) matched on %s", len(elements), page.url)
        added = 0
        for element in elements:
            if self.sink.full or self._stop_requested:
                break
            record = extract_item(element, cfg.fields, page.url)
            if not self._required_ok(record):
                continue
            if cfg.detail:
                record.update(self._scrape_detail(context, record))
            if self.sink.add(record):
                added += 1
        self.stats.items = self.sink.count
        log.debug("stored %d of %d matched item(s)", added, len(elements))
        return len(elements)

    def _required_ok(self, record: dict[str, str]) -> bool:
        for spec in self.config.fields:
            if spec.required and not record.get(spec.name):
                log.debug("dropping item: required field %r empty", spec.name)
                return False
        return True

    def _scrape_detail(self, context: Any, record: dict[str, str]) -> dict[str, str]:
        detail = self.config.detail
        link = record.get(detail.link_field, "")
        empty = {spec.name: spec.default for spec in detail.fields}
        if not link.startswith(("http://", "https://")):
            return empty
        if self.config.obey_robots and not robots.allowed(link, self.config.user_agent):
            log.warning("robots.txt disallows detail page %s; skipping", link)
            return empty

        detail_page = context.new_page()
        try:
            self._respect_delay(link)
            detail_page.goto(link, wait_until=self.config.wait_until, timeout=self.config.timeout_ms)
            if detail.wait_for:
                detail_page.wait_for_selector(detail.wait_for, timeout=self.config.timeout_ms)
            if detail.wait_ms:
                detail_page.wait_for_timeout(detail.wait_ms)
            return extract_item(detail_page, detail.fields, detail_page.url)
        except Exception as exc:
            log.warning("detail page %s failed: %s", link, exc)
            self.stats.errors += 1
            return empty
        finally:
            detail_page.close()

    # ------------------------------------------------------------- loading

    def _load(self, page: Any, url: str) -> bool:
        cfg = self.config
        if cfg.obey_robots and not robots.allowed(url, cfg.user_agent):
            self.stats.blocked_urls.append(url)
            raise RobotsDisallowed(
                f"robots.txt disallows {url}. Re-run with --ignore-robots only if you "
                f"are authorised to scrape this site."
            )

        for attempt in range(1, cfg.retries + 1):
            if self._stop_requested:
                return False
            self._respect_delay(url)
            try:
                page.goto(url, wait_until=cfg.wait_until, timeout=cfg.timeout_ms)
                self._check_session(url, page.url)
                if cfg.wait_for:
                    page.wait_for_selector(cfg.wait_for, timeout=cfg.timeout_ms)
                self._settle(page)
                self.stats.pages += 1
                return True
            except SessionExpired:
                raise
            except Exception as exc:
                self.stats.errors += 1
                if attempt == cfg.retries:
                    log.error("giving up on %s after %d attempts: %s", url, attempt, exc)
                    return False
                backoff = min(2 ** attempt, 30)
                log.warning("attempt %d/%d failed for %s (%s); retrying in %ss",
                            attempt, cfg.retries, url, exc, backoff)
                self._sleep(backoff)
        return False

    def _check_session(self, requested: str, landed: str) -> None:
        """Raise if the app bounced us to a login page. Retrying cannot fix this,
        so it fails loudly rather than burning attempts and writing an empty file."""
        if requested == landed:
            return
        hints = ("/login", "/signin", "/sign-in", "/auth/login", "/users/sign_in")
        if any(h in landed.lower() for h in hints) and not any(
            h in requested.lower() for h in hints
        ):
            detail = (
                f"redirected to {landed}. The saved session has expired -- refresh it with:\n"
                f"  python scrape.py --login {landed} --storage-state {self.config.storage_state}"
                if self.config.storage_state
                else f"redirected to {landed}. This page needs a login; create a session with:\n"
                     f"  python scrape.py --login {landed} --storage-state auth/session.json"
            )
            raise SessionExpired(detail)

    def _settle(self, page: Any) -> None:
        if self.config.wait_ms:
            page.wait_for_timeout(self.config.wait_ms)

    def _respect_delay(self, url: str) -> None:
        cfg = self.config
        delay = cfg.delay_ms / 1000.0
        if cfg.obey_robots:
            robots_delay = robots.crawl_delay(url, cfg.user_agent)
            if robots_delay:
                delay = max(delay, robots_delay)
        if cfg.jitter_ms:
            delay += random.uniform(0, cfg.jitter_ms / 1000.0)
        elapsed = time.monotonic() - self._last_request_at
        remaining = delay - elapsed
        if remaining > 0 and self._last_request_at:
            self._sleep(remaining)
        self._last_request_at = time.monotonic()

    def _sleep(self, seconds: float) -> None:
        """Sleep in short slices so a stop request is noticed promptly."""
        deadline = time.monotonic() + seconds
        while not self._stop_requested:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(remaining, 0.25))
