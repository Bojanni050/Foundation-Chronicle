# Chronicle — PRD

## Original Problem Statement
Build "Chronicle" — a calm, minimal, LOCAL-FIRST, single-user personal knowledge
app inspired by Capacities. No Supabase/Firebase/cloud DB/auth. Everything is an
"object" with a type. Data in IndexedDB behind a repository interface (swappable
for PostgreSQL later). Local Node/Express API server + Chrome extension pipeline
for sending AI chats. OpenRouter AI with graceful fallback. 3-column layout
matching the reference (cream + muted orange, serif headings).

## User Choices
- Web app in React + JavaScript (repository pattern preserved for future Postgres).
- Local server + Chrome extension delivered as ready-to-run code (only run on user's machine).
- OpenRouter key entered by user in Settings (client-side, no key needed from us).
- Design: match reference — cream #FAF8F5, muted orange #E8935B, Fraunces serif + Hanken Grotesk sans.

## Architecture
- **Frontend** (`/app/frontend`): React + Tailwind. Data via `ObjectRepository`
  contract → `IndexedDBObjectRepository`. Swap point: `src/repositories/index.js`.
- **Services**: `AIService` (OpenRouter), `chatParser` (Claude/ChatGPT/plain detection
  + keyword tags), `weave` (tag overlap + text similarity), `pulse` (rule-based digest),
  `inboxSync` (polls local server).
- **Local API server** (`/app/server`): Express, 127.0.0.1:4577, token auth, JSON inbox queue.
- **Extension** (`/app/extension`): MV3, vanilla JS, scrapes claude/chatgpt/gemini, POSTs to server.

## Implemented (2026-07-06)
- [x] Object CRUD (all 9 types) + repository layer + sidebar counts + fuzzy search (Cmd+K)
- [x] Quick capture with debounced autosave; manual tags
- [x] AI chat import (paste + file upload, bulk, format detection) → chat objects
- [x] Local API server (inbox queue) + web app polling (with failure backoff)
- [x] Browser extension (send button, per-provider DOM scraping, token auth)
- [x] OpenRouter Settings (key/model/test) + AIService with graceful fallback
- [x] Auto-tagging (AI or keyword fallback)
- [x] AI Weave (related via shared tags + text similarity; optional AI enhance)
- [x] AI Pulse (AI or rule-based digest)
- [x] 3-column calm UI matching reference; keyboard shortcuts (Cmd+N / Cmd+K)
- Verified: testing agent 11/11 frontend scenarios pass.

## Backlog (P1/P2)
- P1: PostgreSQL-backed repository + Docker (swap `repositories/index.js`), embeddings/pgvector for AI Weave.
- P1: Object linking UI (manual `links[]` between objects), backlinks.
- P2: Daily/scheduled AI Pulse (currently on-demand stub); provider-specific import previews.
- P2: Extension icon asset; richer content editor (markdown rendering).

## Next Tasks
- Await user feedback on the live web app; then wire the Postgres repository as the first migration step.
