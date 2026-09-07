# scraper

A standalone, config-driven scraper for **JavaScript-rendered** pages. It drives a
real headless browser (Playwright), so it sees the DOM after the page's JS has
run — the content a plain `requests`/`curl` fetch would miss entirely.

Nothing here touches the ERP app: it's a separate Python tool that writes CSV/JSON.

## Setup

```bash
cd scraper
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m playwright install chromium
```

## Try it

```bash
./.venv/bin/python scrape.py --config configs/example.yaml
```

Scrapes 3 pages of a JS-rendered practice site into `out/quotes.csv`.

## Pointing it at a real site

**1. Find the selector for one result row.** `--inspect` loads the page, waits for
the JS, and ranks the repeated structures it finds:

```bash
./.venv/bin/python scrape.py --inspect --url "https://example.com/listings"
```

```
count  selector                    sample
   20  div.result-card             Senior Engineer · Acme Corp · Remote
   20  span.result-title           Senior Engineer
```

Pick the one whose `count` matches the number of results visible on the page.

**2. Try it ad hoc**, no config file needed:

```bash
./.venv/bin/python scrape.py \
  --url "https://example.com/listings" \
  --item ".result-card" \
  --field "title=h3" \
  --field "company=.company" \
  --field "link=a@href" \
  --wait-for ".result-card" \
  --max-items 20 \
  --out out/listings.csv
```

**3. Once it works, move it into a config** so the selectors are version-controlled
and reviewable. See [`configs/example.yaml`](configs/example.yaml) for a runnable
one and [`configs/paged-with-detail.yaml`](configs/paged-with-detail.yaml) for the
fuller shape (numbered pages + per-row detail pages).

## Field syntax

In a config, each field is `name: selector` or `name: selector@attribute`:

```yaml
fields:
  title: h3.title              # text content (default)
  link: h3 a@href              # attribute; relative URLs are auto-resolved
  price:
    selector: .price
    regex: '([\d.]+)'          # capture group 1, or the whole match if no group
    cast: float                # int | float
  tags:
    selector: a.tag
    multiple: true             # every match, not just the first
    join: ", "
  name:
    selector: .name
    required: true             # drop the row if this is empty
```

Selectors are relative to the item element. An empty selector means the item
element itself.

## Pagination

| mode | what it does | key options |
|---|---|---|
| `none` | first screen only | |
| `next_button` | clicks a "next" link until it's gone or disabled | `selector` |
| `url_template` | walks `?page=1,2,3…` | `template` (must contain `{page}`), `start_page`, `step` |
| `scroll` | infinite scroll until nothing new loads | `scroll_pause_ms`, `max_scrolls` |

All are capped by `max_pages`, and `url_template` also stops as soon as a page
returns zero items. CLI equivalents: `--next-selector`, `--url-template`,
`--scroll`.

## Timing

JS-rendered pages are the usual source of empty results — you extracted before
the content painted. Two knobs:

- `wait_for: .result-card` — block until that selector exists. **Prefer this.**
- `wait_ms: 2000` — a flat extra pause. Use when there's no reliable selector.

If a run returns 0 rows, re-run with `--headful -v` and watch what the browser
actually does.

## Output

The extension of `output` picks the format: `.csv`, `.json`, or `.jsonl`.

Every row is appended to a `.partial.jsonl` file the instant it's scraped, so an
interrupted run doesn't lose work. **Ctrl-C** finishes the current page, writes
the real output file, and exits (a second Ctrl-C aborts immediately). If the run
dies some other way, the `.partial.jsonl` is left next to the output for recovery.

`dedupe_on: [url]` drops repeats across pages — worth setting whenever pages can
overlap.

## Sites that need a login

You sign in yourself, once, in a real browser window; the scraper saves the
resulting session and reuses it. Your password is never handled by the scraper,
and this also gets you past CAPTCHAs, SSO and 2FA, because a person is doing the
logging in.

