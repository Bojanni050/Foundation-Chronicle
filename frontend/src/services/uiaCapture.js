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

function dedupeConsecutive(lines) {
  const out = [];
  for (const line of lines) {
    if (out[out.length - 1] !== line) out.push(line);
  }
  return out;
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
  const content = currentSession.lines.join("\n\n");

  const { apiUrl, apiToken } = getSettings();
  if (!apiUrl) return; // no local server configured — nothing to queue to

  try {
    await fetch(`${apiUrl}/api/objects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({
        type: "activity",
        title,
        content,
        tags: [appName],
        sourceProvider: "uia",
        // Not a real URL — just a stable, unique key so
        // deriveProviderConversationId() gives pollInbox() something to
        // match repeated pushes for this session against.
        url: `uia://session/${currentSession.sessionId}`,
      }),
    });
  } catch (err) {
    console.error("[uiaCapture] failed to queue activity object:", err);
  }
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
  } catch {
    // Not running under Tauri — nothing to listen to.
  }
}

export function stopUiaCaptureListener() {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  currentSession = null;
}
