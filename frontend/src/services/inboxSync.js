import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";
import { embedObject } from "@/services/objectEmbedding";
import { contentHash } from "@/lib/contentHash";

/**
 * Pull queued objects from the local API inbox into IndexedDB. Returns the
 * number of objects imported. Fails silently if the local server isn't
 * running (expected in hosted preview).
 *
 * Uses the atomic /claim endpoint (read-and-clear in one request) rather
 * than a separate GET then DELETE — if you have Chronicle open in both a
 * browser tab and the Tauri app at once, those are two entirely separate
 * IndexedDB stores polling the same inbox; a plain GET could hand the same
 * items to both before either cleared it. /claim guarantees each item goes
 * to exactly one caller.
 */
export async function pollInbox() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return -1;
  let items;
  try {
    const res = await fetch(`${apiUrl}/api/inbox/claim`, { method: "POST" });
    if (!res.ok) return -1;
    items = await res.json();
  } catch {
    return -1; // local server unreachable (expected in hosted preview)
  }
  if (!Array.isArray(items) || items.length === 0) return 0;

  // /claim already removed these from the server — each item's create() is
  // wrapped individually so one bad item can't silently take the rest of
  // the batch down with it (there's no server-side retry once claimed).
  let created = 0;
  for (const it of items) {
    try {
      // Skip if an object with the same content hash already exists
      const hash = it.contentHash || (it.content ? contentHash(it.content) : "");
      if (hash) {
        const existing = await objectRepository.findByContentHash(hash);
        if (existing) {
          created++;
          continue;
        }
      }

      // Reuse the server-generated objectId as the IndexedDB id (instead of
      // letting create() mint its own) so this is the one stable id that
      // both IndexedDB and the Postgres chat-embedding rows agree on.
      const obj = await objectRepository.create({
        id: it.objectId,
        type: it.type || "chat",
        title: it.title || (it.type === "activity" ? "Activity" : "Imported chat"),
        content: it.content || "",
        tags: Array.isArray(it.tags) ? it.tags : [],
        source: it.source || "extension",
        sourceProvider: it.sourceProvider || null,
        sourceUrl: it.url || null,
        occurredAt: it.occurredAt || null,
      });
      created++;
      // Best-effort — doesn't block the import if the local server or the
      // embedding model isn't available.
      embedObject(obj.id, it.turns, obj.content).catch(() => {});
    } catch (err) {
      console.error("[pollInbox] failed to create object from inbox item, item lost:", it, err);
    }
  }
  return created;
}
