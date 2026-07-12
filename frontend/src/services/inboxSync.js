import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";
import { embedObject } from "@/services/objectEmbedding";
import { contentHash } from "@/lib/contentHash";
import { deriveProviderConversationId } from "@/lib/providerConversationId";

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
      // Same conversation already exists (imported before — same or a
      // different source, e.g. extension then bulk importer, or a re-run
      // after the chat grew) — refresh it with what's new instead of
      // creating a duplicate. contentHash alone can't recognize this: it
      // changes whenever the content changes, which a genuine re-import
      // specifically expects.
      const providerConversationId = it.providerConversationId
        || deriveProviderConversationId(it.sourceProvider, it.url);
      if (providerConversationId) {
        const existing = await objectRepository.findByProviderConversationId(providerConversationId);
        if (existing) {
          const newHash = it.contentHash || (it.content ? contentHash(it.content) : "");
          if (newHash && newHash === existing.contentHash) {
            continue; // identical to what's already stored
          }
          try {
            const updated = await objectRepository.update(existing.id, {
              content: it.content || "",
              contentHash: newHash,
              turns: Array.isArray(it.turns) ? it.turns : [],
              attachments: Array.isArray(it.attachments) ? it.attachments : [],
              occurredAt: it.occurredAt || existing.occurredAt,
              title: it.title || existing.title,
            });
            if (updated) {
              created++;
              embedObject(updated.id, it.turns, updated.content).catch(() => {});
            }
          } catch (err) {
            // A locked object rejects changes to protected fields by
            // design — that's the lock working as intended, not a failure.
            console.log(`[pollInbox] existing object ${existing.id} is locked, skipping re-import update:`, err.message);
          }
          continue;
        }
      }

      // No provider-conversation identity to key off of (pasted text,
      // uploaded files) — fall back to content-hash dedup. Not counted in
      // `created` — pushToInbox() only dedups against what's still queued
      // (server/inboxStore.js), not against already-claimed history, so
      // re-sending an already-imported chat (e.g. clicking the extension's
      // Send button again) reaches here every time. Counting it as
      // "created" produced a "1 chat pulled from extension" toast on every
      // such resend even though nothing new was actually added.
      const hash = it.contentHash || (it.content ? contentHash(it.content) : "");
      if (hash) {
        const existing = await objectRepository.findByContentHash(hash);
        if (existing) {
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
        providerConversationId,
        occurredAt: it.occurredAt || null,
        attachments: Array.isArray(it.attachments) ? it.attachments : [],
        turns: Array.isArray(it.turns) ? it.turns : [],
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
