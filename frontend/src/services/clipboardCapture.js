// Frontend half of the native Windows clipboard capture pipeline (see
// src-tauri/src/clipboard_capture.rs). Listens for "clipboard-capture"
// events and queues them through the same inbox every other capture source
// uses — see uiaCapture.js for the fuller rationale on why this is a
// "queue it" contract rather than writing IndexedDB directly.
//
// Unlike UIA (a continuously growing text stream per focus session), each
// clipboard copy is a standalone event — nothing to group into a session,
// so there's one object per clip rather than one growing object per app.
import { getSettings } from "@/lib/settings";

let unlisten = null;
let retryTimer = null;

// Same reasoning as uiaCapture.js's pending queue: a failed POST used to
// just drop the capture. Here entries are keyed by a random id per clip
// (not by content) so two genuinely identical copies — e.g. the same
// snippet copied twice in a row — each still get queued and retried
// independently rather than one silently overwriting the other.
const PENDING_KEY = "chronicle:clipboardCapturePendingQueue";
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
    // restart this time; live sends still work.
  }
}

// "retry" covers "server unreachable" and any 5xx. "drop" covers "not
// configured yet" and any 4xx — the server already rejected this exact
// body, so retrying it unchanged on a timer would just repeat the same
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
      console.error(`[clipboardCapture] server rejected clipboard object (${res.status}), dropping`);
      return "drop";
    }
    return "retry";
  } catch (err) {
    console.error("[clipboardCapture] failed to send clipboard object, queued for retry:", err);
    return "retry";
  }
}

async function flushPending() {
  const pending = loadPending();
  const ids = Object.keys(pending);
  if (ids.length === 0) return;
  for (const id of ids) {
    const result = await postCapture(pending[id]);
    if (result !== "retry") {
      const latest = loadPending();
      delete latest[id];
      savePending(latest);
    }
  }
}

async function handleCapture(payload) {
  const content = (payload.content || "").trim();
  if (!content) return;

  const { apiUrl } = getSettings();
  if (!apiUrl) return; // no local server configured — nothing to queue to

  const id = crypto.randomUUID();
  const body = {
    type: "activity",
    title: "Clipboard",
    content,
    tags: ["clipboard"],
    sourceProvider: "clipboard",
  };

  const result = await postCapture(body);
  if (result === "retry") {
    const pending = loadPending();
    pending[id] = body;
    savePending(pending);
  }
}

/**
 * Starts listening for "clipboard-capture" events from the Rust backend.
 * No-op outside the Tauri desktop app. Safe to call multiple times — a
 * second call replaces the previous listener rather than stacking
 * duplicates.
 */
export async function startClipboardCaptureListener() {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    if (unlisten) unlisten();
    unlisten = await listen("clipboard-capture", (event) => handleCapture(event.payload));
    flushPending();
    if (!retryTimer) {
      retryTimer = setInterval(flushPending, RETRY_INTERVAL_MS);
    }
  } catch {
    // Not running under Tauri — nothing to listen to.
  }
}

export function stopClipboardCaptureListener() {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}
