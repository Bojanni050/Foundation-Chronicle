import { getSettings } from "@/lib/settings";

/**
 * Ask the local server to generate chunk-level and object-level embeddings
 * for any object — chat imports (with turns) as well as single-blob objects
 * like Screenpipe extractions or plain notes (no turns needed). Best-effort:
 * fails silently if the local server isn't running, same convention as
 * pollInbox() / personaSync — the object itself is already safely in
 * IndexedDB by the time this is called, so a failed embed only means "not
 * searchable yet", never data loss.
 *
 * @param {string} objectId  the object's IndexedDB id (obj_<ts>_<rand>)
 * @param {Array<{role: string, text: string}>} [turns]  optional; omit for
 *   non-chat objects, the whole content becomes a single chunk instead
 * @param {string} content   flattened content, used for the object-level
 *   embedding and as the single-chunk fallback when turns is omitted
 */
export async function embedObjectDetailed(objectId, turns, content, { signal } = {}) {
  const { apiUrl } = getSettings();
  if (!apiUrl || !objectId) return { ok: false, error: "Local API or object id missing" };
  try {
    const res = await fetch(`${apiUrl}/api/objects/${objectId}/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns: Array.isArray(turns) ? turns : [], content: content || "" }),
      signal,
    });
    const result = await res.json().catch(() => ({}));
    return res.ok
      ? { ok: result.objectEmbedded === true && result.chunksEmbedded === result.totalChunks, ...result }
      : { ok: false, error: result.error || `Embedding request failed (${res.status})` };
  } catch (err) {
    return { ok: false, aborted: err.name === "AbortError", error: err.message || "Local server unreachable" };
  }
}

export async function embedObject(objectId, turns, content) {
  return (await embedObjectDetailed(objectId, turns, content)).ok;
}
