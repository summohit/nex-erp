#!/usr/bin/env python3
"""Config-driven scraper for JavaScript-rendered pages.

    # from a config file
    python scraper/scrape.py --config scraper/configs/example.yaml

    # ad hoc, no config file
    python scraper/scrape.py --url https://example.com/jobs \
        --item ".job-card" \
        --field "title=h2" --field "company=.company" --field "link=a@href" \
        --scroll --out out/jobs.csv

    # find a plausible --item selector on a page
    python scraper/scrape.py --inspect --url https://example.com/jobs
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import ConfigError, FieldSpec, Pagination, SiteConfig, _split_selector, load_config
from engine import RobotsDisallowed, SessionExpired, Scraper
from output import Sink

log = logging.getLogger("scraper")

INSPECT_JS = """
() => {
  const map = new Map();
  for (const el of document.querySelectorAll('body *')) {
    const raw = typeof el.className === 'string' ? el.className.trim() : '';
    if (!raw) continue;
    const cls = raw.split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
    if (!cls) continue;
    const key = el.tagName.toLowerCase() + '.' + cls;
    const text = (el.innerText || '').trim();
    const entry = map.get(key) || { count: 0, sample: '', textLen: 0 };
    entry.count += 1;
    entry.textLen = Math.max(entry.textLen, text.length);
    if (!entry.sample && text) entry.sample = text.replace(/\\s+/g, ' ').slice(0, 90);
    map.set(key, entry);
  }
  return [...map.entries()]
    .filter(([, v]) => v.count >= 2 && v.textLen > 15)
    .map(([selector, v]) => ({
      selector,
      count: v.count,
      sample: v.sample,
      score: v.count * Math.min(v.textLen, 400),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
"""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scrape.py",
        description="Scrape a JavaScript-rendered site into CSV/JSON.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--config", help="YAML config file describing the site")

    adhoc = p.add_argument_group("ad-hoc mode (instead of --config)")
    adhoc.add_argument("--url", action="append", dest="urls", help="start URL (repeatable)")
    adhoc.add_argument("--item", help="CSS selector matching one result row/card")
    adhoc.add_argument(
        "--field",
        action="append",
        dest="fields",
        metavar="NAME=SELECTOR[@ATTR]",
        help="field to extract, e.g. 'link=a.title@href' (repeatable)",
    )

    pag = p.add_argument_group("pagination")
    pag.add_argument("--next-selector", help="click this selector to go to the next page")
    pag.add_argument("--url-template", help="paged URL containing {page}")
    pag.add_argument("--scroll", action="store_true", help="infinite scroll")
    pag.add_argument("--max-pages", type=int, help="page/scroll limit")
    pag.add_argument("--start-page", type=int, help="first page number for --url-template")

    out = p.add_argument_group("output")
    out.add_argument("--out", help="output path; .csv, .json or .jsonl")
    out.add_argument("--format", choices=["csv", "json", "jsonl"], help="override output format")
    out.add_argument("--max-items", type=int, help="stop after N records")
    out.add_argument("--dedupe", help="comma-separated field names forming a unique key")

    beh = p.add_argument_group("behaviour")
    beh.add_argument("--wait-for", help="CSS selector to wait for before extracting")
    beh.add_argument("--wait-ms", type=int, help="extra settle time after load")
    beh.add_argument("--delay-ms", type=int, help="delay between page loads")
    beh.add_argument("--timeout-ms", type=int, help="navigation/selector timeout")
    beh.add_argument("--retries", type=int, help="attempts per page load")
    beh.add_argument("--browser", choices=["chromium", "firefox", "webkit"])
    beh.add_argument("--headful", action="store_true", help="show the browser window")
    beh.add_argument(
        "--ignore-robots",
        action="store_true",
        help="scrape even when robots.txt disallows it (only for sites you may scrape)",
    )
    beh.add_argument("--load-images", action="store_true", help="do not block images/fonts/media")

    auth = p.add_argument_group("authentication")
    auth.add_argument(
        "--login",
        metavar="LOGIN_URL",
        help="open a real browser window at LOGIN_URL so you can sign in by hand, "
             "then save the session to --storage-state and exit",
    )
    auth.add_argument(
        "--storage-state",
        metavar="PATH",
        help="session file to save (--login) or reuse (scraping). Contains live "
             "session cookies -- treat it like a password and keep it out of git.",
    )

    p.add_argument("--inspect", action="store_true",
                   help="print candidate item selectors for --url and exit")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def config_from_args(args: argparse.Namespace) -> SiteConfig:
    if args.config:
        cfg = load_config(args.config)
        if args.urls:
            cfg.start_urls = args.urls
        if args.item:
            cfg.item_selector = args.item
        if args.fields:
            cfg.fields = parse_field_args(args.fields)
    else:
        missing = [n for n, v in (("--url", args.urls), ("--item", args.item),
                                  ("--field", args.fields)) if not v]
        if missing:
            raise ConfigError(
                f"without --config you must pass {', '.join(missing)} "
                f"(or use --inspect to explore the page first)"
            )
        cfg = SiteConfig(
            name="adhoc",
            start_urls=args.urls,
            item_selector=args.item,
            fields=parse_field_args(args.fields),
            output=args.out or "out/adhoc.csv",
        )

    apply_overrides(cfg, args)
    return cfg


def apply_overrides(cfg: SiteConfig, args: argparse.Namespace) -> None:
    if args.scroll:
        cfg.pagination = Pagination(mode="scroll", max_scrolls=args.max_pages or 50)
    elif args.next_selector:
        cfg.pagination = Pagination(mode="next_button", selector=args.next_selector,
                                    max_pages=args.max_pages or 10)
    elif args.url_template:
        cfg.pagination = Pagination(mode="url_template", template=args.url_template,
                                    max_pages=args.max_pages or 10,
                                    start_page=args.start_page or 1)
    else:
        if args.max_pages is not None:
            cfg.pagination.max_pages = args.max_pages
            cfg.pagination.max_scrolls = args.max_pages
        if args.start_page is not None:
            cfg.pagination.start_page = args.start_page

    for attr, value in (
        ("wait_for", args.wait_for),
        ("wait_ms", args.wait_ms),
        ("delay_ms", args.delay_ms),
        ("timeout_ms", args.timeout_ms),
        ("retries", args.retries),
        ("browser", args.browser),
        ("max_items", args.max_items),
    ):
        if value is not None:
            setattr(cfg, attr, value)

    if args.storage_state:
        cfg.storage_state = args.storage_state
    if args.headful:
        cfg.headless = False
    if args.ignore_robots:
        cfg.obey_robots = False
    if args.load_images:
        cfg.block_resources = []
    if args.dedupe:
        cfg.dedupe_on = [n.strip() for n in args.dedupe.split(",") if n.strip()]
    if args.out:
        cfg.output = args.out
        cfg.output_format = args.format or Path(args.out).suffix.lstrip(".").lower() or "csv"
    if args.format:
        cfg.output_format = args.format

    known = set(cfg.all_field_names)
    unknown = [n for n in cfg.dedupe_on if n not in known]
    if unknown:
        raise ConfigError(f"--dedupe refers to unknown fields: {unknown}")


def parse_field_args(raw_fields: list[str]) -> list[FieldSpec]:
    specs = []
    for raw in raw_fields:
        if "=" not in raw:
            raise ConfigError(f"--field '{raw}' must look like NAME=SELECTOR[@ATTR]")
        name, _, rest = raw.partition("=")
        name = name.strip()
        if not name:
            raise ConfigError(f"--field '{raw}' has an empty name")
        selector, attr = _split_selector(rest)
        specs.append(FieldSpec(name=name, selector=selector, attr=attr))
    return specs


def run_login(args: argparse.Namespace) -> int:
    """Open a visible browser, let the user sign in themselves, save the session.

    The password (and any CAPTCHA, SSO redirect or 2FA step) is handled by the
    person at the keyboard in a normal browser window; this only saves the
    resulting cookies so later runs do not have to log in again.
    """
    from playwright.sync_api import sync_playwright

    if not args.storage_state:
        log.error("--login also needs --storage-state PATH (where to save the session)")
        return 2
    state_path = Path(args.storage_state)
    state_path.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = getattr(pw, args.browser or "chromium").launch(headless=False)
        context = browser.new_context(viewport=None)
        page = context.new_page()
        page.goto(args.login, wait_until="domcontentloaded", timeout=args.timeout_ms or 60_000)

        print("\n" + "=" * 72)
        print("A browser window is open. Sign in there as you normally would.")
        print("Nothing you type in that window is visible to this script or to Claude.")
        print("When you can see the page you want to scrape, come back here.")
        print("=" * 72)
        try:
            input("Press Enter once you are logged in (or Ctrl-C to cancel)... ")
        except (KeyboardInterrupt, EOFError):
            print()
            log.warning("cancelled; no session saved")
            browser.close()
            return 130

        current = page.url
        context.storage_state(path=str(state_path))
        try:
            state_path.chmod(0o600)  # session cookies: owner-readable only
        except OSError:
            pass
        browser.close()

    log.info("session saved to %s (last page: %s)", state_path, current)
    log.info("now scrape with:  --storage-state %s   (or storage_state: %s in a config)",
             state_path, state_path)
    log.warning("that file grants access to the account -- do not commit or share it")
    return 0


def run_inspect(args: argparse.Namespace) -> int:
    from playwright.sync_api import sync_playwright

    if not args.urls:
        log.error("--inspect needs --url")
        return 2
    url = args.urls[0]
    with sync_playwright() as pw:
        browser = getattr(pw, args.browser or "chromium").launch(headless=not args.headful)
        ctx_args = {}
        if args.storage_state:
            if not Path(args.storage_state).exists():
                log.error("no saved session at %s; run --login first", args.storage_state)
                browser.close()
                return 2
            ctx_args["storage_state"] = args.storage_state
        page = browser.new_context(**ctx_args).new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=args.timeout_ms or 30_000)
        if args.wait_for:
            page.wait_for_selector(args.wait_for, timeout=args.timeout_ms or 30_000)
        page.wait_for_timeout(args.wait_ms or 2000)
        candidates = page.evaluate(INSPECT_JS)
        title = page.title()
        browser.close()

    print(f"\n{title}\n{url}\n")
    if not candidates:
        print("No repeated class-based structures found. The page may render into "
              "shadow DOM or an iframe, or need a longer --wait-ms.")
        return 1
    print(f"{'count':>5}  {'selector':<44}  sample")
    print("-" * 100)
    for c in candidates:
        print(f"{c['count']:>5}  {c['selector'][:44]:<44}  {c['sample']}")
    print("\nPick the selector whose count matches the number of results you see, "
          "then pass it as --item.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)-7s %(name)s: %(message)s",
    )

    if args.login:
        return run_login(args)

    if args.inspect:
        return run_inspect(args)

    try:
        cfg = config_from_args(args)
    except ConfigError as exc:
        log.error("%s", exc)
        return 2

    sink = Sink(cfg.output, cfg.output_format, cfg.all_field_names,
                dedupe_on=cfg.dedupe_on, max_items=cfg.max_items)
    scraper = Scraper(cfg, sink)
    install_interrupt_handler(scraper)
    try:
        stats = scraper.run()
    except RobotsDisallowed as exc:
        sink.abandon()
        log.error("%s", exc)
        return 3
    except SessionExpired as exc:
        sink.abandon()
        log.error("%s", exc)
        return 4
    except Exception as exc:
        sink.abandon()
        log.error("run failed: %s", exc)
        return 1

    path = sink.finalize()
    log.info(
        "%s: %d record(s) from %d page(s), %d duplicate(s) skipped, %d error(s) -> %s",
        "stopped early" if scraper.stopped else "done",
        sink.count, stats.pages, sink.skipped_dupes, stats.errors, path,
    )
    if scraper.stopped:
        return 130
    return 0 if sink.count else 1


def install_interrupt_handler(scraper: Scraper) -> None:
    """Turn the first Ctrl-C into a clean wind-down, the second into a hard exit.

    Letting KeyboardInterrupt unwind through Playwright's sync driver leaves it
    wedged and the browser never closes, so the first signal only sets a flag.
    """

    def handler(signum, frame):
        if scraper.stopped:  # second Ctrl-C: stop being polite about it
            signal.signal(signal.SIGINT, signal.SIG_DFL)
            log.warning("second interrupt; exiting immediately")
            raise KeyboardInterrupt
        log.warning("interrupt received; finishing current page and saving results "
                    "(Ctrl-C again to abort)")
        scraper.request_stop()

    try:
        signal.signal(signal.SIGINT, handler)
    except ValueError:  # not on the main thread; leave default behaviour
        log.debug("could not install SIGINT handler")


if __name__ == "__main__":
    raise SystemExit(main())
