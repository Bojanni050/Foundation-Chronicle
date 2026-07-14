# Chronicle

A calm, minimal, **local-first** personal knowledge app inspired by Capacities. 
Single-user, private, offline-first. Your notes, chats, tasks, and memory reflections remain strictly on your own device.

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
