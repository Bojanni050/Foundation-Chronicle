#!/usr/bin/env python3
"""
Bulk-imports every ChatGPT conversation into Chronicle by driving a real,
logged-in browser session with Playwright. The browser extension only
handles one open chat at a time via a manual click; this walks the whole
sidebar history and imports everything in one run.

First run opens a visible browser so you can log into chatgpt.com once —
the session is cached in a local profile directory (.chatgpt_profile/, not
committed) and reused on later runs, so you only log in once.

Usage:
    python bulk_import.py --limit 3          # test run first, recommended
    python bulk_import.py                    # import everything

    python bulk_import.py --token <token> --api-url http://127.0.0.1:4577

If --token is omitted, it's read from server/data/token.txt in the repo —
the same token the browser extension uses (Settings in the Chronicle app).

Re-running is safe: already-imported conversation URLs are tracked in
imported.json (also not committed) and skipped on subsequent runs.
"""

import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from markdownify import markdownify as md

ROOT = Path(__file__).resolve().parents[2]  # repo root
PROFILE_DIR = Path(__file__).resolve().parent / ".chatgpt_profile"
STATE_FILE = Path(__file__).resolve().parent / "imported.json"
DEFAULT_TOKEN_FILE = ROOT / "server" / "data" / "token.txt"

# Sunday-first, matching JS Date.getDay() — keep in sync with
# extension/popup.js's parseRelativeDateLabel (same ChatGPT timestamp format).
WEEKDAYS_NL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"]
WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
MONTHS_NL = ["januari", "februari", "maart", "april", "mei", "juni", "juli",
             "augustus", "september", "oktober", "november", "december"]


def parse_relative_date_label(label, now=None):
    """Turns ChatGPT's relative timestamp label ('maandag 16:05', 'Gisteren
    16:05', 'Vandaag 16:05', a full date, ...) into an absolute datetime.
    Mirrors extension/popup.js's parseRelativeDateLabel — keep both in sync
    if ChatGPT's label format changes."""
    if not label:
        return None
    now = now or datetime.now()
    text = label.strip().lower()

    time_match = re.search(r"(\d{1,2}):(\d{2})", text)
    hours, minutes = (int(time_match.group(1)), int(time_match.group(2))) if time_match else (None, None)

    def with_time(d):
        if hours is not None:
            return d.replace(hour=hours, minute=minutes, second=0, microsecond=0)
        return d

    if re.match(r"^(vandaag|today)\b", text):
        return with_time(now)
    if re.match(r"^(gisteren|yesterday)\b", text):
        return with_time(now - timedelta(days=1))

    for idx, (nl, en) in enumerate(zip(WEEKDAYS_NL, WEEKDAYS_EN)):
        if text.startswith(nl) or text.startswith(en):
            # Python's now.weekday(): Monday=0..Sunday=6 — realign to the
            # Sunday=0..Saturday=6 indexing used by WEEKDAYS_NL/EN above.
            py_dow = (now.weekday() + 1) % 7
            diff = (py_dow - idx) % 7  # days since the most recent occurrence, 0 = today
            return with_time(now - timedelta(days=diff))

    m = re.search(r"(\d{1,2})\s+([a-zé]+)\.?\s*(\d{4})?", text)
    if m:
        day = int(m.group(1))
        month_idx = next((i for i, mm in enumerate(MONTHS_NL) if mm.startswith(m.group(2))), None)
        if month_idx is not None:
            year = int(m.group(3)) if m.group(3) else now.year
            return with_time(datetime(year, month_idx + 1, day))

    for fmt in ("%Y-%m-%dT%H:%M:%S", "%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(label.strip(), fmt)
        except ValueError:
            continue
    return None


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"imported_urls": []}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2), encoding="utf-8")


def post_import(api_url, token, payload):
    req = urllib.request.Request(
        f"{api_url}/api/objects/import",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode("utf-8", "ignore")}
    except urllib.error.URLError as e:
        return 0, {"error": str(e)}


def collect_conversation_links(page, limit=None):
    """Scrolls the sidebar history list to load every conversation link.
    Selector is anchored on ChatGPT's URL pattern (/c/<uuid>) rather than a
    classname, since that's the part of the DOM least likely to change."""
    page.wait_for_selector('a[href^="/c/"]', timeout=20000)
    seen = {}
    stable_rounds = 0
    for _ in range(300):
        for a in page.query_selector_all('a[href^="/c/"]'):
            href = a.get_attribute("href")
            if href and href not in seen:
                seen[href] = (a.inner_text() or "").strip()
        before = len(seen)
        if limit and len(seen) >= limit:
            break
        page.mouse.wheel(0, 2000)
        page.wait_for_timeout(400)
        stable_rounds = stable_rounds + 1 if len(seen) == before else 0
        if stable_rounds >= 4:
            break
    items = list(seen.items())
    return items[:limit] if limit else items


def extract_occurred_at(page):
    """Hovers the last message to reveal ChatGPT's relative-timestamp
    tooltip and parses it. This is a *real* hover (Playwright drives an
    actual browser), unlike the browser extension which can only guess at
    a static DOM attribute — so this is the more reliable of the two."""
    try:
        messages = page.query_selector_all("[data-message-author-role]")
        if not messages:
            return None
        last = messages[-1]
        last.scroll_into_view_if_needed()
        last.hover()
        page.wait_for_timeout(300)
        label = None
        tooltip = page.query_selector('[role="tooltip"]')
        if tooltip:
            label = tooltip.inner_text()
        if not label:
            for el in last.query_selector_all("[title], [aria-label]"):
                val = el.get_attribute("title") or el.get_attribute("aria-label")
                if val and re.search(r"\d{1,2}:\d{2}", val):
                    label = val
                    break
        if not label:
            return None
        dt = parse_relative_date_label(label)
        return dt.isoformat() if dt else None
    except Exception:
        return None


