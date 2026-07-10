// Frontend half of the native Windows UI Automation capture pipeline (see
// src-tauri/src/uia_capture.rs). Listens for "uia-capture" events emitted
// from Rust and turns them into the same "activity" object shape PureMemory
// produces today (frontend/src/services/inboxSync.js's pollInbox →
// objectRepository.create({ type: "activity", ... })), so every existing
// consumer (detectSpecialisten, embedding/RAG) keeps working unchanged —
// this only swaps where activity objects come from.
import { objectRepository } from "@/repositories";
import { embedObject } from "@/services/objectEmbedding";

// Consecutive captures of the same app/window accumulate into one growing
// object instead of spawning a new one every 30s refresh — mirrors
// purememoryIngest.js's groupByFocusSession idea (one object per focus
// session), reimplemented client-side since there's no server hop this time.
let currentSession = null; // { appName, windowTitle, objectId, lines: string[] }
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
    currentSession = { appName, windowTitle, objectId: null, lines: [] };
  }
  currentSession.lines = dedupeConsecutive([...currentSession.lines, ...newLines]);

  const title = windowTitle ? `${appName} — ${windowTitle}` : appName;
  const content = currentSession.lines.join("\n\n");

  try {
    if (!currentSession.objectId) {
      const obj = await objectRepository.create({
        type: "activity",
        title,
        content,
        tags: [appName],
        source: "uia",
        sourceProvider: "uia",
      });
      currentSession.objectId = obj.id;
    } else {
      await objectRepository.update(currentSession.objectId, { title, content });
    }
    // Best-effort — doesn't block capture if the local server or the
    // embedding model isn't available, same convention as pollInbox().
    embedObject(currentSession.objectId, [], content).catch(() => {});
  } catch (err) {
    console.error("[uiaCapture] failed to save activity object:", err);
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
