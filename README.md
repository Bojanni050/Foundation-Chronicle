# Chronicle

A calm, minimal, **local-first** personal knowledge app inspired by Capacities. 
Single-user, private, offline-first. Your notes, chats, tasks, and memory reflections remain strictly on your own device.

> **Kernprincipe: registreren en archiveren.** Lees [`docs/kernprincipe.md`](docs/kernprincipe.md)
> vóór je hier iets aan toevoegt.

---

## 🏗️ Architecture & Technology Stack

Chronicle operates on a hybrid storage model designed for offline-first speed and local-first data ownership:

- **Frontend**: React + Tailwind CSS (inside `frontend/`)
- **Desktop Wrapper**: **Tauri v2** for a lightweight, secure local footprint.
- **Client Storage**: **IndexedDB** handles local-first storage for user objects (notes, tasks, ideas, chats).
- **Relational Storage & Vector Search**: **PostgreSQL (port 5434)** running **pgvector** handles persona traits, pulse caches, and metadata relations, accessed via **Drizzle ORM** (inside `server/`).
- **Local AI Vector Embeddings**: 1024-dimensional vectors are computed directly on-device in Node.js using `@huggingface/transformers` CPU ONNX models.
- **Local API Server**: Node.js + Express (`server/`) running concurrently with the frontend.
- **Browser Extension**: Manifest V3 extension (`extension/`) for instant chat scraping and ingestion.
- **Security & CSRF Protection**: Hardened CORS policies restricted to localhost/extensions and server-level HTTP Origin verification middleware to prevent Bearer token leakage.

---

## ⚡ Getting Started (Run Development)

To run the application, start both the Express API backend and the React frontend. This is handled automatically in a single command using `concurrently`:

### Prerequisites
1. Ensure your local PostgreSQL instance is running with `pgvector` enabled on port `5434`.
   ```bash
   # Run the local database container
   docker compose -f db/docker-compose.yml up -d
   ```
2. Install dependencies:
   ```bash
   npm run install:all
   ```
3. Apply database migrations:
   ```bash
   npm run db:migrate
   ```

   To verify the immutable episode/evidence contract against the local
   database without leaving test data behind:
   ```bash
   npm run db:test:episode
   ```

### Running the App
- **Browser Mode**: Launches React on port `3000` and starts the Node server concurrently.
  ```bash
  npm run dev
  ```
- **Desktop Mode**: Launches the native Tauri desktop window and starts the backend concurrently.
  ```bash
  npm run tauri:dev
  ```

---

## 🌟 Advanced Features

### Complete local archive backup

Settings → **Archive backup** exports one checksummed JSON file containing
IndexedDB objects, custom object types, raw attachment bytes, and portable
PostgreSQL memory data. Secrets (API keys/tokens, PIN data, usernames, local
model paths) and rebuildable derived data (embeddings/search chunks) are never
included.

The same settings section validates and restores an archive. Restore is a
non-destructive merge: extra local records remain, archived records win on the
same stable ID, attachment bytes are checksum-verified, and PostgreSQL changes
commit in one transaction. Immutable episodes are reused by observation hash
and are never updated or deleted during restore.

Before a restore preview becomes actionable, Chronicle now executes the exact
PostgreSQL restore path inside a rollback-only transaction. This preflight
catches schema, enum, foreign-key, and identity conflicts before any attachment
upload or IndexedDB merge begins.
The confirmation preview also reports the exact merge impact: added versus
overwritten objects and custom types, new versus reused attachments, workspace
renames, and new versus hash-reused immutable episodes.

Attachment uploads are scoped to a restore session. A failed merge rolls back
only files newly created by that session; attachments that already existed are
never deleted. Session finalization happens only after PostgreSQL commits, and
a finalization warning never reverses an otherwise successful restore.
Restore-session journals are persisted locally so a server restart does not
erase rollback knowledge. Data management can inspect interrupted sessions:
fully referenced sessions are safe to finalize, fully unreferenced sessions
are safe to roll back, and mixed or damaged sessions remain report-only.

### Safe local data maintenance

Settings → **Data management** reports attachment usage and rebuildable search
storage before changing anything. Orphan attachment files and derived object
chunks/embeddings have separate two-step purge controls. These controls never
delete source objects, knowledge, hypotheses, evidence, or immutable episodes.
Missing or stale object indexes can be repaired incrementally from IndexedDB;
completed objects are skipped on subsequent runs, while a full rebuild remains
available after changing the local embedding model.

Archive backup also records a local operational baseline (never included as a
secret). The readiness check compares current object and PostgreSQL source
fingerprints with that baseline and blocks a healthy result when referenced
attachment files are missing. Chronicle calls this the last generated export,
because browser download APIs cannot prove where a file was ultimately saved.

The same data-management area includes a cross-store integrity audit. It
reports missing source-object references from episodes, knowledge, and usage
logs, plus missing attachments and derived indexes without a source object.
Only orphan derived indexes can be repaired automatically; provenance findings
remain report-only so immutable evidence is never silently rewritten.

When an episode's source object is missing, the audit can also preview a
partial reconstruction from every immutable episode for that source ID. After
explicit confirmation Chronicle creates a locked IndexedDB object under the
original ID, clearly labelled as recovered rather than pretending it is the
original source.

### Object connections and backlinks

Every object can link directly to other archived objects. The object detail
view searches link candidates locally, shows outgoing links and backlinks, and
opens either side without leaving the archive. Links to a deleted or unavailable
object remain visible as missing provenance and can be removed explicitly.
Linked object titles also participate in global search, while the existing
`links[]` field remains portable through archive backup and restore.

### 🔐 Local Username & PIN Lock Screen
* Secure your local workspace. On first launch, set up a username and choose a 4-to-6 digit security PIN code.
* Interactive numpad with tactile hover effects, keyboard bind entries (`0-9` and `Backspace`), shake animation error handlers, and a "Lock Workspace" action in the sidebar.

### 🔍 Chronicle Engine & Diagnostic Board
An interactive visual diagnostic panel with four views:
1. **System Flow**: Interactive diagram mapping the data ingestion, local ONNX embedding generation, PostgreSQL pgvector storage, and duplicate detection pipelines.
2. **Memory Evolution**: Tracks the lifecycle of Persona traits, highlighting consolidation merging ($>0.75$ similarity) and Hindsight temporal reflection (`vervangen_door` replacing links).
3. **Token Telemetry**: Displays total prompt tokens, total completion tokens, estimated USD api costs, and a detailed audit log of the last 50 AI pipeline completions.
4. **Philosophy**: Outlines the core design decisions: local-first security, calm technology patterns, and prompt-bloat mitigation.

### 🖥️ Screenpipe Ambient Sync
* Integrated CORS proxy router queries your local Screenpipe database (`localhost:3030`) for OCR screen logs and audio transcriptions.
* AI extracts promising ideas and tasks, presenting them in an interactive checklist where you can edit titles/descriptions, switch types, and import them with one click.

### 🛠️ Developer Timeline Demo Seeder
* Instantly populates the app with simulated history (IndexedDB developer timelines from January to April 2026) and server-side PostgreSQL persona traits with local ONNX embeddings precalculated.
* Activated via the "Seed Developer Timeline" button in Settings.

---

## ⌨️ Keyboard Shortcuts (Windows / Linux Native)
- `Ctrl + N` — Create a new object
- `Ctrl + K` — Open quick search dialog