```bash
./.venv/bin/python scrape.py \
  --login "https://example.com/login" \
  --storage-state auth/example.json
```

A browser window opens. Log in as normal, then press Enter in the terminal. The
session lands in `auth/example.json`.

Reuse it with `--storage-state auth/example.json`, or put `storage_state:
auth/example.json` in a config. It works with `--inspect` too, which is how you
find selectors on a page you can only see once logged in.

**That file is credentials.** It holds live session cookies, so anyone with it can
act as you on that site. It is written `chmod 600`, and `scraper/auth/` is
gitignored — keep it that way. Sessions expire; when one does, the run stops with
exit code 4 and tells you to re-run `--login`, rather than silently writing an
empty file.

## CES Tech / Workway employee export

`workway.py` is a purpose-built exporter for `cestech.workway.pro`. The employees
page is a server-side DataTable, so it calls the JSON endpoint the page itself
uses rather than parsing rendered HTML — no selectors to break, and it returns
fields the visible table doesn't show (probation and notice-period dates, roles,
internal IDs).

```bash
# once (or whenever the session expires)
./.venv/bin/python scrape.py --login "https://cestech.workway.pro/login" \
                             --storage-state auth/cestech.json

# every time after that
./.venv/bin/python workway.py
```

Writes 21 columns to `out/cestech-employees.csv`.

Useful flags: `--status active|inactive|all`, `--department`, `--designation`,
`--role`, `--employment-type`, `--search TEXT`, `--out out/staff.json`,
`--max-records N`.

### It only exports what your account may see

Worksuite scopes the employee list by role. **A plain employee account sees
exactly one row — itself.** If the run ends with "only 1 employee returned", the
scraper is working fine and the account is the limit: re-run `--login` with an
HR or admin account and export again. Nothing about the script changes.

### robots.txt

`cestech.workway.pro/robots.txt` is `Disallow: /`, which is normal for a private
SaaS app. `workway.py` targets a single known endpoint on an account you are
logged into, so it does not consult robots.txt; the generic `scrape.py` still
does, and needs `--ignore-robots` for that host.

## Politeness and robots.txt

`robots.txt` is respected by default; a disallowed URL aborts the run with exit
code 3. `--ignore-robots` overrides this — only use it on sites you're authorised
to scrape, and check the site's terms of service first. A `Crawl-delay` in
robots.txt is honoured when it's longer than your configured `delay_ms`.

Default pacing is ~1s between page loads plus jitter (`delay_ms`, `jitter_ms`).
Images, fonts and media are blocked to cut bandwidth (`--load-images` to keep them).

## Exit codes

| code | meaning |
|---|---|
| 0 | success, at least one record |
| 1 | run failed, or completed with zero records |
| 2 | config/argument error |
| 3 | blocked by robots.txt |
| 4 | not logged in, or the saved session expired |
| 130 | interrupted; whatever was collected has been written |

## When selectors break

They will — sites redesign. Symptoms and fixes:

- **0 items matched** → the `item_selector` is stale. Re-run `--inspect`.
- **Rows appear but fields are empty** → field selectors are stale, or the field
  renders after extraction (raise `wait_ms`).
- **Only the first page scrapes** → the next-button selector changed, or the site
  switched to infinite scroll (`--scroll`).
- **Empty on a site that works in your browser** → the site is blocking headless.
  Try `--headful`, or `--browser firefox`.
- **Redirected to a login page (exit 4)** → the session expired; re-run `--login`.

## Layout

| file | role |
|---|---|
| `scrape.py` | CLI entry point, argument handling, `--inspect` |
| `config.py` | config model and YAML parsing/validation |
| `engine.py` | Playwright driving: loading, retries, pagination, detail pages |
| `extract.py` | turning a DOM element into a record |
| `output.py` | crash-resilient CSV/JSON/JSONL sink |
| `robots.py` | robots.txt fetching and caching |
| `workway.py` | CES Tech / Workway employee exporter (JSON endpoint) |
| `auth/` | saved login sessions (gitignored, credentials) |
