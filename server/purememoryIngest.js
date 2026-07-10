const path = require("path");
const { execFile, spawn } = require("child_process");
const { pushToInbox } = require("./inboxStore");
const { isEnabled } = require("./purememoryConfig");

// Path to the built collector-agent .exe. Set PUREMEMORY_AGENT_PATH once you
// know where you keep it built — this default matches where it was built
// during initial testing.
const AGENT_EXE_PATH =
  process.env.PUREMEMORY_AGENT_PATH ||
  path.join("C:", "Users", "bojan", "Projects", "PureMemory", "collector-agent", "user-memory-collector.exe");
const AGENT_PROCESS_NAME = path.basename(AGENT_EXE_PATH);

let managedChild = null;

// Checks Windows' own process list rather than tracking only what Chronicle
// itself spawned — catches instances started manually or left over from a
// previous run (two processes writing to the same SQLite file is asking
// for contention).
function isAgentAlreadyRunning() {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", `IMAGENAME eq ${AGENT_PROCESS_NAME}`, "/FO", "CSV", "/NH"],
      (err, stdout) => {
        if (err) return resolve(false);
        resolve(stdout.toLowerCase().includes(AGENT_PROCESS_NAME.toLowerCase()));
      }
    );
  });
}

// Force-kills any existing collector-agent process found in Windows' process
// list. Used at startup so Chronicle always ends up running its own fresh
// instance instead of silently reusing (or fighting with) a stale one — e.g.
// a leftover build from manual testing.
function killExistingAgent() {
  return new Promise((resolve) => {
    execFile("taskkill", ["/IM", AGENT_PROCESS_NAME, "/F"], () => {
      // err is expected/harmless if no matching process existed
      resolve();
    });
  });
}

// Starts the collector-agent alongside Chronicle's server, unless the
// person has turned this off in Settings. Tied to this server process's own
// lifetime (killed on exit) rather than left detached — same "sidecar"
// semantics as the Tauri llama-server sidecar, just managed from Node
// instead of Rust since that's where this ingest job already lives.
async function ensureAgentRunning() {
  if (!isEnabled()) {
    console.log("[PureMemory] Auto-start disabled in Settings — skipping.");
    return;
  }
  if (managedChild && !managedChild.killed) return; // already started by us

  if (await isAgentAlreadyRunning()) {
    console.log("[PureMemory] Existing collector-agent process found — killing it before starting fresh.");
    await killExistingAgent();
    // Give Windows a moment to actually release the SQLite file handle.
    await new Promise((r) => setTimeout(r, 500));
  }

  try {
    managedChild = spawn(AGENT_EXE_PATH, [], {
      cwd: path.dirname(AGENT_EXE_PATH),
      stdio: "ignore",
      windowsHide: true,
    });
    managedChild.on("error", (err) => {
      console.error("[PureMemory] Failed to start collector-agent:", err.message);
      managedChild = null;
    });
    managedChild.on("exit", () => {
      managedChild = null;
    });
    console.log("[PureMemory] Collector-agent started alongside Chronicle.");
  } catch (err) {
    console.error("[PureMemory] Could not spawn collector-agent:", err.message);
  }
}

process.on("exit", () => {
  if (managedChild && !managedChild.killed) managedChild.kill();
});

// Ingests raw, judgment-free activity events from PureMemory's local Go
// collector-agent (github.com/YourPureAI/PureMemory) — reused ONLY as a
// capture source. Its own ingest-api/transport/AI-summarization layer is
// deliberately never touched: that pipeline distills activity into "memory"
// automatically, no confirmation step, which conflicts with Chronicle's
// design. This job just reads the same local SQLite buffer their own Go
// agent writes to, the same way screenpipeIngest.js reads Screenpipe's API —
// borrowing the capture, skipping the opinionated part.
//
// PUREMEMORY_DB_PATH must point at the collector-agent's "user-memory.db" —
// its location depends on the working directory the .exe was launched from
// (main.go opens it as a relative path). Set this explicitly once you know
// where that ends up.
const DB_PATH = process.env.PUREMEMORY_DB_PATH || path.join("C:", "Users", "bojan", "Projects", "PureMemory", "collector-agent", "user-memory.db");
const POLL_INTERVAL_MS = 30000;
const BATCH_LIMIT = 200;

let Database = null;
try {
  Database = require("better-sqlite3");
} catch {
  // Optional dependency — if not installed, this ingest job simply never runs.
}

function formatTimeRange(startMs, endMs) {
  const fmt = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return startMs === endMs ? fmt(startMs) : `${fmt(startMs)}–${fmt(endMs)}`;
}

