// Frontend half of the native Windows UI Automation capture pipeline (see
// src-tauri/src/uia_capture.rs). Listens for "uia-capture" events emitted
// from Rust and queues them through the same inbox every other capture
// source uses (extension, bulk import, WordPress connector) — pollInbox()
// in App.js is the one place that turns queued items into IndexedDB
// objects. This used to write straight to IndexedDB itself, which made
// activity-capture a special case; routing it through the inbox instead
// means capture code only ever needs one contract: "queue it."
import { getSettings } from "@/lib/settings";

// Consecutive captures of the same app/window accumulate into one growing
// object instead of spawning a new one every 30s refresh — mirrors
// purememoryIngest.js's groupByFocusSession idea (one object per focus
// session). sessionId gives pollInbox()'s providerConversationId matching
// something stable to key off of, so repeated pushes for the same session
// update the same object instead of creating a new one each time.
let currentSession = null; // { appName, windowTitle, sessionId, lines: string[] }
let unlisten = null;
let retryTimer = null;

// A failed POST used to just get logged and dropped, silently losing
// whatever activity was captured during a server restart or a flaky local
// connection. Instead, failures persist here — keyed by sessionId rather
// than queued per-attempt — so a session that keeps failing simply has its
// entry overwritten with the latest (always superset, since lines only
// grow) content each time, and a later successful send for that session
// clears it. That ordering means a stale retry can never clobber a newer
// successful write with fewer lines. localStorage (not IndexedDB) survives
// an app restart without pulling in the app's IndexedDB object schema.
const PENDING_KEY = "chronicle:uiaCapturePendingQueue";
const RETRY_INTERVAL_MS = 20_000;

function loadPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePending(pending) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage unavailable/full — the retry queue just won't survive a
    // restart this time; the in-memory session still tries live sends.
  }
}

function dedupeConsecutive(lines) {
  const out = [];
  for (const line of lines) {
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out;
}

// "retry" covers both "server unreachable" and any 5xx — worth trying again
// later. "drop" covers "not configured yet" and any 4xx: the server has
// already told us this exact request is invalid (bad payload, bad auth),
// and retrying an unchanged body on a timer would just repeat the same
// rejection forever instead of ever clearing the queue.
async function postCapture(body) {
  const { apiUrl, apiToken } = getSettings();
  if (!apiUrl) return "drop";
  try {
    const res = await fetch(`${apiUrl}/api/objects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return "ok";
    if (res.status >= 400 && res.status < 500) {
      console.error(`[uiaCapture] server rejected activity object (${res.status}), dropping`);
      return "drop";
    }
    return "retry";
  } catch (err) {
    console.error("[uiaCapture] failed to send activity object, queued for retry:", err);
    return "retry";
  }
}

async function sendOrQueue(sessionId, body) {
  const result = await postCapture(body);
  const pending = loadPending();
  if (result === "retry") {
    pending[sessionId] = body;
    savePending(pending);
    return;
  }
  if (pending[sessionId]) {
    delete pending[sessionId];
    savePending(pending);
  }
}

// Retries every still-pending session on its own request body (the latest
// one recorded for that session, not necessarily what's in currentSession
// right now — the session may have moved on or the app may have restarted
// since). Runs on a timer plus once at listener startup, so anything left
// over from a previous crashed/closed run gets a chance to land too.
async function flushPending() {
  const pending = loadPending();
  const sessionIds = Object.keys(pending);
  if (sessionIds.length === 0) return;
  for (const sessionId of sessionIds) {
    const result = await postCapture(pending[sessionId]);
    if (result !== "retry") {
      const latest = loadPending();
      delete latest[sessionId];
      savePending(latest);
    }
  }
}

async function handleCapture(payload) {
  const appName = payload.app_name || "unknown";
  const windowTitle = payload.window_title || "";
  const newLines = Array.isArray(payload.captured_text) ? payload.captured_text : [];

  const sameSession = currentSession?.appName === appName && currentSession?.windowTitle === windowTitle;

  if (!sameSession) {
    currentSession = {
      appName,
      windowTitle,
      // crypto.randomUUID() is available in every context Tauri's webview
      // runs in — this is what makes repeated pushes for the same session
      // resolve to the same object instead of creating a new one each time.
      sessionId: crypto.randomUUID(),
      lines: [],
    };
  }
  currentSession.lines = dedupeConsecutive([...currentSession.lines, ...newLines]);

  const title = windowTitle ? `${appName} — ${windowTitle}` : appName;
  // Text capture is off by default (see Settings), so lines is routinely
  // empty — falling back to the title keeps plain window-tracking useful on
  // its own instead of silently producing objects with empty content, which
  // the server rejects outright (POST /api/objects/import requires content).
  const content = currentSession.lines.length ? currentSession.lines.join("\n\n") : title;

  const { apiUrl } = getSettings();
  if (!apiUrl) return; // no local server configured — nothing to queue to

  await sendOrQueue(currentSession.sessionId, {
    type: "activity",
    title,
    content,
    tags: [appName],
    sourceProvider: "uia",
    // Not a real URL — just a stable, unique key so
    // deriveProviderConversationId() gives pollInbox() something to
    // match repeated pushes for this session against.
    url: `uia://session/${currentSession.sessionId}`,
  });
}

/**
 * Starts listening for "uia-capture" events from the Rust backend. No-op
 * outside the Tauri desktop app (the dynamic import fails silently). Safe
 * to call multiple times — a second call replaces the previous listener
 * rather than stacking duplicates.
 */
export async function startUiaCaptureListener() {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    if (unlisten) unlisten();
    unlisten = await listen("uia-capture", (event) => handleCapture(event.payload));
    flushPending();
    if (!retryTimer) {
      retryTimer = setInterval(flushPending, RETRY_INTERVAL_MS);
    }
  } catch {
    // Not running under Tauri — nothing to listen to.
  }
}

export function stopUiaCaptureListener() {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  currentSession = null;
}