def collect_turns(page):
    """Scrolls the whole conversation top -> bottom, collecting every
    message in chronological order. Mirrors extension/popup.js's
    collectAllTurns: same virtualization problem (long chats unmount
    off-screen messages), same fix (walk top to bottom, merge by content,
    terminate purely on reaching the bottom — never on "no new turns this
    round", since one long message can span several steps with nothing new
    to report in between)."""
    handle = page.evaluate_handle(
        """() => {
            const anyMsg = document.querySelector('[data-message-author-role]');
            let el = anyMsg && anyMsg.parentElement;
            while (el) {
                const style = getComputedStyle(el);
                if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
                    return el;
                }
                el = el.parentElement;
            }
            return document.scrollingElement;
        }"""
    )

    def snapshot():
        return page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-message-author-role]')).map(n => ({
                role: n.getAttribute('data-message-author-role') === 'assistant' ? 'assistant' : 'user',
                html: n.innerHTML,
            }))"""
        )

    last_height = -1
    for _ in range(60):
        page.evaluate("(el) => { el.scrollTop = 0; }", handle)
        page.wait_for_timeout(350)
        height = page.evaluate("(el) => el.scrollHeight", handle)
        if height == last_height:
            break
        last_height = height

    seen = set()
    merged = []

    def merge_in(items):
        for item in items:
            key = item["role"] + "::" + item["html"]
            if key not in seen:
                seen.add(key)
                merged.append(item)

    page.evaluate("(el) => { el.scrollTop = 0; }", handle)
    page.wait_for_timeout(200)
    merge_in(snapshot())

    for _ in range(500):
        at_bottom = page.evaluate(
            "(el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4", handle
        )
        if at_bottom:
            merge_in(snapshot())
            break
        page.evaluate(
            "(el) => { el.scrollTop = Math.min(el.scrollTop + el.clientHeight * 0.5, el.scrollHeight); }",
            handle,
        )
        page.wait_for_timeout(280)
        merge_in(snapshot())

    turns = []
    for item in merged:
        text = md(item["html"], heading_style="ATX", bullets="-").strip()
        if text:
            turns.append({"role": item["role"], "text": text})
    return turns


def format_turns(turns):
    return "\n\n".join(f"{'A' if t['role'] == 'assistant' else 'H'}: {t['text']}" for t in turns)


def import_conversation(page, url, title_hint, api_url, token):
    page.goto(url, wait_until="domcontentloaded")
    try:
        page.wait_for_selector("[data-message-author-role]", timeout=15000)
    except PWTimeout:
        print(f"  ! no messages found, skipping: {url}")
        return False

    occurred_at = extract_occurred_at(page)
    turns = collect_turns(page)
    if not turns:
        print(f"  ! no turns extracted, skipping: {url}")
        return False

    content = format_turns(turns)
    title = next((t["text"][:80] for t in turns if t["role"] == "user"), title_hint or page.title())

    payload = {
        "title": title,
        "content": content,
        "turns": turns,
        "sourceProvider": "chatgpt",
        "url": url,
        "occurredAt": occurred_at,
    }
    status, body = post_import(api_url, token, payload)
    if status == 201:
        print(f"  -> imported {len(turns)} turns (occurredAt={occurred_at})")
        return True
    print(f"  ! import failed ({status}): {body}")
    return False


def main():
    parser = argparse.ArgumentParser(description="Bulk-import ChatGPT conversation history into Chronicle.")
    parser.add_argument("--api-url", default="http://127.0.0.1:4577")
    parser.add_argument("--token", default=None, help="Chronicle API token (defaults to server/data/token.txt)")
    parser.add_argument("--limit", type=int, default=None, help="Only import the N most recent conversations")
    parser.add_argument("--headless", action="store_true", help="Run without a visible browser window")
    parser.add_argument("--delay", type=float, default=2.0, help="Seconds to wait between conversations")
    args = parser.parse_args()

    token = args.token
    if not token:
        if not DEFAULT_TOKEN_FILE.exists():
            print(f"No --token given and {DEFAULT_TOKEN_FILE} doesn't exist. "
                  f"Start the Chronicle server once to generate it, or pass --token.")
            sys.exit(1)
        token = DEFAULT_TOKEN_FILE.read_text(encoding="utf-8").strip()

    PROFILE_DIR.mkdir(exist_ok=True)
    state = load_state()
    imported = set(state["imported_urls"])

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=args.headless, viewport={"width": 1280, "height": 900}
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://chatgpt.com/", wait_until="domcontentloaded")

        if page.query_selector('a[href^="/c/"]') is None:
            print("Log into ChatGPT in the opened browser window, then press Enter here to continue...")
            input()
            page.goto("https://chatgpt.com/", wait_until="domcontentloaded")

        print("Collecting conversation list...")
        links = collect_conversation_links(page, limit=args.limit)
        print(f"Found {len(links)} conversation(s).")

        done = 0
        for i, (href, title_hint) in enumerate(links, start=1):
            url = f"https://chatgpt.com{href}" if href.startswith("/") else href
            if url in imported:
                continue
            print(f"[{i}/{len(links)}] {title_hint or url}")
            if import_conversation(page, url, title_hint, args.api_url, token):
                imported.add(url)
                state["imported_urls"] = sorted(imported)
                save_state(state)
                done += 1
            time.sleep(args.delay)

        context.close()

    print(f"Done. Imported {done} new conversation(s); already-imported ones were skipped.")


if __name__ == "__main__":
    main()
