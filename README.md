# Chronicle

A calm, minimal, **local-first** personal knowledge app inspired by Capacities.
Single-user, private, no cloud database or auth. Everything is an *object* with a
type — notes, people, tasks, ideas, books, projects, meetings, daily logs, chats.

- **Frontend**: React + Tailwind CSS (in `frontend/`)
- **Data**: IndexedDB via a swappable repository layer (`frontend/src/repositories/`)
- **Local API server**: Node + Express, localhost-only (`server/`)
- **Browser extension**: Manifest V3, vanilla JS (`extension/`)
- **AI**: OpenRouter (bring your own key), with graceful non-AI fallbacks
- No Supabase / Firebase / cloud DB / embeddings / vector search

## Architecture — built for a future Postgres migration

All data access goes through the `ObjectRepository` contract
(`create, getById, list, update, delete, search, counts`). The current
implementation is `IndexedDBObjectRepository`. To migrate to a local
PostgreSQL-backed API later, implement a new class against the same contract
and swap the single line in `frontend/src/repositories/index.js` — **no UI code
changes required.**

## Run (development)

Run the web app and the local API server side by side:

```bash
# 1. Web app
cd frontend && yarn install && yarn start      # or: npm run dev  (from repo root)

# 2. Local API server (separate terminal)
cd server && npm install && npm start          # or: npm run server (from repo root)
```

The server binds to `127.0.0.1:4577` only and prints an auth **token** on first
start (also stored in `server/data/token.txt`). Paste that token into the app's
**Settings → Browser extension** and into the extension popup.

## Browser extension

See `extension/README.md`. In short: `chrome://extensions` → enable Developer
mode → **Load unpacked** → select the `extension/` folder → paste API URL + token.

## Features

1. **Quick capture** — create notes/objects with minimal friction; freeform tags.
2. **AI chat import** — paste text or upload `.json/.txt/.md`; detects Claude &
   ChatGPT exports and plain conversations; bulk import supported.
3. **Local API + extension pipeline** — the extension scrapes a chat and POSTs it
   to the local server's inbox queue; the web app polls and imports it.
4. **Search (⌘K)** — fuzzy search across title, content, tags, provider.
5. **OpenRouter AI** — configurable key + model, "Test connection", graceful
   fallback so objects always save even when AI is unavailable.
6. **Auto-tagging** — AI-suggested tags, or keyword extraction fallback.
7. **AI Weave** — related objects via shared tags + text similarity (AI optional).
8. **AI Pulse** — on-demand digest (AI or rule-based).

## Keyboard shortcuts

- `⌘/Ctrl + N` — new note
- `⌘/Ctrl + K` — search
