# ChatGPT bulk importer

Imports your entire ChatGPT conversation history into Chronicle in one run,
by driving a real logged-in browser (Playwright) instead of clicking the
extension per chat.

## Setup (one-time)

```
pip install -r requirements.txt
python -m playwright install chromium
```

## Usage

Start the Chronicle server first (`npm run server` from the repo root), then:

```
# Test on a handful of chats first — recommended before a full run.
python bulk_import.py --limit 3

# Full history.
python bulk_import.py
```

The first run opens a visible Chrome window at chatgpt.com. Log in there,
then press Enter in the terminal to continue — the session is cached in
`.chatgpt_profile/` (gitignored) so you won't need to log in again.

**If Google shows "Niet inloggen" / "This browser or app may not be
secure"**: that's Google's account security flagging the automated browser,
not a ChatGPT problem — it only affects the "Continue with Google" button.
Log into ChatGPT with **email + password** instead in that same window;
that path doesn't go through Google's check at all. The script already
launches your real installed Chrome (not Playwright's bundled test build)
and strips the most common automation fingerprints to make the Google path
less likely to trip in the first place, but email+password is the reliable
fix if it still does.

Already-imported conversations are tracked in `imported.json` (gitignored)
and skipped on re-runs, so it's safe to stop and resume.

## Flags

- `--limit N` — only import the N most recent conversations.
- `--headless` — run without a visible window (only after you've verified
  a normal run works; headless is more likely to be flagged as a bot by
  ChatGPT and gives you nothing to debug against if selectors break).
- `--delay SECONDS` — pause between conversations (default 2s).
- `--token` / `--api-url` — override the Chronicle token/URL. Defaults to
  reading `server/data/token.txt` and `http://127.0.0.1:4577`.

## Known limitations

Selectors (`[data-message-author-role]` for messages, `a[href^="/c/"]` for
the sidebar list, `[role="tooltip"]` for the timestamp) are best-effort
against ChatGPT's current DOM — they weren't verified against a live,
logged-in session while writing this, since that requires your own account.
If a run finds 0 conversations or 0 turns, ChatGPT's markup has likely
changed; open devtools on chatgpt.com and check whether those selectors
still match, and report back what changed.