// Extracts literal, objective content per event type. idle_start/idle_end
// carry no standalone text worth storing on their own — they're context
// signals, not observations. app_focus gets a minimal, always-safe line
// (app/window name only — metadata already captured regardless of privacy
// settings, never the sensitive stuff clipboard/file content can carry).
//
// NOTE: event.payload is already a parsed object here, not a JSON string —
// Go's json.RawMessage embeds it as raw nested JSON when the outer Event is
// marshaled, so the single outer JSON.parse(row.payload) already resolves
// it. Do not JSON.parse() it again.
function extractContent(event) {
  const payload = event.payload || {};
  switch (event.type) {
    case "app_focus": {
      const appName = event.context?.app_name || "onbekende app";
      const windowTitle = event.context?.window_title;
      return `→ ${appName}${windowTitle ? " — " + windowTitle : ""}`;
    }
    case "clipboard":
      return payload.content_type === "text" && payload.text ? payload.text : null;
    case "quick_note":
      return payload.note || null;
    case "text_input":
      return payload.text || null;
    case "url_visit":
      return event.context?.url ? `Bezocht: ${event.context.url}` : null;
    case "file_access": {
      // PureMemory already dedups file_access at the source (modTime +
      // content-hash) — the repetition seen earlier came from using
      // context.window_title here instead of the actual file identity,
      // which doesn't change per-file while browsing the same folder.
      const name = payload.name || (payload.path ? payload.path.split(/[\\/]/).pop() : null);
      if (!name) return null;
      const entryType = payload.content?.entry_type === "document_edited" ? "Bewerkt" : "Geopend";
      const text = payload.content?.extracted && payload.content?.text ? `: ${payload.content.text.slice(0, 500)}` : "";
      return `${entryType}: ${name}${text}`;
    }
    default:
      return null;
  }
}

// Groups events into objects. Content-bearing events (clipboard, files,
// notes) group by focus_session_id — PureMemory already computes one UUID
// per app-focus session, a more precise key than screenpipeIngest.js has to
// build itself. app_focus events are the exception: each one MINTS a new,
// unique focus_session_id (it's what defines the session), so grouping them
// the same way would give one tiny object per single window switch. Instead
// all app_focus events within one poll batch collapse into one shared
// "app-switches" bucket — a single object listing every switch, not one
// object per switch.
function groupByFocusSession(rows) {
  const groups = new Map();
  for (const row of rows) {
    let ev;
    try {
      ev = JSON.parse(row.payload);
    } catch {
      continue;
    }
    const text = extractContent(ev);
    if (!text || !text.trim()) continue;

    const isAppSwitch = ev.type === "app_focus";
    const key = isAppSwitch ? "app-switches" : ev.focus_session_id || "no-session";
    if (!groups.has(key)) {
      groups.set(key, {
        isAppSwitch,
        appName: ev.context?.app_name || "Unknown app",
        windowTitle: ev.context?.window_title || "",
        texts: [],
        minTs: row.created_at,
        maxTs: row.created_at,
        ids: [],
      });
    }
    const g = groups.get(key);
    // Dedup consecutive identical lines — polling-based watchers (e.g. the
    // filesystem watcher) can re-emit the same file/window on every tick
    // even when nothing actually changed, otherwise flooding one object with
    // the same line repeated dozens of times.
    if (g.texts[g.texts.length - 1] !== text.trim()) {
      g.texts.push(text.trim());
    }
    g.ids.push(row.id);
    if (row.created_at < g.minTs) g.minTs = row.created_at;
    if (row.created_at > g.maxTs) g.maxTs = row.created_at;
  }
  return [...groups.values()];
}

async function pollPureMemory() {
  if (!isEnabled() || !Database) {
    setTimeout(pollPureMemory, POLL_INTERVAL_MS);
    return;
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: false, fileMustExist: true });
    db.pragma("journal_mode = WAL");

    const rows = db
      .prepare("SELECT id, created_at, payload FROM events WHERE sent = 0 ORDER BY created_at ASC LIMIT ?")
      .all(BATCH_LIMIT);

    if (rows.length > 0) {
      const groups = groupByFocusSession(rows);
      for (const g of groups) {
        const objectId = "inbox_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
        const title = g.isAppSwitch
          ? `App-wissels (${g.texts.length}x, ${formatTimeRange(g.minTs, g.maxTs)})`
          : `${g.appName}${g.windowTitle ? " — " + g.windowTitle : ""} (${formatTimeRange(g.minTs, g.maxTs)})`;
        pushToInbox({
          objectId,
          type: "activity",
          source: "purememory",
          title,
          content: g.texts.join("\n"),
          sourceProvider: "purememory",
          tags: g.isAppSwitch ? ["app-wissels"] : [g.appName].filter(Boolean),
          url: null,
          turns: [],
          queuedAt: new Date().toISOString(),
        });
      }

      // Mark every processed row as sent, not just the ones that produced
      // content (app_focus/idle rows included) — same AckBatch semantics
      // the Go agent's own transport client uses, just done directly in SQL.
      const allIds = rows.map((r) => r.id);
      const placeholders = allIds.map(() => "?").join(",");
      db.prepare(`UPDATE events SET sent = 1, sent_at = ? WHERE id IN (${placeholders})`).run(
        Date.now(),
        ...allIds
      );
    }
  } catch (err) {
    console.error("[PureMemory Ingest] poll failed:", err.message);
  } finally {
    if (db) db.close();
    setTimeout(pollPureMemory, POLL_INTERVAL_MS);
  }
}

function startPureMemoryIngest() {
  setTimeout(ensureAgentRunning, 3000); // give Chronicle's own startup a moment first
  setTimeout(pollPureMemory, 5000);
}

module.exports = { startPureMemoryIngest };
