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
import base64
import json
import mimetypes
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from markdownify import markdownify as md
from bs4 import BeautifulSoup

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


def post_import(api_url, token, payload, retries=2):
    req = urllib.request.Request(
        f"{api_url}/api/objects/import",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, {"error": e.read().decode("utf-8", "ignore")}
        except (urllib.error.URLError, OSError) as e:
            # A raw socket timeout (a plain TimeoutError, which is an
            # OSError subclass) during response reading is NOT wrapped in
            # URLError by urllib — it used to crash the whole run instead of
            # just failing this one conversation. Transient over a
            # multi-hour scrape, so worth a couple of retries before giving up.
            if attempt < retries:
                print(f"    ! import request failed ({e}), retrying...")
                time.sleep(2)
                continue
            return 0, {"error": str(e)}


def post_attachment(api_url, token, data, filename, mime_type, retries=1):
    """Uploads raw bytes to Chronicle's attachment store, returning the
    {id, filename, mimeType, size, url} metadata to embed in the object's
    `attachments` array, or None on failure (never fatal to the import)."""
    req = urllib.request.Request(
        f"{api_url}/api/attachments",
        data=data,
        headers={
            "Content-Type": mime_type or "application/octet-stream",
            "Authorization": f"Bearer {token}",
            "X-Attachment-Filename": urllib.parse.quote(filename),
        },
        method="POST",
    )
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            if attempt < retries:
                time.sleep(2)
                continue
            print(f"    ! attachment upload failed for {filename!r}: {e}")
            return None


def download_and_upload_images(page, images, api_url, token):
    """Fetches each image's bytes — via the page's own authenticated request
    context for http(s) URLs (so signed/cookie-gated ChatGPT CDN URLs work
    the same as they do in the browser), or straight from the already-
    decoded bytes for a data: URI — and uploads it to Chronicle's local
    attachment store. Returns a list of attachment metadata dicts; failures
    are skipped, not fatal."""
    attachments = []
    for i, img in enumerate(images):
        try:
            if img["kind"] == "url":
                resp = page.request.get(img["src"], timeout=30000)
                if not resp.ok:
                    print(f"    ! image download failed ({resp.status}): {img['src'][:100]}")
                    continue
                data = resp.body()
                mime_type = resp.headers.get("content-type", "image/png").split(";")[0].strip()
            else:
                data = img["data"]
                mime_type = img["mime_type"]
            ext = mimetypes.guess_extension(mime_type) or ".png"
            filename = f"image-{i + 1}{ext}"
            meta = post_attachment(api_url, token, data, filename, mime_type)
            if meta:
                attachments.append(meta)
        except Exception as e:
            print(f"    ! image download error: {e}")
    return attachments


def extract_and_strip_images(html):
    """Pulls <img> sources (http(s) URLs and inline data: URIs alike) out of
    a message's HTML and returns (cleaned_html, [image_descriptors]).
    Images are represented as separate `attachments` on the object (see
    ObjectDetail.jsx's attachment strip), not inlined into the markdown
    text.

    data: URIs are ALWAYS stripped from the text (previously they were left
    alone on the assumption they're small decorative icons — wrong: ChatGPT
    inlines pasted screenshots the same way). An unbroken base64 blob has no
    whitespace for a tokenizer to split on, so it produces far more tokens
    than its byte length suggests; one of these survived into a chunk's text
    and caused a ~13GB attention-mask allocation that crashed the embedding
    worker entirely (chunking has no size cap — see server/embedding.js).
    Ones under 2KB decoded are dropped rather than uploaded as an attachment
    (genuinely trivial, e.g. an emoji glyph) — but still stripped from the
    text either way, since that's what actually matters for the embedding
    bug regardless of whether it's "worth" an attachment."""
    if "<img" not in html:
        return html, []
    soup = BeautifulSoup(html, "html.parser")
    images = []
    for img in soup.find_all("img"):
        src = img.get("src", "")
        if src.startswith("http://") or src.startswith("https://"):
            images.append({"kind": "url", "src": src})
        elif src.startswith("data:"):
            match = re.match(r"data:([^;,]*)(;base64)?,(.*)", src, re.DOTALL)
            if match:
                mime_type = match.group(1) or "image/png"
                try:
                    data = (
                        base64.b64decode(match.group(3))
                        if match.group(2)
                        else urllib.parse.unquote_to_bytes(match.group(3))
                    )
                    if len(data) > 2048:
                        images.append({"kind": "data", "mime_type": mime_type, "data": data})
                except Exception:
                    pass  # malformed data URI — nothing to salvage, just drop it below
        img.decompose()  # always strip <img> regardless of src kind or decode outcome
    return str(soup), images


def collect_conversation_links(page, limit=None):
    """Scrolls the sidebar history list to load every conversation link.
    Selector is anchored on ChatGPT's URL pattern (/c/<uuid>) rather than a
    classname, since that's the part of the DOM least likely to change."""
    # is_logged_in() (in main()) just confirmed this selector existed, but
    # ChatGPT can still reload/redirect right after auth completes (final
    # SSO bounce, a client-side route change, etc.), briefly wiping the DOM
    # before the sidebar re-renders. Retry with a reload instead of a single
    # 20s wait+crash, and if it's still not there, print enough about the
    # actual page state to diagnose rather than an opaque timeout traceback.
    found = False
    for attempt in range(3):
        try:
            page.wait_for_selector('a[href^="/c/"]', timeout=15000)
            found = True
            break
        except PWTimeout:
            print(f"  [diag] attempt {attempt + 1}/3: sidebar links not found after 15s, "
                  f"url={page.url!r} title={page.title()!r}")
            if attempt < 2:
                page.reload(wait_until="domcontentloaded")
                page.wait_for_timeout(1500)
    if not found:
        snippet = ""
        try:
            snippet = page.evaluate("() => document.body.innerText.slice(0, 500)")
        except Exception:
            pass
        print(f"  ! Could not find any conversations in the sidebar after 3 attempts. "
              f"Current page: url={page.url!r} title={page.title()!r}")
        print(f"  ! Page text snippet: {snippet!r}")
        print("  ! This may mean ChatGPT showed a rate-limit/verification page after repeated "
              "automated logins, or the account genuinely has no chat history in this profile.")
        return []

    # page.mouse.wheel() scrolls whatever happens to be under the cursor,
    # not necessarily the sidebar list — target its actual scrollable
    # ancestor directly instead, same approach as collect_turns.
    handle = page.evaluate_handle(
        """() => {
            const anyLink = document.querySelector('a[href^="/c/"]');
            let el = anyLink && anyLink.parentElement;
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
    diag = page.evaluate(
        "(el) => ({ tag: el.tagName, cls: (el.className||'').toString().slice(0,80), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, isScrollingElement: el === document.scrollingElement })",
        handle,
    )
    print(f"  [diag] sidebar scroll target: {diag}")

    seen = {}

    def collect_current():
        for a in page.query_selector_all('a[href^="/c/"]'):
            href = a.get_attribute("href")
            if href and href not in seen:
                seen[href] = (a.inner_text() or "").strip()

    collect_current()
    print(f"  [diag] links before any scrolling: {len(seen)}")

    # ChatGPT fetches older history over the network once you approach the
    # bottom of the sidebar — that round-trip takes noticeably longer than a
    # render tick. The previous version waited only 400ms per step and
    # concluded "nothing more to load" the moment scrollHeight looked stable
    # for two rounds (~800ms total) - nowhere near enough time for that
    # fetch to land, so it always stopped at whatever was already rendered.
    # Scroll straight to the current bottom each round, then give it a much
    # longer settle wait and require several consecutive quiet rounds
    # (checking both link count AND scrollHeight, since a fetch can add
    # DOM — a new date-group header, say — before new links appear) before
    # concluding history is actually exhausted.
    SETTLE_WAIT_MS = 1500
    REQUIRED_STABLE_SETTLES = 4
    stable_settles = 0
    for i in range(200):
        if limit and len(seen) >= limit:
            break
        before_links = len(seen)
        before_height = page.evaluate("(el) => el.scrollHeight", handle)

        page.evaluate("(el) => { el.scrollTop = el.scrollHeight; }", handle)
        page.wait_for_timeout(SETTLE_WAIT_MS)

        collect_current()
        after_height = page.evaluate("(el) => el.scrollHeight", handle)
        grew = len(seen) > before_links or after_height > before_height + 4
        stable_settles = 0 if grew else stable_settles + 1

        print(f"  [diag] round {i}: links={len(seen)} height={before_height}->{after_height} grew={grew} stableSettles={stable_settles}")
        if stable_settles >= REQUIRED_STABLE_SETTLES:
            break
    items = list(seen.items())
    return items[:limit] if limit else items


def get_last_separator_label(page):
    """ChatGPT groups turns with a date-separator row between them —
    <div role="separator" aria-label="zaterdag 14:15"> — statically in the
    DOM, not a hover-only tooltip (confirmed from a real logged-in session's
    devtools; no hover simulation needed, unlike the earlier guess this
    replaced). Returns the last one currently mounted, i.e. the group
    closest to whatever's rendered right now."""
    try:
        return page.evaluate(
            """() => {
                const labels = Array.from(document.querySelectorAll('[role="separator"][aria-label]'))
                    .map(el => el.getAttribute('aria-label'))
                    .filter(Boolean);
                return labels.length ? labels[labels.length - 1] : null;
            }"""
        )
    except Exception:
        return None


def collect_turns(page):
    """Scrolls the whole conversation top -> bottom, collecting every
    message in chronological order. Mirrors extension/popup.js's
    collectAllTurns: same virtualization problem (long chats unmount
    off-screen messages), same fix (walk top to bottom, merge by content,
    terminate purely on reaching the bottom — never on "no new turns this
    round", since one long message can span several steps with nothing new
    to report in between). Also tracks the last date-separator label seen
    along the way (see get_last_separator_label) — later snapshots are
    further down the conversation, so the last one found is the most
    recent, best proxy for "when did this exchange happen".

    Returns (turns, last_date_label).
    """
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
    last_date_label = get_last_separator_label(page)

    def merge_in(items):
        nonlocal last_date_label
        for item in items:
            key = item["role"] + "::" + item["html"]
            if key not in seen:
                seen.add(key)
                merged.append(item)
        label = get_last_separator_label(page)
        if label:
            last_date_label = label

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
    images = []
    for item in merged:
        cleaned_html, item_images = extract_and_strip_images(item["html"])
        images.extend(item_images)
        text = md(cleaned_html, heading_style="ATX", bullets="-").strip()
        if text:
            turns.append({"role": item["role"], "text": text})
    return turns, last_date_label, images


def format_turns(turns):
    return "\n\n".join(f"{'A' if t['role'] == 'assistant' else 'H'}: {t['text']}" for t in turns)


def import_conversation(page, url, title_hint, api_url, token):
    page.goto(url, wait_until="domcontentloaded")
    try:
        page.wait_for_selector("[data-message-author-role]", timeout=15000)
    except PWTimeout:
        print(f"  ! no messages found, skipping: {url}")
        return False

    turns, last_date_label, images = collect_turns(page)
    if not turns:
        print(f"  ! no turns extracted, skipping: {url}")
        return False

    occurred_at = None
    if last_date_label:
        dt = parse_relative_date_label(last_date_label)
        occurred_at = dt.isoformat() if dt else None

    attachments = []
    if images:
        print(f"  downloading {len(images)} image(s)...")
        attachments = download_and_upload_images(page, images, api_url, token)

    content = format_turns(turns)
    # title_hint is ChatGPT's own conversation title, read from the sidebar
    # link's text in collect_conversation_links — prefer that over deriving
    # one from the first message, since it's the title the user actually
    # sees (and often edits) in ChatGPT itself.
    title = title_hint or next((t["text"][:80] for t in turns if t["role"] == "user"), page.title())

    payload = {
        "title": title,
        "content": content,
        "turns": turns,
        "sourceProvider": "chatgpt",
        "url": url,
        "occurredAt": occurred_at,
        "attachments": attachments,
    }
    status, body = post_import(api_url, token, payload)
    if status == 201:
        print(f"  -> imported {len(turns)} turns, {len(attachments)} attachment(s) (occurredAt={occurred_at})")
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
        # Google's account security blocks "Continue with Google" sign-ins
        # from a browser it detects as automated ("This browser or app may
        # not be secure") — it does not affect chatgpt.com itself, only that
        # one OAuth path. channel="chrome" drives the user's real installed
        # Chrome (rather than Playwright's bundled Chromium test build),
        # and disabling the AutomationControlled blink feature plus patching
        # navigator.webdriver removes the most common automation fingerprints
        # Google's check looks for. Even so: logging in with ChatGPT email +
        # password instead of "Continue with Google" sidesteps the check
        # entirely and is the more reliable option.
        launch_kwargs = dict(
            headless=args.headless,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            context = p.chromium.launch_persistent_context(
                str(PROFILE_DIR), channel="chrome", **launch_kwargs
            )
        except Exception:
            print("Real Chrome not found (channel='chrome') — falling back to Playwright's bundled Chromium.")
            context = p.chromium.launch_persistent_context(str(PROFILE_DIR), **launch_kwargs)
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://chatgpt.com/", wait_until="domcontentloaded")

        def is_logged_in():
            # The login flow itself is several navigations (chatgpt.com ->
            # Google/email login -> back to chatgpt.com), and any of these
            # checks can land mid-navigation, when Playwright's execution
            # context for the page has been torn down and not yet replaced.
            # That's expected and transient here, not a real failure — treat
            # it as "not ready yet" rather than letting it crash the script.
            try:
                return page.query_selector('a[href^="/c/"]') is not None
            except Exception:
                return False

        if not is_logged_in():
            # Polls for login instead of blocking on input() — this script
            # can be spawned without a TTY attached (e.g. started from
            # Chronicle's own backend), where nothing could ever answer a
            # stdin prompt. The visible browser window is still the actual
            # login UI; this just waits for it instead of an Enter keypress.
            print("Waiting for you to log into ChatGPT in the opened browser window...")
            print("If Google blocks 'Continue with Google' as an unsafe browser, use email+password login instead.")
            logged_in = False
            for _ in range(600):  # up to 20 minutes
                try:
                    page.wait_for_timeout(2000)
                except Exception:
                    pass  # also transient during navigation — keep polling
                if is_logged_in():
                    logged_in = True
                    break
            if not logged_in:
                print("Timed out waiting for login.")
                context.close()
                sys.exit(1)
            print("Logged in.")

        print("Collecting conversation list...")
        links = collect_conversation_links(page, limit=args.limit)
        print(f"Found {len(links)} conversation(s).")

        done = 0
        for i, (href, title_hint) in enumerate(links, start=1):
            url = f"https://chatgpt.com{href}" if href.startswith("/") else href
            if url in imported:
                continue
            print(f"[{i}/{len(links)}] {title_hint or url}")
            try:
                ok = import_conversation(page, url, title_hint, args.api_url, token)
            except Exception as e:
                # One bad conversation (a stray Playwright error, an
                # unhandled network hiccup, ...) must not take down a
                # multi-hour, 70+-conversation run — already-imported ones
                # stay saved in imported.json either way, so this is just
                # "skip and keep going", not data loss.
                print(f"  ! unexpected error, skipping this conversation: {e}")
                ok = False
            if ok:
                imported.add(url)
                state["imported_urls"] = sorted(imported)
                save_state(state)
                done += 1
            time.sleep(args.delay)

        context.close()

    print(f"Done. Imported {done} new conversation(s); already-imported ones were skipped.")


if __name__ == "__main__":
    main()
